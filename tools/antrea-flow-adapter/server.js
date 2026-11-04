import http from 'node:http'
import dgram from 'node:dgram'
import net from 'node:net'
import { URL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const createIpfixDeserializer = require('ipfix_node')

const PORT = Number(process.env.PORT || 8081)
const HOST = process.env.HOST || '0.0.0.0'
const ADAPTER_TOKEN = process.env.ADAPTER_TOKEN || ''
const UPSTREAM_URL = process.env.UPSTREAM_URL || ''
const UPSTREAM_TOKEN = process.env.UPSTREAM_TOKEN || ''
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 8000)
const IPFIX_PORT = Number(process.env.IPFIX_PORT || 4739)
const IPFIX_HOST = process.env.IPFIX_HOST || '0.0.0.0'
const IPFIX_ENABLE_UDP = process.env.IPFIX_ENABLE_UDP !== 'false'
const IPFIX_ENABLE_TCP = process.env.IPFIX_ENABLE_TCP !== 'false'
const IPFIX_SUPPRESS_LIBRARY_ERRORS = process.env.IPFIX_SUPPRESS_LIBRARY_ERRORS !== 'false'
const FLOW_TTL_MS = Number(process.env.FLOW_TTL_MS || 5 * 60 * 1000)
const DIAGNOSTICS_LOG_INTERVAL_MS = Number(process.env.DIAGNOSTICS_LOG_INTERVAL_MS || 60000)
const ANTREA_ENTERPRISE_ID = 56506
const REVERSE_IANA_ENTERPRISE_ID = 29305

const ACTION_MAP = {
  allow: 'Allow',
  allowed: 'Allow',
  accept: 'Allow',
  accepted: 'Allow',
  pass: 'Allow',
  drop: 'Drop',
  denied: 'Drop',
  deny: 'Drop',
  reject: 'Reject',
  rejected: 'Reject'
}

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

const getPathValue = (record, path) => {
  const parts = path.split('.')
  let value = record
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined
    value = value[part]
  }
  return value
}

const pickFirst = (record, paths) => {
  for (const path of paths) {
    const value = getPathValue(record, path)
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return undefined
}

const normalizeAction = (value) => {
  if (value === 1 || value === '1') return 'Allow'
  if (value === 2 || value === '2') return 'Drop'
  if (value === 3 || value === '3') return 'Reject'

  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'Unknown'

  if (ACTION_MAP[raw]) {
    return ACTION_MAP[raw]
  }

  for (const [key, mapped] of Object.entries(ACTION_MAP)) {
    if (raw.includes(key)) {
      return mapped
    }
  }

  return 'Unknown'
}

const sanitizeName = (value) => String(value || '').replace(/[^a-zA-Z0-9-]/g, '-')

const toNodeId = (typeHint, namespace, name) => {
  const type = String(typeHint || '').toLowerCase()
  const ns = sanitizeName(namespace || 'default')
  const resourceName = sanitizeName(name)

  if (type.includes('external') || type === 'ip' || type === 'address') {
    return `external-${resourceName}`
  }

  if (type.includes('service') || type === 'svc') {
    return `service-${ns}-${resourceName}`
  }

  return `pod-${ns}-${resourceName}`
}

const parseNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

const parsePort = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const rounded = Math.trunc(numeric)
  if (rounded < 1 || rounded > 65535) return null
  return rounded
}

const mergePorts = (existing = [], incoming = []) => {
  const merged = [...existing, ...incoming]
    .map((port) => parsePort(port))
    .filter((port) => port !== null)
  return Array.from(new Set(merged))
}

const normalizeLookupKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const collectLooseFields = (value, sink = new Map(), path = []) => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectLooseFields(value[index], sink, path)
    }
    return sink
  }

  if (!value || typeof value !== 'object') {
    return sink
  }

  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key]
    if (nested !== null && typeof nested === 'object') {
      collectLooseFields(nested, sink, nextPath)
      continue
    }

    const normalizedPath = normalizeLookupKey(nextPath.join('.'))
    const normalizedKey = normalizeLookupKey(key)

    if (!sink.has(normalizedPath)) {
      sink.set(normalizedPath, nested)
    }
    if (!sink.has(normalizedKey)) {
      sink.set(normalizedKey, nested)
    }
  }

  return sink
}

