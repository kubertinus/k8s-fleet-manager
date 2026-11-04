import { describe, expect, it } from 'vitest'
import { compareVersions, findNewerVersion, isVersionTag, versionSuffix } from '@/lib/images/versions'

describe('isVersionTag', () => {
  it('accepts versions with optional v and suffix', () => {
    for (const tag of ['1.2', 'v1.2.3', '1.2.3.4', '8.2.2-alpine', '1.0.0-rc.1']) expect(isVersionTag(tag)).toBe(true)
  })
  it('rejects names and digests', () => {
    for (const tag of ['latest', 'main', 'sha256-abc', 'stable-alpine']) expect(isVersionTag(tag)).toBe(false)
  })
})

describe('versionSuffix', () => {
  it('keeps variants, drops architectures and pre-releases', () => {
    expect(versionSuffix('8.2.2-alpine')).toBe('-alpine')
    expect(versionSuffix('1.2.3-linux-amd64')).toBe('')
    expect(versionSuffix('1.2.3-rc.1')).toBe('')
  })
})

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2', '1.2.1')).toBe(-1)
  })
  it('ranks a release above its pre-release', () => {
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBe(1)
  })
})

describe('findNewerVersion', () => {
  it('finds a patch update', () => {
    expect(findNewerVersion('1.27.1', ['1.27.0', '1.27.1', '1.27.3'])).toEqual({ latest: '1.27.3', type: 'patch' })
  })
  it('returns null when current is newest', () => {
    expect(findNewerVersion('2.0.0', ['1.0.0', '2.0.0'])).toBeNull()
  })
  it('keeps the suffix', () => {
    expect(findNewerVersion('8.2-alpine', ['8.4', '8.3-alpine', '9.0-bookworm'])).toEqual({ latest: '8.3-alpine', type: 'minor' })
  })
  it('compares only tags with the same number of parts', () => {
    expect(findNewerVersion('15', ['15', '16', '16.4', '17.1'])).toEqual({ latest: '16', type: 'major' })
  })
  it('ignores build numbers posing as a major version', () => {
    expect(findNewerVersion('13.2.4', ['13.2.5', '9799770991.0.0', '20230811.1.1'])).toEqual({ latest: '13.2.5', type: 'patch' })
  })
  it('skips pre-releases unless current is one', () => {
    expect(findNewerVersion('1.2.3', ['1.2.4-rc.1', '1.2.3'])).toBeNull()
    expect(findNewerVersion('1.2.4-rc.1', ['1.2.4-rc.1', '1.2.4'])).toEqual({ latest: '1.2.4', type: 'patch' })
  })
  it('reports the newest version within the current major for a major update', () => {
    expect(findNewerVersion('9.7.2', ['9.7.2', '9.7.4', '26.10.0'])).toEqual({ latest: '26.10.0', type: 'major', latestInMajor: '9.7.4' })
  })
  it('prefers the v prefix convention of the current tag', () => {
    expect(findNewerVersion('v1.2.0', ['v1.3.0', '1.4.0'])).toEqual({ latest: 'v1.3.0', type: 'minor' })
  })
})
