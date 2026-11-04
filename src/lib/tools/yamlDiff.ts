import { parseAllDocuments, stringify } from 'yaml'

// Semantic diff of two YAML texts (manifests or Helm values). Key order and
// formatting don't matter; Kubernetes objects are matched on kind/namespace/name
// and lists of named items (containers, env, ports) on their name. Runs in the
// browser.

export type ChangeType = 'added' | 'removed' | 'changed'

export interface DiffChange {
  path: string
  type: ChangeType
  before?: unknown
  after?: unknown
}

export interface DocumentDiff {
  key: string
  label: string
  status: 'same' | 'changed' | 'onlyLeft' | 'onlyRight'
  changes: DiffChange[]
}

export interface YamlDiffResult {
  documents: DocumentDiff[]
  errors: { side: 'left' | 'right'; message: string }[]
  normalizedLeft: string
  normalizedRight: string
}

export interface LineRow {
  type: 'same' | 'added' | 'removed'
  left?: string
  right?: string
}

const ANNOTATION_NOISE = ['kubectl.kubernetes.io/last-applied-configuration', 'deployment.kubernetes.io/revision']
const METADATA_NOISE = ['managedFields', 'resourceVersion', 'uid', 'generation', 'creationTimestamp', 'selfLink']

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Fields the cluster fills in itself; they differ between clusters without meaning anything
function withoutClusterNoise(doc: unknown): unknown {
  if (!isObject(doc)) return doc
  const copy: Record<string, any> = { ...doc }
  delete copy.status
  if (isObject(copy.metadata)) {
    const metadata: Record<string, any> = { ...copy.metadata }
    METADATA_NOISE.forEach(key => delete metadata[key])
    if (isObject(metadata.annotations)) {
      const annotations = { ...metadata.annotations }
      ANNOTATION_NOISE.forEach(key => delete annotations[key])
      if (Object.keys(annotations).length === 0) delete metadata.annotations
      else metadata.annotations = annotations
    }
    copy.metadata = metadata
  }
  return copy
}

function parseSide(text: string, side: 'left' | 'right', errors: YamlDiffResult['errors'], ignoreNoise: boolean) {
  const docs: unknown[] = []
  for (const doc of parseAllDocuments(text)) {
    if (doc.errors.length > 0) {
      const err = doc.errors[0]
      const message = err.message.split('\n')[0].replace(/:$/, '')
      const at = err.linePos?.[0] && !/ at line \d+/.test(message) ? ` (line ${err.linePos[0].line}, column ${err.linePos[0].col})` : ''
      errors.push({ side, message: `${message}${at}` })
      continue
    }
    const value = doc.toJS()
    if (value === null || value === undefined) continue
    docs.push(ignoreNoise ? withoutClusterNoise(value) : value)
  }
  return docs
}

function documentKey(doc: unknown, index: number): { key: string; label: string } {
  if (isObject(doc) && typeof doc.kind === 'string' && isObject(doc.metadata) && typeof doc.metadata.name === 'string') {
    const ns = typeof doc.metadata.namespace === 'string' ? doc.metadata.namespace : ''
    return { key: `${doc.kind}/${ns}/${doc.metadata.name}`, label: `${doc.kind} ${ns ? `${ns}/` : ''}${doc.metadata.name}` }
  }
  return { key: `#${index}`, label: `Document ${index + 1}` }
}

function segment(key: string) {
  return /^[A-Za-z_][\w-]*$/.test(key) ? `.${key}` : `["${key}"]`
}

function namedList(list: unknown[]): Map<string, unknown> | null {
  const map = new Map<string, unknown>()
  for (const item of list) {
    if (!isObject(item) || typeof item.name !== 'string' || map.has(item.name)) return null
    map.set(item.name, item)
  }
  return map
}

function compare(a: unknown, b: unknown, path: string, out: DiffChange[]) {
  if (isObject(a) && isObject(b)) {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()
    for (const key of keys) {
      const p = path + segment(key)
      if (!(key in b)) out.push({ path: p, type: 'removed', before: a[key] })
      else if (!(key in a)) out.push({ path: p, type: 'added', after: b[key] })
      else compare(a[key], b[key], p, out)
    }
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const left = namedList(a)
    const right = namedList(b)
    if (left && right && (left.size > 0 || right.size > 0)) {
      const names = Array.from(new Set([...left.keys(), ...right.keys()]))
      for (const name of names) {
        const p = `${path}[name=${name}]`
        if (!right.has(name)) out.push({ path: p, type: 'removed', before: left.get(name) })
        else if (!left.has(name)) out.push({ path: p, type: 'added', after: right.get(name) })
        else compare(left.get(name), right.get(name), p, out)
      }
      return
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const p = `${path}[${i}]`
      if (i >= b.length) out.push({ path: p, type: 'removed', before: a[i] })
      else if (i >= a.length) out.push({ path: p, type: 'added', after: b[i] })
      else compare(a[i], b[i], p, out)
    }
    return
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, type: 'changed', before: a, after: b })
}

const normalize = (docs: unknown[]) => docs.map(doc => stringify(doc, { sortMapEntries: true })).join('---\n')

export function diffYaml(left: string, right: string, { ignoreClusterNoise = true } = {}): YamlDiffResult {
  const errors: YamlDiffResult['errors'] = []
  const leftDocs = parseSide(left, 'left', errors, ignoreClusterNoise)
  const rightDocs = parseSide(right, 'right', errors, ignoreClusterNoise)

  const leftByKey = new Map(leftDocs.map((doc, i) => [documentKey(doc, i).key, { doc, ...documentKey(doc, i) }]))
  const rightByKey = new Map(rightDocs.map((doc, i) => [documentKey(doc, i).key, { doc, ...documentKey(doc, i) }]))

  const documents: DocumentDiff[] = []
  for (const key of Array.from(new Set([...leftByKey.keys(), ...rightByKey.keys()]))) {
    const l = leftByKey.get(key)
    const r = rightByKey.get(key)
    if (l && !r) documents.push({ key, label: l.label, status: 'onlyLeft', changes: [] })
    else if (r && !l) documents.push({ key, label: r.label, status: 'onlyRight', changes: [] })
    else if (l && r) {
      const changes: DiffChange[] = []
      compare(l.doc, r.doc, '', changes)
      changes.forEach(c => (c.path = c.path.replace(/^\./, '') || '(document)'))
      documents.push({ key, label: l.label, status: changes.length > 0 ? 'changed' : 'same', changes })
    }
  }

  return { documents, errors, normalizedLeft: normalize(leftDocs), normalizedRight: normalize(rightDocs) }
}

// Line diff (longest common subsequence) for the side-by-side view of the
// normalized YAML. Returns null when the texts are too large to compare.
export function diffLines(left: string, right: string, maxCells = 4_000_000): LineRow[] | null {
  const a = left.split('\n')
  const b = right.split('\n')
  if (a.length * b.length > maxCells) return null
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: LineRow[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ type: 'same', left: a[i], right: b[j] })
      i++
      j++
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      rows.push({ type: 'added', right: b[j++] })
    } else {
      rows.push({ type: 'removed', left: a[i++] })
    }
  }
  return rows
}