const pickFirstLoose = (record, paths) => {
  const fieldMap = collectLooseFields(record)
  for (const path of paths) {
    const normalizedPath = normalizeLookupKey(path)
    if (fieldMap.has(normalizedPath)) {
      const value = fieldMap.get(normalizedPath)
      if (value !== undefined && value !== null && value !== '') {
        return value
      }
    }

    const normalizedLeaf = normalizeLookupKey(path.split('.').pop())
    if (fieldMap.has(normalizedLeaf)) {
      const value = fieldMap.get(normalizedLeaf)
      if (value !== undefined && value !== null && value !== '') {
        return value
      }
    }
  }
  return undefined
}

const diagnostics = {
  packetsReceived: 0,
  packetsParsed: 0,
  parseErrors: 0,
  recordsSeen: 0,
  recordsNormalized: 0,
  recordsDropped: 0,
  lastPacketAt: null,
  lastFlowAt: null,
  lastError: null
}

const templateStoreBySource = new Map()

const getTemplateStoreForSource = (sourceKey) => {
  const key = sourceKey || 'default'
  if (!templateStoreBySource.has(key)) {
    templateStoreBySource.set(key, new Map())
  }
  return templateStoreBySource.get(key)
}

const IE_NAME_MAP = new Map([
  ['0:1', 'octetDeltaCount'],
  ['0:2', 'packetDeltaCount'],
  ['0:4', 'protocolIdentifier'],
  ['0:7', 'sourceTransportPort'],
  ['0:8', 'sourceIPv4Address'],
  ['0:11', 'destinationTransportPort'],
  ['0:12', 'destinationIPv4Address'],
  ['0:27', 'sourceIPv6Address'],
  ['0:28', 'destinationIPv6Address'],
  ['0:85', 'octetTotalCount'],
  ['0:86', 'packetTotalCount'],
  [`${REVERSE_IANA_ENTERPRISE_ID}:1`, 'reverseOctetDeltaCount'],
  [`${REVERSE_IANA_ENTERPRISE_ID}:2`, 'reversePacketDeltaCount'],
  [`${REVERSE_IANA_ENTERPRISE_ID}:85`, 'reverseOctetTotalCount'],
  [`${REVERSE_IANA_ENTERPRISE_ID}:86`, 'reversePacketTotalCount'],
  ['0:150', 'flowStartSeconds'],
  ['0:151', 'flowEndSeconds'],
  [`${ANTREA_ENTERPRISE_ID}:100`, 'sourcePodNamespace'],
  [`${ANTREA_ENTERPRISE_ID}:101`, 'sourcePodName'],
  [`${ANTREA_ENTERPRISE_ID}:102`, 'destinationPodNamespace'],
  [`${ANTREA_ENTERPRISE_ID}:103`, 'destinationPodName'],
  [`${ANTREA_ENTERPRISE_ID}:106`, 'destinationClusterIPv4'],
  [`${ANTREA_ENTERPRISE_ID}:107`, 'destinationClusterIPv6'],
  [`${ANTREA_ENTERPRISE_ID}:108`, 'destinationServicePort'],
  [`${ANTREA_ENTERPRISE_ID}:109`, 'destinationServicePortName'],
  [`${ANTREA_ENTERPRISE_ID}:139`, 'ingressNetworkPolicyRuleAction'],
  [`${ANTREA_ENTERPRISE_ID}:140`, 'egressNetworkPolicyRuleAction'],
  [`${ANTREA_ENTERPRISE_ID}:120`, 'packetTotalCountFromSourceNode'],
  [`${ANTREA_ENTERPRISE_ID}:121`, 'octetTotalCountFromSourceNode'],
  [`${ANTREA_ENTERPRISE_ID}:122`, 'packetDeltaCountFromSourceNode'],
  [`${ANTREA_ENTERPRISE_ID}:123`, 'octetDeltaCountFromSourceNode'],
  [`${ANTREA_ENTERPRISE_ID}:128`, 'packetTotalCountFromDestinationNode'],
  [`${ANTREA_ENTERPRISE_ID}:129`, 'octetTotalCountFromDestinationNode'],
  [`${ANTREA_ENTERPRISE_ID}:130`, 'packetDeltaCountFromDestinationNode'],
  [`${ANTREA_ENTERPRISE_ID}:131`, 'octetDeltaCountFromDestinationNode']
  ,[`${ANTREA_ENTERPRISE_ID}:124`, 'reversePacketTotalCountFromSourceNode']
  ,[`${ANTREA_ENTERPRISE_ID}:125`, 'reverseOctetTotalCountFromSourceNode']
  ,[`${ANTREA_ENTERPRISE_ID}:126`, 'reversePacketDeltaCountFromSourceNode']
  ,[`${ANTREA_ENTERPRISE_ID}:127`, 'reverseOctetDeltaCountFromSourceNode']
  ,[`${ANTREA_ENTERPRISE_ID}:132`, 'reversePacketTotalCountFromDestinationNode']
  ,[`${ANTREA_ENTERPRISE_ID}:133`, 'reverseOctetTotalCountFromDestinationNode']
  ,[`${ANTREA_ENTERPRISE_ID}:134`, 'reversePacketDeltaCountFromDestinationNode']
  ,[`${ANTREA_ENTERPRISE_ID}:135`, 'reverseOctetDeltaCountFromDestinationNode']
])

