import http from 'http'
import https from 'https'
import { getPool } from '@/lib/database'
import type { ImageReference } from './reference'
import { fetchManifest, type PulledImage, type RegistryEndpoint } from './registry'

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
  insecureTls?: boolean
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

// global fetch() cannot skip certificate checks, so Harbor calls go through node:https.
function harborRequest(url: string, { method = 'GET', headers = {}, insecureTls = false, timeoutMs = REQUEST_TIMEOUT_MS, body: payload }: { method?: string; headers?: Record<string, string>; insecureTls?: boolean; timeoutMs?: number; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request(
      target,
      { method, headers, rejectUnauthorized: !insecureTls, timeout: timeoutMs },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, body }))
      }
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('Harbor request timed out'), { name: 'TimeoutError' })))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

export async function loadHarborSettings(): Promise<HarborSettings | null> {
  const result = await getPool().query('SELECT key, value FROM settings WHERE key = ANY($1)', [
    ['harbor_enabled', 'harbor_url', 'harbor_username', 'harbor_password', 'harbor_project', 'harbor_allow_insecure_tls'],
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
    insecureTls: settings.harbor_allow_insecure_tls === 'true',
  }
}

// Same rule as the harbor-mirror script: drop a leading registry host, keep repo/name:tag.
// docker.io/library/nginx:1.27 -> library/nginx:1.27
// registry.k8s.io/etcd:v3.6.12 -> etcd:v3.6.12
// kubertinus/kubertinus:12.3 stays as it is
export function normalizeMirrorPath(image: string): string | null {
  let path = image.trim()
  while (path.startsWith('/')) path = path.slice(1)
  if (path.includes('/')) {
    const first = path.slice(0, path.indexOf('/'))
    if (first.includes('.') || first.includes(':') || first === 'localhost') path = path.slice(first.length + 1)
  }
  while (path.startsWith('/')) path = path.slice(1)
  if (!path.includes(':') || path.startsWith(':') || path.endsWith(':')) return null
  return path
}

export function splitMirrorPath(path: string): { repository: string; tag: string } | null {
  const slash = path.lastIndexOf('/')
  const colon = path.lastIndexOf(':')
  if (colon <= slash) return null
  const repository = path.slice(0, colon)
  const tag = path.slice(colon + 1)
  if (!repository || !tag) return null
  return { repository, tag }
}

export interface HarborMirrorSettings {
  url: string
  username: string
  password: string
  sourceProject: string
  targetProject: string
  insecureTls: boolean
}

// Repository in the path is double-encoded; `from` is a query value, so once.
export function harborCopyUrl(settings: { url: string }, targetProject: string, repository: string, from: string) {
  const project = encodeURIComponent(targetProject)
  const repo = encodeURIComponent(encodeURIComponent(repository))
  return `https://${harborHost(settings.url)}/api/v2.0/projects/${project}/repositories/${repo}/artifacts?from=${encodeURIComponent(from)}`
}

export async function loadHarborMirrorSettings(): Promise<HarborMirrorSettings> {
  const result = await getPool().query('SELECT key, value FROM settings WHERE key = ANY($1)', [
    ['harbor_url', 'harbor_username', 'harbor_password', 'harbor_mirror_source_project', 'harbor_mirror_target_project', 'harbor_allow_insecure_tls'],
  ])
  const settings = Object.fromEntries(result.rows.map((row: any) => [row.key, row.value]))
  const url = harborHost(settings.harbor_url || '')
  const username = (settings.harbor_username || '').trim()
  const password = settings.harbor_password || ''
  if (!url || !username || !password) {
    throw new Error('Harbor URL, username and password are required to pull images')
  }
  return {
    url,
    username,
    password,
    sourceProject: (settings.harbor_mirror_source_project || 'directpull').trim() || 'directpull',
    targetProject: (settings.harbor_mirror_target_project || 'managed_nexus').trim() || 'managed_nexus',
    insecureTls: settings.harbor_allow_insecure_tls === 'true',
  }
}

const INDEX_MEDIA_TYPE = /manifest\.list|image\.index/i

export interface CachedArtifact {
  digest: string
  tags: string[]
  mediaType: string
  architecture?: string
  os?: string
  childDigests: string[]
  pushTime: string
}

// Artifacts Harbor actually stored. A proxy-cache manifest list often has a different
// digest than upstream, but it still references the platform manifests we pulled.
export function cachedArtifacts(body: string): CachedArtifact[] {
  let data: any
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error('Harbor artifact list was not valid JSON')
  }
  if (!Array.isArray(data)) return []
  return data.flatMap(item => {
    if (typeof item?.digest !== 'string') return []
    const tags = Array.isArray(item.tags) ? item.tags.map((tag: any) => tag?.name).filter((name: unknown) => typeof name === 'string') : []
    const references = Array.isArray(item.references) ? item.references : []
    return [{
      digest: item.digest,
      tags,
      mediaType: typeof item.manifest_media_type === 'string' ? item.manifest_media_type : (typeof item.media_type === 'string' ? item.media_type : ''),
      architecture: typeof item.extra_attrs?.architecture === 'string' ? item.extra_attrs.architecture : undefined,
      os: typeof item.extra_attrs?.os === 'string' ? item.extra_attrs.os : undefined,
      childDigests: references.map((reference: any) => reference?.child_digest).filter((digest: unknown) => typeof digest === 'string'),
      pushTime: typeof item.push_time === 'string' ? item.push_time : '',
    }]
  })
}

