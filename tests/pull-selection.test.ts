import { describe, expect, it } from 'vitest'
import { pullableTags, pullKey } from '@/components/images/types'
import { acceptedMirrorTag } from '@/lib/images/mirror-run'

describe('pullableTags', () => {
  it('offers the newest tag and the newest tag in the current major', () => {
    expect(pullableTags({ status: 'update', latestVersion: '2.0.0', latestInMajor: '1.27.3' })).toEqual(['2.0.0', '1.27.3'])
  })

  it('offers a single tag when the update stays in the same major', () => {
    expect(pullableTags({ status: 'update', latestVersion: '1.27.3', latestInMajor: null })).toEqual(['1.27.3'])
    expect(pullableTags({ status: 'update', latestVersion: '1.27.3', latestInMajor: '1.27.3' })).toEqual(['1.27.3'])
  })

  it('offers nothing unless the image has an update', () => {
    expect(pullableTags({ status: 'current', latestVersion: '1.27.3', latestInMajor: null })).toEqual([])
  })
})

describe('pullKey', () => {
  it('keeps the image and the tag apart', () => {
    expect(pullKey('docker.io/library/nginx:1.27', '2.0.0')).not.toBe(pullKey('docker.io/library/nginx', '1.27\n2.0.0'))
  })
})

describe('acceptedMirrorTag', () => {
  const row = { status: 'update', latest_version: '2.0.0', latest_in_major: '1.27.3' }

  it('accepts either offered tag and rejects anything else', () => {
    expect(acceptedMirrorTag(row, '2.0.0')).toBe(true)
    expect(acceptedMirrorTag(row, '1.27.3')).toBe(true)
    expect(acceptedMirrorTag(row, '9.9.9')).toBe(false)
    expect(acceptedMirrorTag({ ...row, status: 'current' }, '2.0.0')).toBe(false)
    expect(acceptedMirrorTag(undefined, '2.0.0')).toBe(false)
  })
})
