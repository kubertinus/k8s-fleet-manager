import { describe, expect, it } from 'vitest'
import { parseImageReference } from '@/lib/images/reference'

describe('parseImageReference', () => {
  it('normalises Docker Hub short names', () => {
    expect(parseImageReference('nginx:1.27')).toMatchObject({ registry: 'docker.io', repository: 'library/nginx', tag: '1.27' })
    expect(parseImageReference('bitnami/redis')).toMatchObject({ registry: 'docker.io', repository: 'bitnami/redis' })
  })
  it('keeps other registries and ports', () => {
    expect(parseImageReference('ghcr.io/org/app:v1.2.3')).toMatchObject({ registry: 'ghcr.io', repository: 'org/app', tag: 'v1.2.3' })
    expect(parseImageReference('localhost:5000/app:dev')).toMatchObject({ registry: 'localhost:5000', repository: 'app', tag: 'dev' })
    expect(parseImageReference('registry.k8s.io/kube-apiserver:v1.37.1')).toMatchObject({ registry: 'registry.k8s.io', repository: 'kube-apiserver' })
  })
  it('separates the digest', () => {
    const ref = parseImageReference('app:1.2@sha256:abc')
    expect(ref).toMatchObject({ tag: '1.2', digest: 'sha256:abc' })
    expect(parseImageReference('app@sha256:abc').tag).toBeUndefined()
  })
})