// Prefer the tagged artifact, then the index we pulled, then the index Harbor built
// around those platforms, then the linux/amd64 image the mirror script would push.
export function pickCachedDigest(artifacts: CachedArtifact[], tag: string, known: string[]): string | null {
  const tagged = artifacts.find(artifact => artifact.tags.includes(tag))
  if (tagged) return tagged.digest
  const wanted = new Set(known)
  const matched = artifacts.filter(artifact => wanted.has(artifact.digest))
  const index = matched.find(artifact => INDEX_MEDIA_TYPE.test(artifact.mediaType))
  if (index) return index.digest
  const rebuilt = artifacts
    .filter(artifact => INDEX_MEDIA_TYPE.test(artifact.mediaType) && artifact.childDigests.some(digest => wanted.has(digest)))
    .sort((a, b) => b.pushTime.localeCompare(a.pushTime))[0]
  if (rebuilt) return rebuilt.digest
  const amd64 = matched.find(artifact => artifact.os === 'linux' && artifact.architecture === 'amd64')
  if (amd64) return amd64.digest
  return matched.find(artifact => !INDEX_MEDIA_TYPE.test(artifact.mediaType))?.digest ?? matched[0]?.digest ?? null
}

function copyFailure(status: number, body: string, action = 'Harbor copy failed') {
  try {
    const data = JSON.parse(body)
    const message = Array.isArray(data?.errors) ? data.errors.map((error: any) => error?.message).filter(Boolean).join('; ') : ''
    if (message) return `${action}: ${message}`
  } catch {
    // Harbor sometimes answers with plain text
  }
  const trimmed = body.trim().slice(0, 180)
  return trimmed ? `${action} (HTTP ${status}): ${trimmed}` : `${action} (HTTP ${status})`
}

// Pull the new tag through the source project, then copy it into the target project.
// `image` is a full reference whose tag is already the version to mirror.
export async function mirrorImage(settings: HarborMirrorSettings, image: string): Promise<{ target: string }> {
  const path = normalizeMirrorPath(image)
  const parts = path ? splitMirrorPath(path) : null
  if (!path || !parts) throw new Error(`Not a tagged image: ${image}`)

  const endpoint: RegistryEndpoint = {
    baseUrl: `https://${harborHost(settings.url)}`,
    username: settings.username,
    password: settings.password,
    insecureTls: settings.insecureTls,
  }
  const sourceName = `${settings.sourceProject}/${parts.repository}`
  const pulled = await fetchManifest(endpoint, sourceName, parts.tag)

  const headers = {
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString('base64')}`,
  }
  const target = `${harborHost(settings.url)}/${settings.targetProject}/${path}`
  const taggedFrom = `${settings.sourceProject}/${path}`
  // A 200 from the tag copy is not enough: directpull often has the layers and no tag,
  // and the copy call can answer without putting anything in the target project.
  await copyArtifact(settings, headers, parts.repository, taggedFrom, 2)
  if (await targetHasTag(settings, headers, settings.targetProject, parts.repository, parts.tag)) return { target }

  const digest = await cachedDigest(settings, headers, parts.repository, parts.tag, pulled)
  if (!digest) throw new Error(`Image is in ${settings.sourceProject} without a tag, and Harbor has no artifact to copy`)
  const from = `${settings.sourceProject}/${parts.repository}@${digest}`
  console.log(`[image-mirror] ${taggedFrom} has no tag in ${settings.sourceProject}, copying ${from}`)
  const copied = await copyArtifact(settings, headers, parts.repository, from, 1)
  if (copied) throw new Error(copied)
  await createTag(settings, headers, settings.targetProject, parts.repository, digest, parts.tag)
  if (!(await targetHasTag(settings, headers, settings.targetProject, parts.repository, parts.tag))) {
    throw new Error(`Harbor copy finished without tag ${parts.tag} in ${settings.targetProject}`)
  }
  return { target }
}

async function targetHasTag(settings: HarborMirrorSettings, headers: Record<string, string>, project: string, repository: string, tag: string) {
  const repo = encodeURIComponent(encodeURIComponent(repository))
  const url = `https://${harborHost(settings.url)}/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${repo}/artifacts/${encodeURIComponent(tag)}`
  const response = await harborRequest(url, { headers, insecureTls: settings.insecureTls, timeoutMs: 30_000 })
  return response.status >= 200 && response.status < 300
}