const readUnsigned = (buffer) => {
  if (buffer.length === 0) return 0
  if (buffer.length === 1) return buffer.readUInt8(0)
  if (buffer.length === 2) return buffer.readUInt16BE(0)
  if (buffer.length === 4) return buffer.readUInt32BE(0)
  if (buffer.length === 8) {
    const value = buffer.readBigUInt64BE(0)
    return Number(value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : BigInt(Number.MAX_SAFE_INTEGER))
  }

  let value = BigInt(0)
  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << BigInt(8)) + BigInt(buffer[i])
  }
  return Number(value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : BigInt(Number.MAX_SAFE_INTEGER))
}

const decodeIpv4 = (buffer) => {
  if (buffer.length < 4) return ''
  return `${buffer[0]}.${buffer[1]}.${buffer[2]}.${buffer[3]}`
}

const decodeIpv6 = (buffer) => {
  if (buffer.length < 16) return ''
  const parts = []
  for (let i = 0; i < 16; i += 2) {
    parts.push(buffer.readUInt16BE(i).toString(16))
  }
  return parts.join(':')
}

const decodeFieldValue = (field, valueBuffer) => {
  const key = `${field.enterpriseId || 0}:${field.fieldId}`
  const mappedName = IE_NAME_MAP.get(key)

  if (mappedName && mappedName.toLowerCase().includes('name')) {
    return valueBuffer.toString('utf8').replace(/\u0000+$/g, '').trim()
  }

  if (mappedName && mappedName.toLowerCase().includes('namespace')) {
    return valueBuffer.toString('utf8').replace(/\u0000+$/g, '').trim()
  }

  if (mappedName && mappedName.toLowerCase().includes('ipv4')) {
    return decodeIpv4(valueBuffer)
  }

  if (mappedName && mappedName.toLowerCase().includes('ipv6')) {
    return decodeIpv6(valueBuffer)
  }

  if (mappedName && (mappedName.toLowerCase().includes('count') || mappedName.toLowerCase().includes('port') || mappedName.toLowerCase().includes('action') || mappedName.toLowerCase().includes('seconds'))) {
    return readUnsigned(valueBuffer)
  }

  if (valueBuffer.length >= 1 && valueBuffer.length <= 8) {
    return readUnsigned(valueBuffer)
  }

  return valueBuffer.toString('utf8').replace(/\u0000+$/g, '').trim()
}

const decodeDataRecord = (recordBuffer, templateFields) => {
  let offset = 0
  const output = {}

  for (const field of templateFields) {
    let length = field.fieldLength
    if (length === 65535) {
      if (offset >= recordBuffer.length) return null
      const first = recordBuffer.readUInt8(offset)
      offset += 1
      if (first < 255) {
        length = first
      } else {
        if (offset + 2 > recordBuffer.length) return null
        length = recordBuffer.readUInt16BE(offset)
        offset += 2
      }
    }

    if (offset + length > recordBuffer.length) {
      return null
    }

    const valueBuffer = recordBuffer.subarray(offset, offset + length)
    offset += length

    const ieKey = `${field.enterpriseId || 0}:${field.fieldId}`
    const ieName = IE_NAME_MAP.get(ieKey) || `ie_${ieKey.replace(':', '_')}`
    output[ieName] = decodeFieldValue(field, valueBuffer)
  }

  return {
    record: output,
    bytesRead: offset
  }
}

