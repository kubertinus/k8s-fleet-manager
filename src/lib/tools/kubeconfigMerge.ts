import { parse, stringify } from 'yaml'

// Merges kubeconfig files into one, like `kubectl config view --flatten` with
// several files, but without silently dropping entries: a cluster, user or
// context whose name is already taken gets a suffix (kubernetes, kubernetes-2)
// and the references in contexts follow. An entry that is identical to one
// already merged is included once. Runs in the browser; nothing is sent anywhere.

export interface KubeconfigInput {
  label: string
  text: string
}

export interface MergedContext {
  // Final name (after the user's edits); mergedName is the name before them and
  // is the key for `contextNames`
  name: string
  mergedName: string
  originalName: string
  current: boolean
  source: string
  cluster: string
  user: string
  namespace: string | null
  server: string | null
  renamed: boolean
}

export interface MergeResult {
  yaml: string
  contexts: MergedContext[]
  currentContext: string | null
  // Problems per input (by label); inputs with errors are skipped
  errors: { label: string; message: string }[]
  renames: { source: string; kind: 'cluster' | 'user' | 'context'; from: string; to: string }[]
}

interface Named {
  name: string
  [key: string]: unknown
}

type Kind = 'cluster' | 'user' | 'context'

function sameContent(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function validate(config: any): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'Not a kubeconfig (expected a YAML mapping)'
  if (config.kind && config.kind !== 'Config') return `kind is "${config.kind}", expected "Config"`
  for (const key of ['clusters', 'users', 'contexts']) {
    if (config[key] !== undefined && !Array.isArray(config[key])) return `"${key}" must be a list`
  }
  if (!Array.isArray(config.contexts) || config.contexts.length === 0) return 'No contexts found'
  const clusters = new Set((config.clusters ?? []).map((c: Named) => c?.name))
  const users = new Set((config.users ?? []).map((u: Named) => u?.name))
  for (const ctx of config.contexts) {
    if (!ctx?.name) return 'A context without a name'
    if (!clusters.has(ctx.context?.cluster)) return `Context "${ctx.name}" refers to unknown cluster "${ctx.context?.cluster}"`
    if (!users.has(ctx.context?.user)) return `Context "${ctx.name}" refers to unknown user "${ctx.context?.user}"`
  }
  return null
}

export function mergeKubeconfigs(inputs: KubeconfigInput[], contextNames: Record<string, string> = {}): MergeResult {
  const merged: Record<Kind, Named[]> = { cluster: [], user: [], context: [] }
  const errors: MergeResult['errors'] = []
  const renames: MergeResult['renames'] = []
  const contexts: MergedContext[] = []
  let currentContext: string | null = null

  // Adds an entry under a free name; returns the name it ended up with
  const add = (kind: Kind, entry: Named, source: string): string => {
    const list = merged[kind]
    const existing = list.find(e => e.name === entry.name)
    if (!existing) {
      list.push(entry)
      return entry.name
    }
    if (sameContent(existing, entry)) return entry.name
    let n = 2
    while (list.some(e => e.name === `${entry.name}-${n}`)) n++
    const name = `${entry.name}-${n}`
    list.push({ ...entry, name })
    renames.push({ source, kind, from: entry.name, to: name })
    return name
  }

  for (const input of inputs) {
    if (!input.text.trim()) continue
    let config: any
    try {
      config = parse(input.text)
    } catch (error: any) {
      errors.push({ label: input.label, message: `Invalid YAML: ${error.message.split('\n')[0]}` })
      continue
    }
    const problem = validate(config)
    if (problem) {
      errors.push({ label: input.label, message: problem })
      continue
    }

    const clusterNames = new Map<string, string>()
    const userNames = new Map<string, string>()
    const servers = new Map<string, string | null>()
    for (const cluster of config.clusters as Named[]) {
      clusterNames.set(cluster.name, add('cluster', cluster, input.label))
      servers.set(cluster.name, (cluster as any).cluster?.server ?? null)
    }
    for (const user of config.users as Named[]) userNames.set(user.name, add('user', user, input.label))

    for (const ctx of config.contexts as any[]) {
      const entry = {
        ...ctx,
        context: { ...ctx.context, cluster: clusterNames.get(ctx.context.cluster), user: userNames.get(ctx.context.user) },
      }
      const name = add('context', entry, input.label)
      if (!contexts.some(c => c.name === name)) {
        contexts.push({
          name,
          mergedName: name,
          originalName: ctx.name,
          current: false,
          source: input.label,
          cluster: entry.context.cluster,
          user: entry.context.user,
          namespace: ctx.context.namespace ?? null,
          server: servers.get(ctx.context.cluster) ?? null,
          renamed: name !== ctx.name,
        })
      }
      if (currentContext === null && config['current-context'] === ctx.name) currentContext = name
    }
  }

  // Context names chosen by the user in the UI (merged name -> desired name)
  const finalName = (name: string) => contextNames[name]?.trim() || name
  const config = {
    apiVersion: 'v1',
    kind: 'Config',
    clusters: merged.cluster,
    users: merged.user,
    contexts: merged.context.map(ctx => ({ ...ctx, name: finalName(ctx.name) })),
    'current-context': currentContext ? finalName(currentContext) : (merged.context[0] ? finalName(merged.context[0].name) : ''),
    preferences: {},
  }

  return {
    // YAML 1.1 rules, as kubectl reads them: strings like "no" or "on" get quoted
    yaml: merged.context.length > 0 ? stringify(config, { version: '1.1' }) : '',
    contexts: contexts.map(c => ({
      ...c,
      name: finalName(c.name),
      current: c.name === (currentContext ?? merged.context[0]?.name),
      renamed: c.renamed || finalName(c.name) !== c.originalName,
    })),
    currentContext: config['current-context'] || null,
    errors,
    renames,
  }
}