// null when the copy landed (or was already there). Otherwise the Harbor error.
async function copyArtifact(settings: HarborMirrorSettings, headers: Record<string, string>, repository: string, from: string, attempts = 6): Promise<string | null> {
  const copyUrl = harborCopyUrl(settings, settings.targetProject, repository, from)
  let failure = 'Harbor copy failed'
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await harborRequest(copyUrl, {
      method: 'POST',
      headers,
      insecureTls: settings.insecureTls,
      timeoutMs: 60_000,
    })
    // 409: the artifact is already in the target project
    if (response.status === 200 || response.status === 201 || response.status === 409) return null
    failure = copyFailure(response.status, response.body)
    const missing = response.status === 404 || /not found/i.test(response.body)
    if (!missing || attempt === attempts - 1) return failure
    console.log(`[image-mirror] ${from} not registered yet, retrying`)
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  return failure
}

async function cachedDigest(settings: HarborMirrorSettings, headers: Record<string, string>, repository: string, tag: string, pulled: PulledImage): Promise<string | null> {
  const repo = encodeURIComponent(encodeURIComponent(repository))
  const url = `https://${harborHost(settings.url)}/api/v2.0/projects/${encodeURIComponent(settings.sourceProject)}/repositories/${repo}/artifacts?with_tag=true&page_size=100&sort=-push_time`
  const response = await harborRequest(url, { headers, insecureTls: settings.insecureTls, timeoutMs: 30_000 })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(copyFailure(response.status, response.body, 'Harbor artifact list failed'))
  }
  const known = [...pulled.manifests]
  if (pulled.digest && !known.includes(pulled.digest)) known.push(pulled.digest)
  return pickCachedDigest(cachedArtifacts(response.body), tag, known)
}

async function createTag(settings: HarborMirrorSettings, headers: Record<string, string>, project: string, repository: string, digest: string, tag: string) {
  const repo = encodeURIComponent(encodeURIComponent(repository))
  const url = `https://${harborHost(settings.url)}/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${repo}/artifacts/${encodeURIComponent(digest)}/tags`
  const response = await harborRequest(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }),
    insecureTls: settings.insecureTls,
    timeoutMs: 30_000,
  })
  // 409: this tag already points at the artifact
  if (response.status === 200 || response.status === 201 || response.status === 409) return
  throw new Error(copyFailure(response.status, response.body, 'Harbor tag failed'))
}

export async function fetchHarborScan(settings: HarborSettings, target: HarborTarget): Promise<{ summary: CveSummary | null; error?: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (settings.username && settings.password) {
    headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString('base64')}`
  }
  try {
    const response = await harborRequest(harborArtifactUrl(settings, target), { headers, insecureTls: settings.insecureTls })
    if (response.status === 404) return { summary: null }
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401 || response.status === 403) return { summary: null, error: 'Harbor authentication failed' }
      return { summary: null, error: `Harbor responded ${response.status}` }
    }
    return { summary: parseScanOverview(JSON.parse(response.body)) }
  } catch (error: any) {
    const message = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'Harbor request timed out' : error?.message || 'Harbor request failed'
    return { summary: null, error: message }
  }
}