const parseTemplateSet = (setBuffer, templateStore) => {
  let offset = 0
  while (offset + 4 <= setBuffer.length) {
    const templateId = setBuffer.readUInt16BE(offset)
    const fieldCount = setBuffer.readUInt16BE(offset + 2)
    offset += 4

    const fields = []
    for (let index = 0; index < fieldCount; index += 1) {
      if (offset + 4 > setBuffer.length) {
        return
      }

      const fieldIdRaw = setBuffer.readUInt16BE(offset)
      const fieldLength = setBuffer.readUInt16BE(offset + 2)
      offset += 4

      const isEnterprise = (fieldIdRaw & 0x8000) !== 0
      let enterpriseId = 0
      const fieldId = fieldIdRaw & 0x7fff

      if (isEnterprise) {
        if (offset + 4 > setBuffer.length) {
          return
        }
        enterpriseId = setBuffer.readUInt32BE(offset)
        offset += 4
      }

      fields.push({ fieldId, fieldLength, enterpriseId })
    }

    templateStore.set(templateId, fields)
  }
}

const parseDataSet = (templateId, setBuffer, templateStore) => {
  const templateFields = templateStore.get(templateId)
  if (!templateFields || templateFields.length === 0) {
    return []
  }

  let offset = 0
  const records = []

  while (offset < setBuffer.length) {
    const decoded = decodeDataRecord(setBuffer.subarray(offset), templateFields)
    if (!decoded || !decoded.record) {
      break
    }

    records.push(decoded.record)
    if (!decoded.bytesRead || decoded.bytesRead <= 0) {
      break
    }

    offset += decoded.bytesRead
  }

  return records
}

const parseAntreaIpfixRecords = (packetBuffer, sourceKey) => {
  if (!packetBuffer || packetBuffer.length < 16) {
    return []
  }

  const version = packetBuffer.readUInt16BE(0)
  if (version !== 10) {
    return []
  }

  const packetLength = packetBuffer.readUInt16BE(2)
  const end = Math.min(packetLength, packetBuffer.length)
  let offset = 16
  const templateStore = getTemplateStoreForSource(sourceKey)
  const parsedRecords = []

  while (offset + 4 <= end) {
    const setId = packetBuffer.readUInt16BE(offset)
    const setLength = packetBuffer.readUInt16BE(offset + 2)

    if (setLength < 4 || offset + setLength > end) {
      break
    }

    const setBody = packetBuffer.subarray(offset + 4, offset + setLength)

    if (setId === 2) {
      parseTemplateSet(setBody, templateStore)
    } else if (setId >= 256) {
      const records = parseDataSet(setId, setBody, templateStore)
      parsedRecords.push(...records)
    }

    offset += setLength
  }

  return parsedRecords
}

const flowStore = new Map()

const upsertFlow = (flow) => {
  const key = `${flow.sourceId}->${flow.targetId}`
  const existing = flowStore.get(key)

  if (!existing) {
    flowStore.set(key, {
      ...flow,
      sourcePort: parsePort(flow.sourcePort),
      targetPort: parsePort(flow.targetPort),
      ports: mergePorts([], flow.ports || [flow.targetPort]),
      updatedAt: Date.now()
    })
    return
  }

  const action =
    existing.action === 'Drop' || flow.action === 'Drop'
      ? 'Drop'
      : existing.action === 'Reject' || flow.action === 'Reject'
        ? 'Reject'
        : existing.action === 'Allow' || flow.action === 'Allow'
          ? 'Allow'
          : 'Unknown'

  flowStore.set(key, {
    ...existing,
    action,
    packets: existing.packets + flow.packets,
    bytes: existing.bytes + flow.bytes,
    sourcePort: parsePort(flow.sourcePort) ?? existing.sourcePort,
    targetPort: parsePort(flow.targetPort) ?? existing.targetPort,
    ports: mergePorts(existing.ports || [], flow.ports || [flow.targetPort]),
    lastSeen: flow.lastSeen || existing.lastSeen,
    updatedAt: Date.now()
  })
}

const cleanupStaleFlows = () => {
  const now = Date.now()
  for (const [key, value] of flowStore.entries()) {
    if (now - value.updatedAt > FLOW_TTL_MS) {
      flowStore.delete(key)
    }
  }
}

setInterval(cleanupStaleFlows, Math.max(10000, Math.floor(FLOW_TTL_MS / 2))).unref()

