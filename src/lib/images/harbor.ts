import { getPool } from '@/lib/database'
import type { ImageReference } from './reference'

// Reads the Trivy report Harbor already stored on an artifact.
// Does not start a scan. Harbor is skipped entirely when it is disabled or has no URL.

const REPORT_PREFIX = 'application/vnd.security.vulnerability.report'
const REQUEST_TIMEOUT_MS = 15_000

export const CVE_SEVERITIES = ['None', 'Unknown', 'Low', 'Medium', 'High', 'Critical'] as const
export type CveSeverity = (typeof CVE_SEVERITIES)[number]

export interface CveSummary {
  severity: CveSeverity
  critical: number
  high: number
  medium: number
  low: number
  total: number
  fixable: number
  scannedAt: string | null
}

export interface HarborSettings {
  url: string
  username?: string
  password?: string
  project: string
}

export interface HarborTarget {
  project: string
  repository: string
  reference: string
}

export function harborHost(url: string) {
  return url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

// Harbor decodes the repository path segment once, so a slash must be encoded twice.
export function harborArtifactUrl(settings: HarborSettings, target: HarborTarget) {
  const project = encodeURIComponent(target.project)
  const repository = encodeURIComponent(encodeURIComponent(target.repository))
  const reference = encodeURIComponent(target.reference)
  return `https://${harborHost(settings.url)}/api/v2.0/projects/${project}/repositories/${repository}/artifacts/${reference}?with_scan_overview=true`
}

// Images pulled from Harbor itself carry the project in the path. Everything else
// is looked up in the configured project (usually the proxy cache).
export function resolveHarborTarget(ref: ImageReference, settings: HarborSettings): HarborTarget | null {
  const reference = ref.digest || ref.tag
  if (!reference) return null

  const host = harborHost(settings.url).toLowerCase()
  if (host && ref.registry.toLowerCase() === host) {
    const slash = ref.repository.indexOf('/')
    if (slash <= 0 || slash === ref.repository.length - 1) return null
    return {
      project: ref.repository.slice(0, slash),
      repository: ref.repository.slice(slash + 1),
      reference,
    }
  }

  const project = settings.project.trim()
  if (!project) return null
  return { project, repository: ref.repository, reference }
}

function countOf(summary: any, name: string) {
  if (!summary || typeof summary !== 'object') return 0
  const key = Object.keys(summary).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  const value = Number(key ? summary[key] : undefined)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function normalizeSeverity(value: unknown): CveSeverity | null {
  if (typeof value !== 'string') return null
  const match = CVE_SEVERITIES.find(severity => severity.toLowerCase() === value.trim().toLowerCase())
  return match ?? null
}

// null when Harbor has no successful report for this artifact. That is not an error:
// the image simply has no CVE score yet.
export function parseScanOverview(artifact: any): CveSummary | null {
  const overview = artifact?.scan_overview
  if (!overview || typeof overview !== 'object') return null
  const report = Object.entries(overview).find(([key]) => key.startsWith(REPORT_PREFIX))?.[1] as any
  if (!report || report.scan_status !== 'Success') return null
  const severity = normalizeSeverity(report.severity)
  if (!severity) return null
  const counts = report.summary?.summary
  return {
    severity,
    critical: countOf(counts, 'Critical'),
    high: countOf(counts, 'High'),
    medium: countOf(counts, 'Medium'),
    low: countOf(counts, 'Low'),
    total: countOf(report.summary, 'total'),
    fixable: countOf(report.summary, 'fixable'),
    scannedAt: typeof report.end_time === 'string' ? report.end_time : null,
  }
}

export async function loadHarborSettings(): Promise<HarborSettings | null> {
  const result = await getPool().query('SELECT key, value FROM settings WHERE key = ANY($1)', [
    ['harbor_enabled', 'harbor_url', 'harbor_username', 'harbor_password', 'harbor_project'],
  ])
  const settings = Object.fromEntries(result.rows.map((row: any) => [row.key, row.value]))
  if (settings.harbor_enabled !== 'true') return null
  const url = harborHost(settings.harbor_url || '')
  if (!url) return null
  return {
    url,
    username: (settings.harbor_username || '').trim() || undefined,
    password: settings.harbor_password || undefined,
    project: (settings.harbor_project || '').trim(),
  }
}

export async function fetchHarborScan(settings: HarborSettings, target: HarborTarget): Promise<{ summary: CveSummary | null; error?: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (settings.username && settings.password) {
    headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString('base64')}`
  }
  try {
    const response = await fetch(harborArtifactUrl(settings, target), { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (response.status === 404) return { summary: null }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { summary: null, error: 'Harbor authentication failed' }
      return { summary: null, error: `Harbor responded ${response.status}` }
    }
    return { summary: parseScanOverview(await response.json()) }
  } catch (error: any) {
    const message = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'Harbor request timed out' : error?.message || 'Harbor request failed'
    return { summary: null, error: message }
  }
}
