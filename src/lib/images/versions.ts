// Version comparison for image tags. Tags are treated as versions when they look
// like 1.2, v1.2.3 or 1.2.3.4, optionally followed by a suffix (-alpine, -rc.1, ...).

export type UpdateType = 'major' | 'minor' | 'patch'

const VERSION_PATTERN = /^v?\d+(\.\d+){0,3}(-[a-zA-Z0-9._-]+)?$/
const PRE_RELEASE = /-(rc|beta|alpha|dev|snapshot|pre|nightly)/i
// A "major" this large is a build number or date (20230811), not a version
const BUILD_NUMBER_MAJOR = 1000
const ARCH_SUFFIXES = [
  /-linux-(amd64|arm64|arm|386|ppc64le|s390x)$/,
  /-windows-[a-z0-9]+-amd64$/,
  /-darwin-(amd64|arm64)$/,
  /-(amd64|arm64|arm|386)$/,
]

export function isVersionTag(tag: string): boolean {
  return VERSION_PATTERN.test(tag)
}

function numericParts(tag: string): number[] {
  return tag.replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
}

// "-alpine" from "8.2.2-alpine"; architecture suffixes are ignored.
export function versionSuffix(tag: string): string {
  let clean = tag.replace(/^v/, '')
  for (const pattern of ARCH_SUFFIXES) clean = clean.replace(pattern, '')
  const dash = clean.indexOf('-')
  const suffix = dash === -1 ? '' : clean.slice(dash)
  // A pre-release marker (1.2.3-rc.1) is not a variant like -alpine; 1.2.3-rc.1 may move to 1.2.3.
  return PRE_RELEASE.test(suffix) ? '' : suffix
}

export function compareVersions(a: string, b: string): number {
  const pa = numericParts(a)
  const pb = numericParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  // Same numbers: a release ranks above its pre-releases
  const preA = PRE_RELEASE.test(a)
  const preB = PRE_RELEASE.test(b)
  if (preA !== preB) return preA ? -1 : 1
  return 0
}

function updateType(current: string, newer: string): UpdateType {
  const c = numericParts(current)
  const n = numericParts(newer)
  if ((n[0] || 0) !== (c[0] || 0)) return 'major'
  if ((n[1] || 0) !== (c[1] || 0)) return 'minor'
  return 'patch'
}

// Pick the newest tag that is a sensible replacement for `current`:
//  - same suffix (8.2-alpine only moves to x.y-alpine),
//  - no pre-releases unless the current tag is one,
//  - same number of parts (postgres:15 compares with 16, not 16.4; 13.2.4 not with 26.10),
//  - no build numbers or dates posing as a major version (13.2.4 is not followed by
//    9799770991 or 20230811), unless the current tag is such a number itself (calver),
//  - same "v" prefix convention when the repository uses both.
// For a major update, `latestInMajor` is the newest version that keeps the current
// major (MySQL 9.7.2 -> 26.10.0, or 9.7.4 within 9.x), when there is one.
export function findNewerVersion(
  current: string,
  tags: string[]
): { latest: string; type: UpdateType; latestInMajor?: string } | null {
  if (!isVersionTag(current)) return null

  const suffix = versionSuffix(current)
  const currentIsPre = PRE_RELEASE.test(current)
  const currentParts = numericParts(current)
  const hasV = current.startsWith('v')
  const isBuildNumber = (major: number) => major >= BUILD_NUMBER_MAJOR && currentParts[0] < BUILD_NUMBER_MAJOR

  let candidates = tags.filter(tag => {
    if (!isVersionTag(tag)) return false
    if (versionSuffix(tag) !== suffix) return false
    if (!currentIsPre && PRE_RELEASE.test(tag)) return false
    const parts = numericParts(tag)
    if (parts.length !== currentParts.length) return false
    if (isBuildNumber(parts[0])) return false
    return true
  })
  const samePrefix = candidates.filter(tag => tag.startsWith('v') === hasV)
  if (samePrefix.length > 0) candidates = samePrefix
  if (candidates.length === 0) return null

  const newestOf = (list: string[]) => list.reduce((best, tag) => (compareVersions(tag, best) > 0 ? tag : best))
  const newest = newestOf(candidates)
  if (compareVersions(newest, current) <= 0) return null
  const type = updateType(current, newest)
  if (type !== 'major') return { latest: newest, type }

  const sameMajor = candidates.filter(tag => numericParts(tag)[0] === currentParts[0] && compareVersions(tag, current) > 0)
  return sameMajor.length > 0 ? { latest: newest, type, latestInMajor: newestOf(sameMajor) } : { latest: newest, type }
}