const flattenRecordCandidates = (value, sink = []) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      flattenRecordCandidates(item, sink)
    }
    return sink
  }

  if (!value || typeof value !== 'object') {
    return sink
  }

  const objectValue = value
  const keySet = new Set(Object.keys(objectValue).map((key) => key.toLowerCase()))
  const hasLikelyFlowFields =
    keySet.has('sourcepodname') ||
    keySet.has('destinationpodname') ||
    keySet.has('destinationservicename') ||
    keySet.has('sourcepodnamespace') ||
    keySet.has('destinationpodnamespace') ||
    keySet.has('sourceipv4address') ||
    keySet.has('destinationipv4address') ||
    keySet.has('sourceipv6address') ||
    keySet.has('destinationipv6address') ||
    keySet.has('source') ||
    keySet.has('destination')

  if (hasLikelyFlowFields) {
    sink.push(objectValue)
  }

  for (const nested of Object.values(objectValue)) {
    flattenRecordCandidates(nested, sink)
  }

  return sink
}

const normalizeRecord = (record) => {
  const pick = (paths) => pickFirst(record, paths) ?? pickFirstLoose(record, paths)

  const sourceNamespace = pick([
    'source.namespace',
    'sourcePodNamespace',
    'sourceKubernetesNamespace',
    'source_namespace',
    'sourceNamespace',
    'src.namespace',
    'srcNamespace',
    'flow.source.namespace'
  ])

  const sourcePod = pick([
    'source.pod',
    'source.podName',
    'sourcePodName',
    'sourcePod',
    'sourcePodName',
    'source_pod_name',
    'src.pod',
    'srcPod',
    'flow.source.pod'
  ])

  const destinationNamespace = pick([
    'destination.namespace',
    'destinationPodNamespace',
    'destinationServiceNamespace',
    'destination_namespace',
    'destinationNamespace',
    'dst.namespace',
    'dstNamespace',
    'flow.destination.namespace'
  ])

  const destinationPod = pick([
    'destination.pod',
    'destination.podName',
    'destinationPodName',
    'destinationPod',
    'destinationPodName',
    'destination_pod_name',
    'dst.pod',
    'dstPod',
    'flow.destination.pod'
  ])

  const destinationService = pick([
    'destination.service',
    'destination.serviceName',
    'destinationServiceName',
    'destinationService',
    'destinationServiceName',
    'destination_service_name',
    'dst.service',
    'dstService',
    'flow.destination.service'
  ])

  const sourceIp = pick([
    'sourceIPv4Address',
    'sourceIPv6Address',
    'source.ip',
    'src.ip',
    'flow.source.ip'
  ])

  const destinationIp = pick([
    'destinationIPv4Address',
    'destinationIPv6Address',
    'destination.ip',
    'dst.ip',
    'flow.destination.ip'
  ])

  const hasSource = Boolean((sourceNamespace && sourcePod) || sourceIp)
  const hasDestination = Boolean((destinationNamespace && (destinationPod || destinationService)) || destinationIp)

  const sourcePort = parsePort(pick([
    'sourceTransportPort',
    'source.transportPort',
    'sourcePort',
    'src.port',
    'flow.source.port'
  ]))

  const targetPort = parsePort(pick([
    'destinationTransportPort',
    'destinationServicePort',
    'destination.transportPort',
    'destinationPort',
    'dst.port',
    'flow.destination.port'
  ]))

  const ports = [targetPort, sourcePort].filter((port) => port !== null)

  if (!hasSource || !hasDestination) {
    return null
  }

  const sourceType = sourcePod
    ? (pick(['source.type', 'sourceKind', 'src.type', 'srcKind']) || 'pod')
    : 'external'

  const destinationType = destinationService
    ? 'service'
    : destinationPod
      ? (pick(['destination.type', 'destinationKind', 'dst.type', 'dstKind']) || 'pod')
      : 'external'

  const sourceNamespaceForId = sourcePod ? sourceNamespace : 'external'
  const sourceNameForId = sourcePod || sourceIp
  const destinationNamespaceForId = (destinationService || destinationPod) ? destinationNamespace : 'external'
  const destinationNameForId = destinationService || destinationPod || destinationIp

  return {
    sourceId: toNodeId(sourceType, sourceNamespaceForId, sourceNameForId),
    targetId: toNodeId(destinationType, destinationNamespaceForId, destinationNameForId),
    sourcePort,
    targetPort,
    ports,
    action: normalizeAction(pick([
      'action',
      'verdict',
      'disposition',
      'policyAction',
      'networkPolicyRuleAction',
      'ingressNetworkPolicyRuleAction',
      'egressNetworkPolicyRuleAction',
      'flow.action'
    ])),
    packets: parseNumber(pick([
      'packets',
      'packetCount',
      'totalPackets',
      'packetTotalCount',
      'packetDeltaCount',
      'packetTotalCountFromSourceNode',
      'packetDeltaCountFromSourceNode',
      'packetTotalCountFromDestinationNode',
      'packetDeltaCountFromDestinationNode',
      'reversePacketTotalCount',
      'reversePacketDeltaCount',
      'reversePacketTotalCountFromSourceNode',
      'reversePacketDeltaCountFromSourceNode',
      'reversePacketTotalCountFromDestinationNode',
      'reversePacketDeltaCountFromDestinationNode',
      'flow.packets'
    ])),
    bytes: parseNumber(pick([
      'bytes',
      'byteCount',
      'totalBytes',
      'octetTotalCount',
      'octetDeltaCount',
      'octetTotalCountFromSourceNode',
      'octetDeltaCountFromSourceNode',
      'octetTotalCountFromDestinationNode',
      'octetDeltaCountFromDestinationNode',
      'reverseOctetTotalCount',
      'reverseOctetDeltaCount',
      'reverseOctetTotalCountFromSourceNode',
      'reverseOctetDeltaCountFromSourceNode',
      'reverseOctetTotalCountFromDestinationNode',
      'reverseOctetDeltaCountFromDestinationNode',
      'flow.bytes'
    ])),
    lastSeen: pick(['lastSeen', 'endTime', 'timestamp', 'flow.endTime', 'flowEndSeconds', 'flowStartSeconds'])
  }
}

