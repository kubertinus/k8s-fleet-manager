import { parse, stringify } from 'yaml'

// Converts a Docker Compose file to Kubernetes manifests (Deployment, Service,
// PersistentVolumeClaim per service), in the browser. Anything without a direct
// Kubernetes equivalent becomes a warning instead of being silently dropped.

export interface ComposeOptions {
  namespace: string
  serviceType: 'ClusterIP' | 'NodePort' | 'LoadBalancer'
  storageSize: string
  storageClass: string
  createNamespace: boolean
  // Settings required by the Pod Security "restricted" profile
  restrictedSecurity: boolean
}

export interface ConvertedObject {
  kind: string
  name: string
}

export interface ComposeResult {
  yaml: string
  objects: ConvertedObject[]
  warnings: { service: string | null; message: string }[]
  error: string | null
}

export const DEFAULT_OPTIONS: ComposeOptions = {
  namespace: '',
  serviceType: 'ClusterIP',
  storageSize: '1Gi',
  storageClass: '',
  createNamespace: false,
  restrictedSecurity: false,
}

// Kubernetes names: lower case alphanumerics and '-', max 63 characters
function k8sName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63) || 'app'
  )
}

// Split a command string like the shell would (quotes, no expansion)
export function shellSplit(command: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let inArg = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) current += command[++i]
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inArg = true
    } else if (ch === '\\' && i + 1 < command.length) {
      current += command[++i]
      inArg = true
    } else if (/\s/.test(ch)) {
      if (inArg) args.push(current)
      current = ''
      inArg = false
    } else {
      current += ch
      inArg = true
    }
  }
  if (inArg) args.push(current)
  return args
}

const toArgs = (value: unknown): string[] | undefined =>
  value === undefined || value === null ? undefined : Array.isArray(value) ? value.map(String) : shellSplit(String(value))

// Compose durations ("30s", "1m30s", "500ms") -> whole seconds, at least 1
function seconds(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  let total = 0
  for (const [, n, unit] of String(value).matchAll(/(\d+(?:\.\d+)?)(ms|us|s|m|h)?/g)) {
    const factor = { ms: 0.001, us: 0.000001, s: 1, m: 60, h: 3600 }[unit ?? 's'] ?? 1
    total += Number(n) * factor
  }
  return Math.max(1, Math.round(total))
}

// Docker memory units (b, k, m, g; also kb/mb/gb) are binary: 512m -> 512Mi
function memory(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i)
  if (!match) return String(value)
  const unit = (match[2] ?? 'b').toLowerCase()
  return unit === 'b' ? match[1] : `${match[1]}${unit.toUpperCase()}i`.replace('KI', 'Ki')
}

interface PortMapping {
  containerPort: number
  hostPort?: number
  protocol: 'TCP' | 'UDP'
}

function parsePort(entry: unknown): PortMapping[] {
  if (typeof entry === 'number') return [{ containerPort: entry, protocol: 'TCP' }]
  if (entry && typeof entry === 'object') {
    const p = entry as any
    return [{ containerPort: Number(p.target), hostPort: p.published ? Number(p.published) : undefined, protocol: String(p.protocol ?? 'tcp').toUpperCase() === 'UDP' ? 'UDP' : 'TCP' }]
  }
  // "[ip:][host[-range]:]container[-range][/protocol]"
  const [spec, proto] = String(entry).split('/')
  const protocol = proto?.toLowerCase() === 'udp' ? 'UDP' : 'TCP'
  const parts = spec.split(':')
  const container = parts[parts.length - 1]
  const host = parts.length > 1 ? parts[parts.length - 2] : undefined
  const range = (r: string) => {
    const [a, b] = r.split('-').map(Number)
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]
  }
  const containers = range(container)
  const hosts = host ? range(host) : []
  return containers.map((c, i) => ({ containerPort: c, hostPort: hosts[i], protocol }))
}

function envList(environment: unknown): { name: string; value: string }[] {
  if (!environment) return []
  if (Array.isArray(environment)) {
    return environment.map(item => {
      const [name, ...rest] = String(item).split('=')
      return { name, value: rest.join('=') }
    })
  }
  return Object.entries(environment as Record<string, unknown>).map(([name, value]) => ({ name, value: value === null ? '' : String(value) }))
}

