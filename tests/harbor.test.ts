import { describe, expect, it } from 'vitest'
import { harborArtifactUrl, parseScanOverview, resolveHarborTarget, type HarborSettings } from '@/lib/images/harbor'
import { parseImageReference } from '@/lib/images/reference'

const harbor: HarborSettings = {
  url: 'https://harbor.example.com/',
  project: 'proxy-cache',
}

const reportKey = 'application/vnd.security.vulnerability.report; version=1.1'

describe('resolveHarborTarget', () => {
  it('splits a Harbor image into project and repository and prefers the digest', () => {
    const ref = parseImageReference('harbor.example.com/proxy-cache/library/nginx:1.27@sha256:abc')
    expect(resolveHarborTarget(ref, harbor)).toEqual({
      project: 'proxy-cache',
      repository: 'library/nginx',
      reference: 'sha256:abc',
    })
  })

  it('looks up other registries in the configured project', () => {
    const ref = parseImageReference('nginx:1.27')
    expect(resolveHarborTarget(ref, harbor)).toEqual({
      project: 'proxy-cache',
      repository: 'library/nginx',
      reference: '1.27',
    })
  })

  it('skips foreign images when no project is configured', () => {
    expect(resolveHarborTarget(parseImageReference('quay.io/coreos/etcd:v3.5.0'), { ...harbor, project: '' })).toBeNull()
  })

  it('skips a Harbor image that has no project in its path', () => {
    expect(resolveHarborTarget(parseImageReference('harbor.example.com/nginx:1.27'), harbor)).toBeNull()
  })
})

describe('harborArtifactUrl', () => {
  it('double-encodes slashes in the repository name', () => {
    const url = harborArtifactUrl(harbor, { project: 'proxy-cache', repository: 'library/nginx', reference: 'sha256:abc' })
    expect(url).toBe(
      'https://harbor.example.com/api/v2.0/projects/proxy-cache/repositories/library%252Fnginx/artifacts/sha256%3Aabc?with_scan_overview=true'
    )
  })
})

describe('parseScanOverview', () => {
  it('reads severity, counts and scan time from a successful Trivy report', () => {
    const summary = parseScanOverview({
      scan_overview: {
        [reportKey]: {
          scan_status: 'Success',
          severity: 'High',
          summary: { total: 12, fixable: 5, summary: { Critical: 2, High: 5, Medium: 3, Low: 1, Unknown: 1 } },
          end_time: '2026-11-11T02:00:00Z',
        },
      },
    })
    expect(summary).toEqual({
      severity: 'High',
      critical: 2,
      high: 5,
      medium: 3,
      low: 1,
      total: 12,
      fixable: 5,
      scannedAt: '2026-11-11T02:00:00Z',
    })
  })

  it('returns nothing when the artifact was not scanned', () => {
    expect(parseScanOverview({})).toBeNull()
    expect(parseScanOverview({ scan_overview: { [reportKey]: { scan_status: 'Running', severity: 'High' } } })).toBeNull()
  })
})