const aggregateFlows = (flows) => {
  const map = new Map()

  for (const flow of flows) {
    const key = `${flow.sourceId}->${flow.targetId}`
    const existing = map.get(key)

    if (!existing) {
      map.set(key, {
        ...flow,
        sourcePort: parsePort(flow.sourcePort),
        targetPort: parsePort(flow.targetPort),
        ports: mergePorts([], flow.ports || [flow.targetPort])
      })
      continue
    }

    const action =
      existing.action === 'Drop' || flow.action === 'Drop'
        ? 'Drop'
        : existing.action === 'Reject' || flow.action === 'Reject'
          ? 'Reject'
          : existing.action === 'Allow' || flow.action === 'Allow'
            ? 'Allow'
            : 'Unknown'

    map.set(key, {
      ...existing,
      action,
      packets: existing.packets + flow.packets,
      bytes: existing.bytes + flow.bytes,
      sourcePort: parsePort(flow.sourcePort) ?? existing.sourcePort,
      targetPort: parsePort(flow.targetPort) ?? existing.targetPort,
      ports: mergePorts(existing.ports || [], flow.ports || [flow.targetPort]),
      lastSeen: flow.lastSeen || existing.lastSeen
    })
  }

  return Array.from(map.values())
}

const getStoredFlows = () => {
  cleanupStaleFlows()
  return Array.from(flowStore.values()).map(({ updatedAt, ...flow }) => flow)
}

const sanitizeFlowsForResponse = (flows = []) =>
  flows.map(({ ports, ...flow }) => flow)

const exporterDeserializers = new Map()

const getDeserializerForSource = (sourceKey) => {
  const key = sourceKey || 'default'
  if (!exporterDeserializers.has(key)) {
    exporterDeserializers.set(key, createIpfixDeserializer())
  }
  return exporterDeserializers.get(key)
}

const isExpectedTemplateError = (message) => {
  const value = String(message || '').toLowerCase()
  return value.includes('template with id') || value.includes("couldn't deserialize template")
}

const TEMPLATE_NOISE_PATTERNS = [
  /^couldn't deserialize template with id\s+\d+/i,
  /^template with id\s+\d+\s+has invalid structure\s*!?/i
]

const isTemplateNoiseLog = (message) => {
  const text = String(message || '').trim()
  return TEMPLATE_NOISE_PATTERNS.some((pattern) => pattern.test(text))
}

let deserializationChain = Promise.resolve()

const enqueueDeserialization = async (task) => {
  const run = deserializationChain.then(task, task)
  deserializationChain = run.catch(() => undefined)
  return run
}

const deserializeWithSuppressedTemplateNoise = async (deserializer, buffer) => {
  return enqueueDeserialization(async () => {
    const originalConsoleError = console.error

    console.error = (...args) => {
      if (IPFIX_SUPPRESS_LIBRARY_ERRORS) {
        return
      }

      const combined = args.map((value) => String(value)).join(' ')
      if (isTemplateNoiseLog(combined)) {
        return
      }
      originalConsoleError(...args)
    }

    try {
      return await deserializer.deserialize(buffer)
    } finally {
      console.error = originalConsoleError
    }
  })
}