export function convertCompose(text: string, options: ComposeOptions = DEFAULT_OPTIONS): ComposeResult {
  const warnings: ComposeResult['warnings'] = []
  const warn = (service: string | null, message: string) => warnings.push({ service, message })

  let compose: any
  try {
    compose = parse(text)
  } catch (error: any) {
    return { yaml: '', objects: [], warnings, error: `Invalid YAML: ${error.message.split('\n')[0]}` }
  }
  if (!compose || typeof compose !== 'object' || !compose.services || typeof compose.services !== 'object') {
    return { yaml: '', objects: [], warnings, error: 'No "services" found; this does not look like a Compose file.' }
  }

  const ns = options.namespace.trim() ? k8sName(options.namespace) : ''
  const meta = (name: string, labels?: Record<string, string>) => ({
    name,
    ...(ns ? { namespace: ns } : {}),
    ...(labels ? { labels } : {}),
  })
  const docs: any[] = []
  const claims = new Map<string, any>()

  if (ns && options.createNamespace) docs.push({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } })

  for (const [rawName, svc] of Object.entries<any>(compose.services)) {
    const name = k8sName(rawName)
    if (name !== rawName) warn(rawName, `Renamed to "${name}" (Kubernetes names allow only lower case letters, digits and '-').`)
    if (!svc || typeof svc !== 'object') continue
    if (!svc.image) {
      warn(rawName, svc.build ? 'Uses "build" without an image: build and push the image, then set "image".' : 'No image given.')
    }
    const labels = { 'app.kubernetes.io/name': name }

    // Ports: container ports for every mapping, a Service when anything is published or exposed
    const ports: PortMapping[] = [
      ...(svc.ports ?? []).flatMap(parsePort),
      ...(svc.expose ?? []).flatMap((p: unknown) => parsePort(String(p).split(':').pop())),
    ]
    const uniquePorts = ports.filter((p, i) => ports.findIndex(q => q.containerPort === p.containerPort && q.protocol === p.protocol) === i)

    // Volumes
    const volumeMounts: any[] = []
    const volumes: any[] = []
    for (const [i, entry] of (svc.volumes ?? []).entries()) {
      const v: any = typeof entry === 'string' ? (() => {
        const [source, target, mode] = entry.split(':')
        return target ? { source, target, read_only: mode?.split(',').includes('ro'), type: /^[./~]/.test(source) ? 'bind' : 'volume' } : { target: source, type: 'volume' }
      })() : entry
      const volumeName = `${name}-${v.type === 'volume' && v.source ? k8sName(v.source) : `vol${i}`}`
      if (v.type === 'bind') {
        warn(rawName, `Bind mount ${v.source} → ${v.target} has no direct equivalent; it became an emptyDir. Use a ConfigMap/Secret for config files, or a PVC for data.`)
        volumes.push({ name: volumeName, emptyDir: {} })
      } else if (v.type === 'tmpfs') {
        volumes.push({ name: volumeName, emptyDir: { medium: 'Memory' } })
      } else if (v.source) {
        const claim = k8sName(v.source)
        if (!claims.has(claim)) {
          claims.set(claim, {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: meta(claim),
            spec: {
              accessModes: ['ReadWriteOnce'],
              ...(options.storageClass.trim() ? { storageClassName: options.storageClass.trim() } : {}),
              resources: { requests: { storage: options.storageSize || '1Gi' } },
            },
          })
        } else {
          warn(rawName, `Volume "${v.source}" is shared with another service; ReadWriteOnce allows that only on the same node.`)
        }
        volumes.push({ name: volumeName, persistentVolumeClaim: { claimName: claim } })
      } else {
        // Anonymous volume: scratch space for the container
        volumes.push({ name: volumeName, emptyDir: {} })
      }
      volumeMounts.push({ name: volumeName, mountPath: v.target, ...(v.read_only ? { readOnly: true } : {}) })
    }
    for (const [i, path] of (Array.isArray(svc.tmpfs) ? svc.tmpfs : svc.tmpfs ? [svc.tmpfs] : []).entries()) {
      const volumeName = `${name}-tmpfs${i}`
      volumes.push({ name: volumeName, emptyDir: { medium: 'Memory' } })
      volumeMounts.push({ name: volumeName, mountPath: String(path).split(':')[0] })
    }

    // Health check -> liveness probe
    let livenessProbe: any
    const hc = svc.healthcheck
    if (hc && !hc.disable && hc.test && hc.test !== 'NONE' && hc.test?.[0] !== 'NONE') {
      const test = Array.isArray(hc.test) ? hc.test : ['CMD-SHELL', hc.test]
      const command = test[0] === 'CMD-SHELL' ? ['sh', '-c', test.slice(1).join(' ')] : test[0] === 'CMD' ? test.slice(1) : test
      livenessProbe = {
        exec: { command },
        ...(seconds(hc.interval) ? { periodSeconds: seconds(hc.interval) } : {}),
        ...(seconds(hc.timeout) ? { timeoutSeconds: seconds(hc.timeout) } : {}),
        ...(hc.retries ? { failureThreshold: Number(hc.retries) } : {}),
        ...(seconds(hc.start_period) ? { initialDelaySeconds: seconds(hc.start_period) } : {}),
      }
    }

    // Resources
    const limits = svc.deploy?.resources?.limits ?? {}
    const reservations = svc.deploy?.resources?.reservations ?? {}
    const res = (r: any) => ({
      ...(r.cpus ? { cpu: String(r.cpus) } : {}),
      ...(r.memory ? { memory: memory(r.memory) } : {}),
    })
    const resources = {
      ...(Object.keys(res(reservations)).length ? { requests: res(reservations) } : {}),
      ...(Object.keys(res(limits)).length ? { limits: res(limits) } : {}),
      ...(svc.mem_limit ? { limits: { ...res(limits), memory: memory(svc.mem_limit) } } : {}),
    }

    // Security
    const securityContext: any = options.restrictedSecurity
      ? { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } }
      : {}
    if (svc.privileged) securityContext.privileged = true
    if (svc.read_only) securityContext.readOnlyRootFilesystem = true
    if (svc.cap_add || svc.cap_drop) {
      securityContext.capabilities = {
        ...(svc.cap_add ? { add: svc.cap_add } : {}),
        ...(svc.cap_drop || options.restrictedSecurity ? { drop: options.restrictedSecurity ? ['ALL'] : svc.cap_drop } : {}),
      }
    }
    if (options.restrictedSecurity) {
      securityContext.runAsNonRoot = true
      if (svc.privileged || svc.cap_add) warn(rawName, 'privileged / cap_add conflict with the restricted profile; the pod will be rejected where it is enforced.')
      if (svc.user === undefined) warn(rawName, 'runAsNonRoot: the image must run as a non-root user, otherwise the pod will not start (set "user" or use a non-root image).')
    }
    if (svc.user !== undefined) {
      const [uid, gid] = String(svc.user).split(':')
      if (/^\d+$/.test(uid)) securityContext.runAsUser = Number(uid)
      else warn(rawName, `user "${svc.user}" is a name; Kubernetes needs a numeric UID (runAsUser).`)
      if (gid && /^\d+$/.test(gid)) securityContext.runAsGroup = Number(gid)
    }

    const container = {
      name,
      image: svc.image ?? `${name}:latest`,
      ...(toArgs(svc.entrypoint) ? { command: toArgs(svc.entrypoint) } : {}),
      ...(toArgs(svc.command) ? { args: toArgs(svc.command) } : {}),
      ...(svc.working_dir ? { workingDir: svc.working_dir } : {}),
      ...(envList(svc.environment).length ? { env: envList(svc.environment) } : {}),
      ...(uniquePorts.length
        ? { ports: uniquePorts.map(p => ({ containerPort: p.containerPort, ...(p.protocol === 'UDP' ? { protocol: 'UDP' } : {}) })) }
        : {}),
      ...(volumeMounts.length ? { volumeMounts } : {}),
      ...(livenessProbe ? { livenessProbe } : {}),
      ...(Object.keys(resources).length ? { resources } : {}),
      ...(Object.keys(securityContext).length ? { securityContext } : {}),
      ...(svc.stdin_open ? { stdin: true } : {}),
      ...(svc.tty ? { tty: true } : {}),
    }

    const extraHosts = Array.isArray(svc.extra_hosts)
      ? svc.extra_hosts.map((h: string) => h.split(/[:=](?=[^:=]*$)/))
      : Object.entries(svc.extra_hosts ?? {})
    const podSpec = {
      ...(svc.hostname ? { hostname: k8sName(svc.hostname) } : {}),
      ...(svc.network_mode === 'host' ? { hostNetwork: true } : {}),
      ...(extraHosts.length ? { hostAliases: extraHosts.map(([host, ip]: string[]) => ({ ip, hostnames: [host] })) } : {}),
      containers: [container],
      ...(volumes.length ? { volumes } : {}),
    }

    docs.push({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: meta(name, labels),
      spec: {
        replicas: Number(svc.deploy?.replicas ?? svc.scale ?? 1),
        selector: { matchLabels: labels },
        // A PVC is ReadWriteOnce: replace pods instead of running old and new side by side
        ...(claims.size && volumes.some(v => v.persistentVolumeClaim) ? { strategy: { type: 'Recreate' } } : {}),
        template: { metadata: { labels }, spec: podSpec },
      },
    })

    if (uniquePorts.length) {
      docs.push({
        apiVersion: 'v1',
        kind: 'Service',
        metadata: meta(name, labels),
        spec: {
          ...(options.serviceType !== 'ClusterIP' ? { type: options.serviceType } : {}),
          selector: labels,
          ports: uniquePorts.map(p => {
            const published = ports.find(q => q.containerPort === p.containerPort && q.hostPort)?.hostPort
            return {
              name: `${p.protocol.toLowerCase()}-${p.containerPort}`,
              port: published ?? p.containerPort,
              targetPort: p.containerPort,
              ...(p.protocol === 'UDP' ? { protocol: 'UDP' } : {}),
            }
          }),
        },
      })
    }

    // Things that have no direct equivalent
    if (svc.env_file) warn(rawName, `env_file (${[].concat(svc.env_file).join(', ')}) can't be read here: add those variables to "env", or create a ConfigMap/Secret and use envFrom.`)
    if (svc.secrets) warn(rawName, 'secrets: create Kubernetes Secrets and mount them as volumes or env vars.')
    if (svc.configs) warn(rawName, 'configs: create ConfigMaps and mount them as volumes.')
    if (svc.depends_on) warn(rawName, 'depends_on has no equivalent: pods start in any order, so the app should retry connections (or use an initContainer that waits).')
    if (svc.restart === 'no' || svc.restart === 'on-failure') {
      warn(rawName, `restart: ${svc.restart}: a Deployment always restarts its pods. Use a Job for a one-off task.`)
    }
    if (svc.network_mode === 'host') warn(rawName, 'network_mode: host became hostNetwork: true; ports then bind on the node itself.')
    if (svc.networks) warn(rawName, 'networks are not converted: all pods share the cluster network; use NetworkPolicies to restrict traffic.')
    if (svc.devices) warn(rawName, 'devices are not converted (needs a device plugin or privileged hostPath).')
    if (svc.labels) warn(rawName, 'Container labels are not converted.')
    if (ports.some(p => p.hostPort) && options.serviceType === 'ClusterIP') {
      warn(rawName, 'Published ports are reachable inside the cluster only (Service type ClusterIP). Choose NodePort/LoadBalancer, or add an Ingress.')
    }
  }

  docs.push(...claims.values())
  if (compose.secrets) warn(null, 'Top-level secrets are not converted.')
  if (compose.configs) warn(null, 'Top-level configs are not converted.')

  // Namespace first, then claims, then per service Deployment + Service
  const order = (kind: string) => ({ Namespace: 0, PersistentVolumeClaim: 1 }[kind] ?? 2)
  docs.sort((a, b) => order(a.kind) - order(b.kind))

  return {
    // YAML 1.1 rules, as Kubernetes reads them: strings like "no" or "on" get quoted
    yaml: docs.map(doc => stringify(doc, { version: '1.1', lineWidth: 0, aliasDuplicateObjects: false })).join('---\n'),
    objects: docs.map(doc => ({ kind: doc.kind, name: doc.metadata.name })),
    warnings,
    error: null,
  }
}
