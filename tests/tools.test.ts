import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { mergeKubeconfigs } from '@/lib/tools/kubeconfigMerge'
import { diffLines, diffYaml } from '@/lib/tools/yamlDiff'
import { convertCompose, shellSplit, DEFAULT_OPTIONS } from '@/lib/tools/composeToKube'
import { findInManifest } from '@/lib/tools/deprecatedApis'

const kubeconfig = (cluster: string, server: string, token: string) => `apiVersion: v1
kind: Config
clusters: [{name: ${cluster}, cluster: {server: ${server}}}]
users: [{name: admin, user: {token: ${token}}}]
contexts: [{name: admin@${cluster}, context: {cluster: ${cluster}, user: admin}}]
current-context: admin@${cluster}`

describe('mergeKubeconfigs', () => {
  it('renames clashing names and keeps the first current context', () => {
    const result = mergeKubeconfigs([
      { label: 'a', text: kubeconfig('prod', 'https://a:6443', 'one') },
      { label: 'b', text: kubeconfig('prod', 'https://b:6443', 'two') },
    ])
    expect(result.errors).toEqual([])
    expect(result.currentContext).toBe('admin@prod')
    expect(result.contexts.map(c => c.name)).toEqual(['admin@prod', 'admin@prod-2'])
    const merged = parse(result.yaml)
    expect(merged.clusters.map((c: any) => c.cluster.server)).toEqual(['https://a:6443', 'https://b:6443'])
    // Different credentials under the same user name must not collapse into one
    expect(merged.users).toHaveLength(2)
    const second = merged.contexts.find((c: any) => c.name === 'admin@prod-2').context
    expect(merged.users.find((u: any) => u.name === second.user).user.token).toBe('two')
  })
  it('deduplicates identical entries', () => {
    const text = kubeconfig('prod', 'https://a:6443', 'one')
    const result = mergeKubeconfigs([{ label: 'a', text }, { label: 'b', text }])
    expect(parse(result.yaml).clusters).toHaveLength(1)
  })
  it('reports invalid input and applies context renames', () => {
    const result = mergeKubeconfigs([{ label: 'a', text: kubeconfig('prod', 'https://a:6443', 'one') }, { label: 'bad', text: 'foo: [' }], {
      'admin@prod': 'production',
    })
    expect(result.errors.map(e => e.label)).toEqual(['bad'])
    expect(result.contexts[0].name).toBe('production')
    expect(result.currentContext).toBe('production')
  })
})

describe('diffYaml', () => {
  it('reports changes per document and ignores cluster noise', () => {
    const left = 'kind: ConfigMap\nmetadata: {name: x, resourceVersion: "1"}\ndata: {a: "1", b: "2"}'
    const right = 'kind: ConfigMap\nmetadata: {name: x, resourceVersion: "2"}\ndata: {a: "1", b: "3", c: "4"}'
    const [doc] = diffYaml(left, right).documents
    expect(doc.status).toBe('changed')
    expect(doc.changes).toEqual([
      { path: 'data.b', type: 'changed', before: '2', after: '3' },
      { path: 'data.c', type: 'added', after: '4' },
    ])
  })
  it('matches documents by kind and name', () => {
    const result = diffYaml('kind: A\nmetadata: {name: one}\n---\nkind: A\nmetadata: {name: two}', 'kind: A\nmetadata: {name: two}')
    expect(result.documents.map(d => [d.label, d.status])).toEqual([
      ['A one', 'onlyLeft'],
      ['A two', 'same'],
    ])
  })
  it('diffs lines', () => {
    expect(diffLines('a\nb\nc', 'a\nc\nd')).toEqual([
      { type: 'same', left: 'a', right: 'a' },
      { type: 'removed', left: 'b' },
      { type: 'same', left: 'c', right: 'c' },
      { type: 'added', right: 'd' },
    ])
  })
})

describe('composeToKube', () => {
  it('splits commands like a shell', () => {
    expect(shellSplit(`sh -c "echo 'hi there'" x\\ y`)).toEqual(['sh', '-c', "echo 'hi there'", 'x y'])
  })
  it('converts services, ports and named volumes', () => {
    const compose = `services:
  web:
    image: nginx:1.27
    ports: ["8080:80"]
    environment: {A: "no"}
    volumes: [data:/data]
volumes: {data: {}}`
    const result = convertCompose(compose, { ...DEFAULT_OPTIONS, namespace: 'demo', createNamespace: true })
    expect(result.error).toBeNull()
    expect(result.objects).toEqual([
      { kind: 'Namespace', name: 'demo' },
      { kind: 'PersistentVolumeClaim', name: 'data' },
      { kind: 'Deployment', name: 'web' },
      { kind: 'Service', name: 'web' },
    ])
    // YAML 1.1 readers (the API server) must see "no" as a string
    expect(result.yaml).toContain('value: "no"')
    const service = result.yaml.split('---').map(d => parse(d)).find(d => d.kind === 'Service')
    expect(service.spec.ports[0]).toMatchObject({ port: 8080, targetPort: 80 })
  })
  it('reports invalid compose files', () => {
    expect(convertCompose('services: [').error).toBeTruthy()
  })
})

describe('findInManifest', () => {
  it('groups removed APIs per kind with the objects using them', () => {
    const manifest = `apiVersion: policy/v1beta1
kind: PodDisruptionBudget
metadata: {name: pdb}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: d}
---
apiVersion: policy/v1beta1
kind: PodDisruptionBudget
metadata: {name: pdb2}`
    expect(findInManifest(manifest, { name: 'rel', namespace: 'ns' })).toEqual([
      expect.objectContaining({ group: 'policy', version: 'v1beta1', kind: 'PodDisruptionBudget', removedIn: '1.25', replacement: 'policy/v1', objects: ['pdb', 'pdb2'] }),
    ])
  })
})