const extractIpfixPackets = (buffer) => {
  const packets = []
  let offset = 0

  while (buffer.length - offset >= 16) {
    const version = buffer.readUInt16BE(offset)
    if (version !== 10) {
      offset += 1
      continue
    }

    const length = buffer.readUInt16BE(offset + 2)
    if (!Number.isFinite(length) || length < 16) {
      offset += 1
      continue
    }

    if (offset + length > buffer.length) {
      break
    }

    packets.push(buffer.subarray(offset, offset + length))
    offset += length
  }

  return {
    packets,
    remainder: buffer.subarray(offset)
  }
}

const resolveUpstreamUrl = ({ clusterId, namespace, window }) => {
  if (!UPSTREAM_URL) {
    throw new Error('UPSTREAM_URL is not configured')
  }

  let resolved = UPSTREAM_URL
    .replaceAll('{clusterId}', encodeURIComponent(clusterId || ''))
    .replaceAll('{namespace}', encodeURIComponent(namespace || ''))
    .replaceAll('{window}', encodeURIComponent(window || '24h'))

  const url = new URL(resolved)

  if (!url.searchParams.has('clusterId') && clusterId) {
    url.searchParams.set('clusterId', clusterId)
  }
  if (!url.searchParams.has('namespace') && namespace) {
    url.searchParams.set('namespace', namespace)
  }
  if (!url.searchParams.has('window')) {
    url.searchParams.set('window', window || '24h')
  }

  return url.toString()
}

const fetchUpstreamRecords = async (query) => {
  const upstreamUrl = resolveUpstreamUrl(query)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers = { Accept: 'application/json' }
    if (UPSTREAM_TOKEN) {
      headers.Authorization = `Bearer ${UPSTREAM_TOKEN}`
    }

    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store'
    })

    if (!response.ok) {
      const details = await response.text()
      throw new Error(`Upstream responded with ${response.status}: ${details.slice(0, 300)}`)
    }

    const payload = await response.json()
    const records = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.flows)
        ? payload.flows
        : Array.isArray(payload?.records)
          ? payload.records
          : Array.isArray(payload?.data)
            ? payload.data
            : []

    return {
      upstreamUrl,
      records
    }
  } finally {
    clearTimeout(timeout)
  }
}

const ingestPacket = async ({ buffer, deserializer, sourceLabel }) => {
  diagnostics.packetsReceived += 1
  diagnostics.lastPacketAt = new Date().toISOString()

  try {
    const nativeParsedRecords = parseAntreaIpfixRecords(buffer, sourceLabel)
    if (nativeParsedRecords.length > 0) {
      diagnostics.packetsParsed += 1
      diagnostics.recordsSeen += nativeParsedRecords.length

      for (const record of nativeParsedRecords) {
        const normalized = normalizeRecord(record)
        if (normalized) {
          upsertFlow(normalized)
          diagnostics.recordsNormalized += 1
          diagnostics.lastFlowAt = new Date().toISOString()
        } else {
          diagnostics.recordsDropped += 1
        }
      }
      return
    }

    const parsed = await deserializeWithSuppressedTemplateNoise(deserializer, buffer)
    diagnostics.packetsParsed += 1

    const candidates = flattenRecordCandidates(parsed)
    diagnostics.recordsSeen += candidates.length

    for (const candidate of candidates) {
      const normalized = normalizeRecord(candidate)
      if (normalized) {
        upsertFlow(normalized)
        diagnostics.recordsNormalized += 1
        diagnostics.lastFlowAt = new Date().toISOString()
      } else {
        diagnostics.recordsDropped += 1
      }
    }
  } catch (error) {
    diagnostics.parseErrors += 1
    const message = error instanceof Error ? error.message : String(error)
    diagnostics.lastError = message
    if (!isExpectedTemplateError(message)) {
      console.warn(`Failed to parse IPFIX packet from ${sourceLabel || 'unknown'}:`, message)
    }
  }
}

setInterval(() => {
  if (diagnostics.packetsReceived === 0 && diagnostics.recordsSeen === 0) {
    return
  }

  console.log(
    '[adapter-stats]',
    JSON.stringify({
      packetsReceived: diagnostics.packetsReceived,
      packetsParsed: diagnostics.packetsParsed,
      parseErrors: diagnostics.parseErrors,
      recordsSeen: diagnostics.recordsSeen,
      recordsNormalized: diagnostics.recordsNormalized,
      recordsDropped: diagnostics.recordsDropped,
      storedFlows: flowStore.size,
      lastPacketAt: diagnostics.lastPacketAt,
      lastFlowAt: diagnostics.lastFlowAt
    })
  )
}, Math.max(10000, DIAGNOSTICS_LOG_INTERVAL_MS)).unref()

const startIpfixReceiver = () => {
  if (UPSTREAM_URL) {
    console.log('UPSTREAM_URL is configured; IPFIX receiver mode is optional and not started by default.')
    return
  }

  if (IPFIX_ENABLE_UDP) {
    const udpServer = dgram.createSocket('udp4')
    udpServer.on('error', (error) => {
      console.error('IPFIX UDP receiver error:', error)
    })
    udpServer.on('message', (message, rinfo) => {
      const sourceKey = `udp://${rinfo.address}:${rinfo.port}`
      ingestPacket({
        buffer: message,
        deserializer: getDeserializerForSource(sourceKey),
        sourceLabel: sourceKey
      })
    })
    udpServer.bind(IPFIX_PORT, IPFIX_HOST, () => {
      console.log(`IPFIX UDP receiver listening on ${IPFIX_HOST}:${IPFIX_PORT}`)
    })
  }

  if (IPFIX_ENABLE_TCP) {
    const tcpServer = net.createServer((socket) => {
      const sourceKey = `tcp://${socket.remoteAddress || 'unknown'}:${socket.remotePort || '0'}`
      const deserializer = getDeserializerForSource(sourceKey)
      let pending = Buffer.alloc(0)

      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk])

        if (pending.length > 4 * 1024 * 1024) {
          pending = Buffer.alloc(0)
          console.warn(`Dropped oversized TCP IPFIX buffer from ${sourceKey}`)
          return
        }

        const { packets, remainder } = extractIpfixPackets(pending)
        pending = remainder

        for (const packet of packets) {
          ingestPacket({
            buffer: packet,
            deserializer,
            sourceLabel: sourceKey
          })
        }
      })
      socket.on('error', (error) => {
        console.warn('IPFIX TCP socket error:', error)
      })
      socket.on('close', () => {
        exporterDeserializers.delete(sourceKey)
      })
    })

    tcpServer.on('error', (error) => {
      console.error('IPFIX TCP receiver error:', error)
    })

    tcpServer.listen(IPFIX_PORT, IPFIX_HOST, () => {
      console.log(`IPFIX TCP receiver listening on ${IPFIX_HOST}:${IPFIX_PORT}`)
    })
  }
}

const isAuthorized = (req) => {
  if (!ADAPTER_TOKEN) return true
  const authHeader = req.headers.authorization || ''
  return authHeader === `Bearer ${ADAPTER_TOKEN}`
}

const parseQuery = (reqUrl) => {
  const url = new URL(reqUrl, `http://${HOST}:${PORT}`)
  return {
    pathname: url.pathname,
    clusterId: url.searchParams.get('clusterId') || '',
    namespace: url.searchParams.get('namespace') || '',
    window: url.searchParams.get('window') || '24h'
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname, clusterId, namespace, window } = parseQuery(req.url || '/')

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'antrea-flow-adapter',
      upstreamConfigured: Boolean(UPSTREAM_URL),
      receiverMode: !UPSTREAM_URL,
      storedFlows: flowStore.size,
      diagnostics: {
        ...diagnostics
      }
    })
  }

  if (req.method === 'GET' && pathname === '/flows') {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { error: 'Unauthorized' })
    }

    try {
      if (UPSTREAM_URL) {
        const { upstreamUrl, records } = await fetchUpstreamRecords({
          clusterId,
          namespace,
          window
        })

        const normalized = records
          .map(normalizeRecord)
          .filter(Boolean)

        const flows = aggregateFlows(normalized)

        return sendJson(res, 200, {
          configured: true,
          namespace: namespace || 'all',
          window,
          source: upstreamUrl,
          flows: sanitizeFlowsForResponse(flows)
        })
      }

      return sendJson(res, 200, {
        configured: true,
        namespace: namespace || 'all',
        window,
        source: `ipfix://${IPFIX_HOST}:${IPFIX_PORT}`,
        flows: sanitizeFlowsForResponse(getStoredFlows())
      })
    } catch (error) {
      return sendJson(res, 502, {
        configured: Boolean(UPSTREAM_URL),
        error: error instanceof Error ? error.message : 'Failed to fetch upstream flow data',
        flows: []
      })
    }
  }

  return sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`Antrea flow adapter listening on http://${HOST}:${PORT}`)
  startIpfixReceiver()
})
