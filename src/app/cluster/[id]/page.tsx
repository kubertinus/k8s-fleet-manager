'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Archive, Ship, RefreshCw, Server, Cpu, HardDrive, Network, Shield, AlertTriangle, CheckCircle, XCircle, Clock, Activity, FileText, Database, Crown, Monitor, BarChart3, Key, Package, Users, User, Globe, Router, Wifi, Layers, ChevronUp, ChevronDown, ChevronRight, Minus, Eye, Edit, Trash2, Plus, Lock, Unlock, Zap, Settings, AlertOctagon, Info, TrendingUp, Target, Gauge } from 'lucide-react'
import AIChatbot from '@/components/AIChatbot'
import AppShell, { type ClusterNavItem } from '@/components/layout/AppShell'
import HelmReleases from '@/components/cluster/HelmReleases'
import GatewayApiSection from '@/components/cluster/GatewayApiSection'
import VeleroBackups from '@/components/cluster/VeleroBackups'
import HealthHistory from '@/components/cluster/HealthHistory'
import { setClusterStatus } from '@/lib/clusterStatus'
import { withoutNamespaces } from '@/lib/customerManaged'
import { useHideCustomerManaged } from '@/lib/useHideCustomerManaged'
import NetworkVisualizationNew from '@/components/NetworkVisualizationNew'

// Utility functions
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const safeParseFloat = (value: string | undefined | null): number => {
  if (!value || typeof value !== 'string') return 0
  const numericPart = parseFloat(value.replace(/[^0-9.]/g, ''))
  return isNaN(numericPart) ? 0 : numericPart
}

const normalizeCpuUsageCores = (usageValue: number, capacityValue: number): number => {
  if (!Number.isFinite(usageValue) || usageValue < 0) return 0

  const usage = Number(usageValue)
  const capacity = Number.isFinite(capacityValue) && capacityValue > 0 ? Number(capacityValue) : 0

  if (capacity <= 0) {
    return usage
  }

  const maxReasonableUsage = Math.max(capacity * 4, 1)
  const candidates = [usage, usage / 1000, usage / 1000000, usage / 1000000000]
  const plausible = candidates.find((candidate) => Number.isFinite(candidate) && candidate >= 0 && candidate <= maxReasonableUsage)

  return plausible ?? usage
}

const calculateCpuPercent = (usageValue: number, capacityValue: number): number => {
  const capacity = Number(capacityValue)
  if (!Number.isFinite(capacity) || capacity <= 0) return 0

  const normalizedUsage = normalizeCpuUsageCores(Number(usageValue), capacity)
  const percent = (normalizedUsage / capacity) * 100
  if (!Number.isFinite(percent) || percent < 0) return 0
  return percent
}

const formatAge = (dateString: string): string => {
  if (!dateString) return 'Unknown'
  
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

const formatStorageSize = (sizeStr: string): string => {
  if (!sizeStr) return 'Unknown'
  
  // If it's already formatted, return as is
  if (sizeStr.includes('GB') || sizeStr.includes('TB') || sizeStr.includes('MB')) {
    return sizeStr
  }
  
  // Try to parse as bytes and format
  const bytes = parseFloat(sizeStr)
  if (isNaN(bytes)) return sizeStr
  
  return formatBytes(bytes)
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'Ready':
      return 'bg-green-100 text-green-800'
    case 'NotReady':
      return 'bg-yellow-100 text-yellow-800'
    case 'CordonedNotReady':
      return 'bg-red-100 text-red-800 border border-red-300'
    case 'Cordoned':
      return 'bg-orange-100 text-orange-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'Ready':
      return <CheckCircle className="h-3 w-3" />
    case 'NotReady':
      return <AlertTriangle className="h-3 w-3" />
    case 'CordonedNotReady':
      return <XCircle className="h-3 w-3" />
    case 'Cordoned':
      return <AlertTriangle className="h-3 w-3" />
    default:
      return <XCircle className="h-3 w-3" />
  }
}

const getVolumeStatusColor = (status: string): string => {
  switch (status?.toLowerCase()) {
    case 'bound':
    case 'available':
      return 'bg-green-100 text-green-800'
    case 'pending':
    case 'lost':
      return 'bg-yellow-100 text-yellow-800'
    case 'failed':
      return 'bg-red-100 text-red-800'
    case 'released':
      return 'bg-blue-100 text-blue-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

// Simple Card component
const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white shadow rounded-lg ${className}`}>
    {children}
  </div>
)

// Simple Button component
const Button = ({ 
  children, 
  onClick, 
  variant = "default", 
  className = "",
  disabled = false
}: { 
  children: React.ReactNode
  onClick?: () => void
  variant?: "default" | "outline"
  className?: string
  disabled?: boolean
}) => {
  const baseClasses = "inline-flex items-center px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2"
  const variantClasses = variant === "outline" 
    ? "border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 focus:ring-blue-500"
    : "text-white bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
  const disabledClasses = disabled ? "opacity-50 cursor-not-allowed" : ""
  
  return (
    <button 
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses} ${disabledClasses} ${className}`}
    >
      {children}
    </button>
  )
}

// Volume sorting function
const sortVolumes = (
  volumes: OpenEBSVolume[], 
  sortField: 'name' | 'type' | 'namespace' | 'storageClass' | 'capacity' | 'used' | 'available' | 'status' | 'age',
  sortDirection: 'asc' | 'desc'
): OpenEBSVolume[] => {
  return [...volumes].sort((a, b) => {
    let aValue: string | number = ''
    let bValue: string | number = ''

    switch (sortField) {
      case 'name':
        aValue = a.name || ''
        bValue = b.name || ''
        break
      case 'type':
        aValue = a.type || ''
        bValue = b.type || ''
        break
      case 'namespace':
        aValue = a.namespace || ''
        bValue = b.namespace || ''
        break
      case 'storageClass':
        aValue = a.storageClass || ''
        bValue = b.storageClass || ''
        break
      case 'capacity':
        aValue = parseCapacity(a.capacity || '0')
        bValue = parseCapacity(b.capacity || '0')
        break
      case 'used':
        aValue = parseCapacity(a.used || '0')
        bValue = parseCapacity(b.used || '0')
        break
      case 'available':
        aValue = parseCapacity(a.available || '0')
        bValue = parseCapacity(b.available || '0')
        break
      case 'status':
        aValue = a.status || ''
        bValue = b.status || ''
        break
      case 'age':
        aValue = parseAge(a.age || '0')
        bValue = parseAge(b.age || '0')
        break
      default:
        return 0
    }

    let comparison = 0
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue)
    } else {
      comparison = (aValue as number) - (bValue as number)
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })
}

// Helper function to parse capacity strings to bytes for comparison
const parseCapacity = (capacity: string): number => {
  if (!capacity || capacity === '-' || capacity === 'Unknown') return 0
  
  const match = capacity.match(/^([\d.]+)\s*([KMGTPE]?i?B?)$/i)
  if (!match) return 0
  
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  
  const multipliers: Record<string, number> = {
    'B': 1,
    'KB': 1000,
    'KIB': 1024,
    'MB': 1000 ** 2,
    'MIB': 1024 ** 2,
    'GB': 1000 ** 3,
    'GIB': 1024 ** 3,
    'TB': 1000 ** 4,
    'TIB': 1024 ** 4,
    'PB': 1000 ** 5,
    'PIB': 1024 ** 5,
    'EB': 1000 ** 6,
    'EIB': 1024 ** 6
  }
  
  return value * (multipliers[unit] || 1)
}

// Helper function to parse age strings to seconds for comparison
const parseAge = (age: string): number => {
  if (!age || age === 'Unknown') return 0
  
  const match = age.match(/^(\d+)([smhdw])$/i)
  if (!match) return 0
  
  const value = parseInt(match[1])
  const unit = match[2].toLowerCase()
  
  const multipliers: Record<string, number> = {
    's': 1,
    'm': 60,
    'h': 60 * 60,
    'd': 60 * 60 * 24,
    'w': 60 * 60 * 24 * 7
  }
  
  return value * (multipliers[unit] || 1)
}

// Pod sorting function
const sortPods = (
  pods: any[], 
  sortField: 'name' | 'namespace' | 'status' | 'restarts' | 'age' | 'node' | 'ready' | 'cpuUsage' | 'memoryUsage',
  sortDirection: 'asc' | 'desc'
): any[] => {
  return [...pods].sort((a, b) => {
    let aValue: string | number = ''
    let bValue: string | number = ''

    switch (sortField) {
      case 'name':
        aValue = a.name || ''
        bValue = b.name || ''
        break
      case 'namespace':
        aValue = a.namespace || ''
        bValue = b.namespace || ''
        break
      case 'status':
        aValue = a.status || ''
        bValue = b.status || ''
        break
      case 'restarts':
        aValue = a.restarts || 0
        bValue = b.restarts || 0
        break
      case 'age':
        aValue = parseAge(a.age || '0')
        bValue = parseAge(b.age || '0')
        break
      case 'node':
        aValue = a.node || ''
        bValue = b.node || ''
        break
      case 'ready':
        aValue = a.ready || ''
        bValue = b.ready || ''
        break
      case 'cpuUsage':
        aValue = parseCapacity(a.currentUsage?.cpu || '0')
        bValue = parseCapacity(b.currentUsage?.cpu || '0')
        break
      case 'memoryUsage':
        aValue = parseCapacity(a.currentUsage?.memory || '0')
        bValue = parseCapacity(b.currentUsage?.memory || '0')
        break
      default:
        return 0
    }

    let comparison = 0
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue)
    } else {
      comparison = (aValue as number) - (bValue as number)
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })
}

// Services sorting function
const sortServices = (
  services: any[], 
  sortField: 'name' | 'namespace' | 'type' | 'clusterIP' | 'externalIP' | 'ports' | 'age',
  sortDirection: 'asc' | 'desc'
): any[] => {
  return [...services].sort((a, b) => {
    let aValue: string | number = ''
    let bValue: string | number = ''

    switch (sortField) {
      case 'name':
        aValue = a.name || ''
        bValue = b.name || ''
        break
      case 'namespace':
        aValue = a.namespace || ''
        bValue = b.namespace || ''
        break
      case 'type':
        aValue = a.type || ''
        bValue = b.type || ''
        break
      case 'clusterIP':
        aValue = a.clusterIP || ''
        bValue = b.clusterIP || ''
        break
      case 'externalIP':
        aValue = a.externalIP || ''
        bValue = b.externalIP || ''
        break
      case 'ports':
        // Sort by the number of ports, then by port numbers
        const aPorts = a.ports || []
        const bPorts = b.ports || []
        if (aPorts.length !== bPorts.length) {
          aValue = aPorts.length
          bValue = bPorts.length
        } else {
          // If same number of ports, sort by first port number
          aValue = aPorts.length > 0 ? (aPorts[0].port || 0) : 0
          bValue = bPorts.length > 0 ? (bPorts[0].port || 0) : 0
        }
        break
      case 'age':
        aValue = parseAge(a.age || '0')
        bValue = parseAge(b.age || '0')
        break
      default:
        return 0
    }

    let comparison = 0
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue)
    } else {
      comparison = (aValue as number) - (bValue as number)
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })
}

// ClusterRoleBindings sorting function
const sortClusterRoleBindings = (
  clusterRoleBindings: any[],
  sortField: 'name' | 'role' | 'age',
  sortDirection: 'asc' | 'desc'
): any[] => {
  return [...clusterRoleBindings].sort((a, b) => {
    let aValue: string | number = ''
    let bValue: string | number = ''

    switch (sortField) {
      case 'name':
        aValue = a.name || ''
        bValue = b.name || ''
        break
      case 'role':
        aValue = a.roleRef?.name || ''
        bValue = b.roleRef?.name || ''
        break
      case 'age':
        aValue = parseAge(formatAge(a.createdAt || ''))
        bValue = parseAge(formatAge(b.createdAt || ''))
        break
      default:
        return 0
    }

    let comparison = 0
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue)
    } else {
      comparison = (aValue as number) - (bValue as number)
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })
}

// RoleBindings sorting function
const sortRoleBindings = (
  roleBindings: any[],
  sortField: 'name' | 'namespace' | 'role' | 'age',
  sortDirection: 'asc' | 'desc'
): any[] => {
  return [...roleBindings].sort((a, b) => {
    let aValue: string | number = ''
    let bValue: string | number = ''

    switch (sortField) {
      case 'name':
        aValue = a.name || ''
        bValue = b.name || ''
        break
      case 'namespace':
        aValue = a.namespace || ''
        bValue = b.namespace || ''
        break
      case 'role':
        aValue = a.roleRef?.name || ''
        bValue = b.roleRef?.name || ''
        break
      case 'age':
        aValue = parseAge(formatAge(a.createdAt || ''))
        bValue = parseAge(formatAge(b.createdAt || ''))
        break
      default:
        return 0
    }

    let comparison = 0
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue)
    } else {
      comparison = (aValue as number) - (bValue as number)
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })
}

// ServiceAccounts sorting function
const sortServiceAccounts = (
  serviceAccounts: any[],
  sortField: 'name' | 'namespace' | 'secrets' | 'age',
  sortDirection: 'asc' | 'desc'
): any[] => {
  return [...serviceAccounts].sort((a, b) => {
    let aValue: string | number = ''
    let bValue: string | number = ''

    switch (sortField) {
      case 'name':
        aValue = a.name || ''
        bValue = b.name || ''
        break
      case 'namespace':
        aValue = a.namespace || ''
        bValue = b.namespace || ''
        break
      case 'secrets':
        aValue = (a.secrets?.length || 0)
        bValue = (b.secrets?.length || 0)
        break
      case 'age':
        aValue = parseAge(formatAge(a.createdAt || ''))
        bValue = parseAge(formatAge(b.createdAt || ''))
        break
      default:
        return 0
    }

    let comparison = 0
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue)
    } else {
      comparison = (aValue as number) - (bValue as number)
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })
}

interface OpenEBSInfo {
  installed: boolean
  version?: string
  namespaces: string[]
  storageClasses: OpenEBSStorageClass[]
  volumes: OpenEBSVolume[]
  storagePools: OpenEBSStoragePool[]
  nodes: OpenEBSNode[]
}

interface OpenEBSStorageClass {
  name: string
  provisioner: string
  reclaimPolicy: string
  volumeBindingMode: string
  allowVolumeExpansion: boolean
  parameters: Record<string, string>
  annotations: Record<string, string>
  labels: Record<string, string>
  age: string
}

interface OpenEBSVolume {
  type: 'PersistentVolume' | 'PersistentVolumeClaim'
  name: string
  namespace: string
  storageClass: string
  capacity: string
  capacityBytes?: number
  used?: string
  available?: string
  status: string
  reclaimPolicy?: string
  accessModes: string[]
  driver?: string
  volumeHandle?: string
  volumeName?: string
  claimRef?: {
    name: string
    namespace: string
  } | null
  age: string
}

interface OpenEBSStoragePool {
  type: string
  name: string
  namespace: string
  node?: string
  status: string
  capacity?: string
  used?: string
  free?: string
  available?: string
  readonly?: boolean
  replicationFactor?: number
  disks?: string[]
  age: string
}

interface OpenEBSNode {
  name: string
  storageCapacity: string
  storageAllocatable: string
  storageCapacityBytes: number
  storageAllocatableBytes: number
  allocatablePercentage: number
  openebsLabels: Record<string, string>
  openebsAnnotations: Record<string, string>
  conditions: Array<{
    type: string
    status: string
    reason: string
    message: string
  }>
}

interface ClusterImage {
  name: string
  tag: string
  fullName: string
  pods: Array<{
    name: string
    namespace: string
    nodeName: string
  }>
  podCount: number
  namespaces: string[]
  nodes: string[]
  createdAt: string
  pullPolicy?: string
  size?: string
}

interface ClusterDetails {
  id: number
  name: string
  endpoint: string
  description: string
  kubernetesVersion: string
  talosVersion: string
  status: 'healthy' | 'unhealthy' | 'warning' | 'unknown'
  nodes: NodeDetails[]
  pods: PodDetails[]
  namespaces: NamespaceDetails[]
  services: ServiceDetails[]
  deployments: DeploymentDetails[]
  metrics: ClusterMetrics
  talosInfo: TalosClusterInfo
  openebsInfo: OpenEBSInfo
  images: ClusterImage[]
}

interface NodeDetails {
  name: string
  status: string
  roles: string[]
  version: string
  osImage: string
  kernelVersion: string
  containerRuntime: string
  cpuCapacity: string
  memoryCapacity: string
  cpuUsage: number
  memoryUsage: number
  bootDiskCapacity: number
  bootDiskUsage: number
  bootDiskAvailable: number
  conditions: NodeCondition[]
  taints: NodeTaint[]
  labels: Record<string, string>
  addresses: NodeAddress[]
  allocatable: Record<string, string>
  createdAt: string
}

interface NodeCondition {
  type: string
  status: string
  lastTransitionTime: string
  reason: string
  message: string
}

interface NodeTaint {
  key: string
  value?: string
  effect: string
}

interface NodeAddress {
  type: string
  address: string
}

interface PodDetails {
  name: string
  namespace: string
  status: string
  restarts: number
  age: string
  node: string
  ready: string
  containers: ContainerDetails[]
  resources: {
    requests: {
      cpu: string
      memory: string
    }
    limits: {
      cpu: string
      memory: string
    }
  }
  currentUsage: {
    cpu: string
    memory: string
  }
}

interface ContainerDetails {
  name: string
  image: string
  status: string
  ready: boolean
  restartCount: number
  resources: {
    requests: Record<string, string>
    limits: Record<string, string>
  }
}

interface NamespaceDetails {
  name: string
  status: string
  age: string
  labels: Record<string, string>
}

interface ServiceDetails {
  name: string
  namespace: string
  type: string
  clusterIP: string
  externalIP: string
  ports: ServicePort[]
  age: string
}

interface ServicePort {
  name?: string
  port: number
  targetPort: string | number
  protocol: string
}

interface DeploymentDetails {
  name: string
  namespace: string
  ready: string
  upToDate: number
  available: number
  age: string
  images: string[]
}

interface EventDetails {
  type: string
  reason: string
  object: string
  namespace?: string
  message: string
  firstTime: string
  lastTime: string
  count: number
}

interface ClusterHealthIssues {
  podErrors: any[]
  podResourceWarnings: any[]
  certificateWarnings: any[]
  certificateErrors: any[]
  cordonedNodeWarnings: any[]
  cordonedNodeErrors: any[]
  recentEventErrors: any[]
}

interface ClusterMetrics {
  totalCPU: number
  totalMemory: number
  usedCPU: number
  usedMemory: number
  podCount: number
  serviceCount: number
  deploymentCount: number
}

interface TalosClusterInfo {
  machineConfigs: TalosMachineConfig[]
  etcdMembers: EtcdMember[]
  systemServices: TalosService[]
}

interface TalosMachineConfig {
  nodeName: string
  machineType: string
  talosVersion: string
  kubernetesVersion: string
  platform: string
}

interface EtcdMember {
  id: string
  name: string
  peerURLs: string[]
  clientURLs: string[]
  isLearner: boolean
}

interface TalosService {
  id: string
  state: string
  health: string
  events: TalosServiceEvent[]
}

interface TalosServiceEvent {
  msg: string
  state: string
  ts: string
}

export default function ClusterDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const clusterId = params.id as string
  
  const [rawClusterDetails, setClusterDetails] = useState<ClusterDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('overview')
  
  // Share the latest status with the sidebar cluster list
  useEffect(() => {
    if (rawClusterDetails) {
      setClusterStatus(Number(clusterId), rawClusterDetails.status, rawClusterDetails.name)
    }
  }, [clusterId, rawClusterDetails?.status, rawClusterDetails?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  // Read tab from URL on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search)
      const tab = searchParams.get('tab')
      if (tab) {
        setActiveTab(tab)
      }
    }
  }, [])
  
  // Logs state
  const [selectedNamespace, setSelectedNamespace] = useState('')
  const [selectedPod, setSelectedPod] = useState('')
  const [selectedContainer, setSelectedContainer] = useState('')
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [rawNamespacePods, setNamespacePods] = useState<any[]>([])
  const [podContainers, setPodContainers] = useState<any[]>([])
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true)
  const [autoScrollLogs, setAutoScrollLogs] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Storage Pool details state
  const [selectedStoragePool, setSelectedStoragePool] = useState<OpenEBSStoragePool | null>(null)
  const [showStoragePoolModal, setShowStoragePoolModal] = useState(false)

  // Workloads state
  const [workloadsNamespaceFilter, setWorkloadsNamespaceFilter] = useState('all')

  // Nodes state
  const [nodesSearchTerm, setNodesSearchTerm] = useState('')
  const [nodesSortField, setNodesSortField] = useState<'name' | 'role' | 'status' | 'cpu' | 'memory' | 'disk' | 'pods' | 'age'>('name')
  const [nodesSortDirection, setNodesSortDirection] = useState<'asc' | 'desc'>('asc')

  // Events state
  const [rawEvents, setEvents] = useState<EventDetails[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsLoaded, setEventsLoaded] = useState(false)
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([])
  const [autoRefreshEvents, setAutoRefreshEvents] = useState(true)
  const [autoScrollEvents, setAutoScrollEvents] = useState(true)
  const eventsContainerRef = useRef<HTMLDivElement>(null)
  const lastEventsSignatureRef = useRef('')

  // Certificates state
  const [rawCertificates, setCertificates] = useState<any[]>([])
  const [certificatesLoading, setCertificatesLoading] = useState(false)
  const [certificatesLoaded, setCertificatesLoaded] = useState(false)
  const [certificateFilter, setCertificateFilter] = useState('all')
  const [rawCertificatesStats, setCertificatesStats] = useState({
    total: 0,
    expired: 0,
    critical: 0,
    warning: 0,
    valid: 0,
    expiringSoon: 0,
    cnpgCritical: 0,
    cnpgWarning: 0
  })

  // Images state
  const [imagesSortField, setImagesSortField] = useState<'name' | 'tag' | 'pods' | 'namespaces' | 'nodes' | 'pullPolicy' | 'age'>('name')
  const [imagesSortDirection, setImagesSortDirection] = useState<'asc' | 'desc'>('asc')
  const [imagesSearchTerm, setImagesSearchTerm] = useState('')
  const [imagesNamespaceFilter, setImagesNamespaceFilter] = useState<string>('all')
  const [imagesShowOnlyUpdates, setImagesShowOnlyUpdates] = useState(false)
  const [imagesWithUpdates, setImagesWithUpdates] = useState<Set<string>>(new Set())
  const [checkingForUpdates, setCheckingForUpdates] = useState(false)
  const [showUpdateCheckModal, setShowUpdateCheckModal] = useState(false)
  const [imageUpdateDetails, setImageUpdateDetails] = useState<Record<string, { newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }>>({})
  const [lastImageUpdateCheckAt, setLastImageUpdateCheckAt] = useState<string | null>(null)
  const [updateCheckProgress, setUpdateCheckProgress] = useState<{
    total: number
    checked: number
    current: string
    results: Array<{ fullName: string; status: 'checking' | 'update-available' | 'up-to-date' | 'error'; error?: string; newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }>
  }>({ total: 0, checked: 0, current: '', results: [] })

  // Storage state (for non-OpenEBS storage)
  const [rawStorageData, setStorageData] = useState<any>(null)
  const [rawHealthIssues, setHealthIssues] = useState<ClusterHealthIssues>({
    podErrors: [],
    podResourceWarnings: [],
    certificateWarnings: [],
    certificateErrors: [],
    cordonedNodeWarnings: [],
    cordonedNodeErrors: [],
    recentEventErrors: []
  })

  // "Hide customer managed": everything below reads filtered copies of the raw data,
  // so namespaces labelled customer_managed=yes disappear from every tab and alert.
  const [customerNamespaces, setCustomerNamespaces] = useState<string[]>([])
  const hideCustomer = useHideCustomerManaged()
  const hiddenNamespaces = useMemo(
    () => new Set(hideCustomer ? customerNamespaces : []),
    [hideCustomer, customerNamespaces]
  )
  const clusterDetails = useMemo(() => {
    if (!rawClusterDetails || hiddenNamespaces.size === 0) return rawClusterDetails
    const filtered = withoutNamespaces(rawClusterDetails, hiddenNamespaces)
    return { ...filtered, metrics: { ...filtered.metrics, podCount: filtered.pods.length } }
  }, [rawClusterDetails, hiddenNamespaces])
  const events = useMemo(() => withoutNamespaces(rawEvents, hiddenNamespaces), [rawEvents, hiddenNamespaces])
  const certificates = useMemo(() => withoutNamespaces(rawCertificates, hiddenNamespaces), [rawCertificates, hiddenNamespaces])
  const certificatesStats = useMemo(() => {
    if (hiddenNamespaces.size === 0) return rawCertificatesStats
    const count = (status: string, cnpgOnly = false) =>
      certificates.filter((cert: any) => cert.status === status && (!cnpgOnly || cert.isCnpgPostgres)).length
    return {
      total: certificates.length,
      expired: count('expired'),
      critical: count('critical'),
      warning: count('warning'),
      valid: count('valid'),
      expiringSoon: count('critical') + count('warning'),
      cnpgCritical: count('critical', true),
      cnpgWarning: count('warning', true)
    }
  }, [rawCertificatesStats, certificates, hiddenNamespaces])
  const healthIssues = useMemo(() => withoutNamespaces(rawHealthIssues, hiddenNamespaces), [rawHealthIssues, hiddenNamespaces])
  const storageData = useMemo(() => withoutNamespaces(rawStorageData, hiddenNamespaces), [rawStorageData, hiddenNamespaces])
  const namespacePods = useMemo(() => withoutNamespaces(rawNamespacePods, hiddenNamespaces), [rawNamespacePods, hiddenNamespaces])

  // Function to collect all alerts from cluster data
  const getAllAlerts = useCallback(() => {
    if (!clusterDetails) return { critical: [], warning: [], info: [] }

    const alerts = {
      critical: [] as Array<{id: string, type: string, title: string, message: string, source: string, timestamp?: string}>,
      warning: [] as Array<{id: string, type: string, title: string, message: string, source: string, timestamp?: string}>,
      info: [] as Array<{id: string, type: string, title: string, message: string, source: string, timestamp?: string}>
    }

    // Node alerts
    clusterDetails.nodes.forEach((node, idx) => {
      if (node.status === 'NotReady' || node.status === 'CordonedNotReady') {
        alerts.critical.push({
          id: `node-${idx}-status`,
          type: 'node',
          title: 'Node Not Ready',
          message: `Node ${node.name} is ${node.status}`,
          source: 'Nodes'
        })
      }

      // High resource usage alerts
      const cpuPercent = calculateCpuPercent(Number(node.cpuUsage), Number(node.cpuCapacity))
      const memoryPercent = (Number(node.memoryUsage) / Number(node.memoryCapacity)) * 100
      const diskPercent = (node.bootDiskUsage / node.bootDiskCapacity) * 100

      if (cpuPercent > 90) {
        alerts.critical.push({
          id: `node-${idx}-cpu`,
          type: 'resource',
          title: 'High CPU Usage',
          message: `Node ${node.name} CPU usage is ${cpuPercent.toFixed(1)}%`,
          source: 'Resource Usage'
        })
      } else if (cpuPercent > 80) {
        alerts.warning.push({
          id: `node-${idx}-cpu`,
          type: 'resource',
          title: 'High CPU Usage',
          message: `Node ${node.name} CPU usage is ${cpuPercent.toFixed(1)}%`,
          source: 'Resource Usage'
        })
      }

      if (memoryPercent > 90) {
        alerts.critical.push({
          id: `node-${idx}-memory`,
          type: 'resource',
          title: 'High Memory Usage',
          message: `Node ${node.name} memory usage is ${memoryPercent.toFixed(1)}%`,
          source: 'Resource Usage'
        })
      } else if (memoryPercent > 80) {
        alerts.warning.push({
          id: `node-${idx}-memory`,
          type: 'resource',
          title: 'High Memory Usage',
          message: `Node ${node.name} memory usage is ${memoryPercent.toFixed(1)}%`,
          source: 'Resource Usage'
        })
      }

      if (diskPercent > 90) {
        alerts.critical.push({
          id: `node-${idx}-disk`,
          type: 'resource',
          title: 'High Disk Usage',
          message: `Node ${node.name} disk usage is ${diskPercent.toFixed(1)}%`,
          source: 'Resource Usage'
        })
      } else if (diskPercent > 80) {
        alerts.warning.push({
          id: `node-${idx}-disk`,
          type: 'resource',
          title: 'High Disk Usage',
          message: `Node ${node.name} disk usage is ${diskPercent.toFixed(1)}%`,
          source: 'Resource Usage'
        })
      }
    })

    // Deployment alerts
    clusterDetails.deployments?.forEach((deployment: any, idx: number) => {
      if (deployment && deployment.name && typeof deployment.readyReplicas === 'number' && typeof deployment.replicas === 'number') {
        if (deployment.readyReplicas < deployment.replicas) {
          const severity = deployment.readyReplicas === 0 ? 'critical' : 'warning'
          alerts[severity].push({
            id: `deployment-${idx}-replicas`,
            type: 'workload',
            title: 'Deployment Issues',
            message: `Deployment ${deployment.name} has ${deployment.readyReplicas}/${deployment.replicas} replicas ready`,
            source: 'Workloads'
          })
        }
      }
    })

    // Pod alerts
    clusterDetails.pods?.forEach((pod: any, idx: number) => {
      if (pod && pod.name && pod.status) {
        if (pod.status === 'Failed' || pod.status === 'CrashLoopBackOff' || pod.status === 'Error') {
          alerts.critical.push({
            id: `pod-${idx}-status`,
            type: 'workload',
            title: 'Pod Failed',
            message: `Pod ${pod.name}${pod.namespace ? ` in ${pod.namespace}` : ''} is ${pod.status}`,
            source: 'Workloads'
          })
        } else if (pod.status === 'Pending' || pod.status === 'ImagePullBackOff') {
          alerts.warning.push({
            id: `pod-${idx}-status`,
            type: 'workload',
            title: 'Pod Issues',
            message: `Pod ${pod.name}${pod.namespace ? ` in ${pod.namespace}` : ''} is ${pod.status}`,
            source: 'Workloads'
          })
        }

        // Container restart alerts
        if (typeof pod.restartCount === 'number' && pod.restartCount > 5) {
          alerts.warning.push({
            id: `pod-${idx}-restarts`,
            type: 'workload',
            title: 'High Restart Count',
            message: `Pod ${pod.name} has ${pod.restartCount} restarts`,
            source: 'Workloads'
          })
        }
      }
    })

    // Certificate alerts
    if (certificatesStats.expired > 0) {
      alerts.critical.push({
        id: 'cert-expired',
        type: 'security',
        title: 'Expired Certificates',
        message: `${certificatesStats.expired} certificate(s) have expired`,
        source: 'Security'
      })
    }

    if (certificatesStats.critical > 0) {
      alerts.critical.push({
        id: 'cert-critical',
        type: 'security',
        title: 'Certificates Expiring Soon',
        message: `${certificatesStats.critical} certificate(s) expire within 7 days`,
        source: 'Security'
      })
    }

    if (certificatesStats.warning > 0) {
      alerts.warning.push({
        id: 'cert-warning',
        type: 'security',
        title: 'Certificates Expiring',
        message: `${certificatesStats.warning} certificate(s) expire within 30 days`,
        source: 'Security'
      })
    }

    if (certificatesStats.cnpgCritical > 0) {
      alerts.critical.push({
        id: 'cert-cnpg-critical',
        type: 'security',
        title: 'CNPG PostgreSQL Certificates Expiring Soon',
        message: `${certificatesStats.cnpgCritical} CNPG PostgreSQL certificate(s) expire within 3 days`,
        source: 'Security'
      })
    }

    if (certificatesStats.cnpgWarning > 0) {
      alerts.warning.push({
        id: 'cert-cnpg-warning',
        type: 'security',
        title: 'CNPG PostgreSQL Certificates Warning',
        message: `${certificatesStats.cnpgWarning} CNPG PostgreSQL certificate(s) expire within 6 days`,
        source: 'Security'
      })
    }

    // Additional checks can be added here for storage, backups, etc.
    // when the data structures are available

    // Health API alerts (kept in sync with dashboard issue sources)
    healthIssues.podResourceWarnings.forEach((pod: any, idx: number) => {
      alerts.warning.push({
        id: `health-pod-resource-warning-${idx}`,
        type: 'resource',
        title: 'Pod Resource Warning',
        message: `Pod ${pod?.name || 'unknown'}${pod?.namespace ? ` in ${pod.namespace}` : ''} has high resource usage`,
        source: 'Health Checks'
      })
    })

    healthIssues.certificateWarnings.forEach((cert: any, idx: number) => {
      alerts.warning.push({
        id: `health-cert-warning-${idx}`,
        type: 'security',
        title: 'Certificate Warning',
        message: `${cert?.name || 'Certificate'}${cert?.namespace ? ` in ${cert.namespace}` : ''} expires in ${cert?.daysUntilExpiry ?? '?'} day(s)`,
        source: 'Health Checks'
      })
    })

    healthIssues.certificateErrors.forEach((cert: any, idx: number) => {
      alerts.critical.push({
        id: `health-cert-error-${idx}`,
        type: 'security',
        title: 'Certificate Critical',
        message: `${cert?.name || 'Certificate'}${cert?.namespace ? ` in ${cert.namespace}` : ''} expires in ${cert?.daysUntilExpiry ?? '?'} day(s)`,
        source: 'Health Checks'
      })
    })

    healthIssues.cordonedNodeWarnings.forEach((node: any, idx: number) => {
      alerts.warning.push({
        id: `health-cordoned-warning-${idx}`,
        type: 'node',
        title: 'Cordoned Node (Ready)',
        message: `Node ${node?.name || 'unknown'} is cordoned but still ready`,
        source: 'Health Checks'
      })
    })

    healthIssues.cordonedNodeErrors.forEach((node: any, idx: number) => {
      alerts.critical.push({
        id: `health-cordoned-error-${idx}`,
        type: 'node',
        title: 'Cordoned Node (Not Ready)',
        message: `Node ${node?.name || 'unknown'} is cordoned and not ready`,
        source: 'Health Checks'
      })
    })

    healthIssues.recentEventErrors.forEach((event: any, idx: number) => {
      alerts.critical.push({
        id: `health-event-error-${idx}`,
        type: 'event',
        title: 'Recent Event Error',
        message: event?.message || event?.reason || 'Kubernetes reported recent error events',
        source: 'Health Checks'
      })
    })

    return alerts
  }, [clusterDetails, certificatesStats, healthIssues])
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageLoaded, setStorageLoaded] = useState(false)

  // Networking state
  const [rawNetworkingData, setNetworkingData] = useState<any>(null)
  const [networkingLoading, setNetworkingLoading] = useState(false)
  const [networkingLoaded, setNetworkingLoaded] = useState(false)
  
  // Network visualization state
  const [selectedNetworkNamespace, setSelectedNetworkNamespace] = useState<string>('default')

  // RBAC state
  const [rawRbacData, setRbacData] = useState<any>(null)
  const [rbacLoading, setRbacLoading] = useState(false)
  const [rbacLoaded, setRbacLoaded] = useState(false)
  const networkingData = useMemo(() => withoutNamespaces(rawNetworkingData, hiddenNamespaces), [rawNetworkingData, hiddenNamespaces])
  const rbacData = useMemo(() => withoutNamespaces(rawRbacData, hiddenNamespaces), [rawRbacData, hiddenNamespaces])

  // RBAC filtering and sorting state
  const [clusterRoleBindingsSearchTerm, setClusterRoleBindingsSearchTerm] = useState('')
  const [clusterRoleBindingsSortField, setClusterRoleBindingsSortField] = useState<'name' | 'role' | 'age'>('name')
  const [clusterRoleBindingsSortDirection, setClusterRoleBindingsSortDirection] = useState<'asc' | 'desc'>('asc')

  const [roleBindingsSearchTerm, setRoleBindingsSearchTerm] = useState('')
  const [roleBindingsNamespaceFilter, setRoleBindingsNamespaceFilter] = useState('all')
  const [roleBindingsSortField, setRoleBindingsSortField] = useState<'name' | 'namespace' | 'role' | 'age'>('name')
  const [roleBindingsSortDirection, setRoleBindingsSortDirection] = useState<'asc' | 'desc'>('asc')

  const [serviceAccountsSearchTerm, setServiceAccountsSearchTerm] = useState('')
  const [serviceAccountsSortField, setServiceAccountsSortField] = useState<'name' | 'namespace' | 'secrets' | 'age'>('name')
  const [serviceAccountsSortDirection, setServiceAccountsSortDirection] = useState<'asc' | 'desc'>('asc')

  // User permissions expansion state
  const [expandedUserPermissions, setExpandedUserPermissions] = useState<Set<string>>(new Set())

  // Images state - lazy loaded
  const [imagesLoading, setImagesLoading] = useState(false)
  const [imagesLoaded, setImagesLoaded] = useState(false)

  // OpenEBS state - lazy loaded  
  const [openebsLoading, setOpenebsLoading] = useState(false)
  const [openebsLoaded, setOpenebsLoaded] = useState(false)

  // Volumes state
  const [volumesSearchTerm, setVolumesSearchTerm] = useState('')
  const [volumesNamespaceFilter, setVolumesNamespaceFilter] = useState('all')
  const [volumesSortField, setVolumesSortField] = useState<'name' | 'type' | 'namespace' | 'storageClass' | 'capacity' | 'used' | 'available' | 'status' | 'age'>('name')
  const [volumesSortDirection, setVolumesSortDirection] = useState<'asc' | 'desc'>('asc')

  // Pods/Workloads state
  const [podsSearchTerm, setPodsSearchTerm] = useState('')
  const [podsNamespaceFilter, setPodsNamespaceFilter] = useState('all')
  const [podsSortField, setPodsSortField] = useState<'name' | 'namespace' | 'status' | 'restarts' | 'age' | 'node' | 'ready' | 'cpuUsage' | 'memoryUsage'>('name')
  const [podsSortDirection, setPodsSortDirection] = useState<'asc' | 'desc'>('asc')

  // Services state
  const [servicesSortField, setServicesSortField] = useState<'name' | 'namespace' | 'type' | 'clusterIP' | 'externalIP' | 'ports' | 'age'>('name')
  const [servicesSortDirection, setServicesSortDirection] = useState<'asc' | 'desc'>('asc')

  // Auto-scroll logs to bottom when new logs arrive
  useEffect(() => {
    if (autoScrollLogs && logsEndRef.current) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        if (logsEndRef.current) {
          logsEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end', inline: 'nearest' })
        }
      }, 0)
    }
  }, [logs, autoScrollLogs])

  // Nodes state
  const [nodeStatusFilter, setNodeStatusFilter] = useState<'all' | 'ready' | 'notready' | 'cordoned'>('all')

  // Workloads state
  const [workloadsSearchTerm, setWorkloadsSearchTerm] = useState('')
  
  // Deployments state
  const [deploymentsSearchTerm, setDeploymentsSearchTerm] = useState('')
  const [deploymentsSortField, setDeploymentsSortField] = useState<'name' | 'namespace' | 'ready' | 'upToDate' | 'available' | 'age'>('name')
  const [deploymentsSortDirection, setDeploymentsSortDirection] = useState<'asc' | 'desc'>('asc')

  // Services state
  const [servicesSearchTerm, setServicesSearchTerm] = useState('')
  const [servicesNamespaceFilter, setServicesNamespaceFilter] = useState('all')

  // Certificates state (search and namespace)
  const [certificatesSearchTerm, setCertificatesSearchTerm] = useState('')
  const [certificatesNamespaceFilter, setCertificatesNamespaceFilter] = useState('all')

  // Auto-refresh state
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  // Memoized filtered and sorted nodes
  const filteredNodes = useMemo(() => {
    if (!clusterDetails) return []
    
    let filtered = [...clusterDetails.nodes]
      .filter((node) => {
        if (nodeStatusFilter === 'all') return true
        if (nodeStatusFilter === 'ready') return node.status === 'Ready'
        if (nodeStatusFilter === 'notready') return node.status === 'NotReady' || node.status === 'CordonedNotReady'
        if (nodeStatusFilter === 'cordoned') return node.status.includes('Cordoned')
        return true
      })
    
    // Apply search filter if search term exists
    if (nodesSearchTerm) {
      const searchLower = nodesSearchTerm.toLowerCase()
      filtered = filtered.filter(node => 
        node.name.toLowerCase().includes(searchLower)
      )
    }
    
    // Sort nodes
    return filtered.sort((a, b) => {
      let aValue: any, bValue: any
      
      switch (nodesSortField) {
        case 'name':
          aValue = a.name.toLowerCase()
          bValue = b.name.toLowerCase()
          break
        case 'role':
          // Control plane nodes first, then workers
          aValue = a.roles.includes('control-plane') ? 'a-control' : 'b-worker'
          bValue = b.roles.includes('control-plane') ? 'a-control' : 'b-worker'
          break
        case 'status':
          aValue = a.status.toLowerCase()
          bValue = b.status.toLowerCase()
          break
        case 'cpu':
          aValue = calculateCpuPercent(Number(a.cpuUsage), Number(a.cpuCapacity))
          bValue = calculateCpuPercent(Number(b.cpuUsage), Number(b.cpuCapacity))
          break
        case 'memory':
          aValue = (Number(a.memoryUsage) / Number(a.memoryCapacity)) * 100
          bValue = (Number(b.memoryUsage) / Number(b.memoryCapacity)) * 100
          break
        case 'disk':
          aValue = (a.bootDiskUsage / a.bootDiskCapacity) * 100
          bValue = (b.bootDiskUsage / b.bootDiskCapacity) * 100
          break
        case 'pods':
          // Count pods per node from clusterDetails.pods
          const aPodsCount = clusterDetails.pods.filter(pod => pod.node === a.name).length
          const bPodsCount = clusterDetails.pods.filter(pod => pod.node === b.name).length
          aValue = aPodsCount
          bValue = bPodsCount
          break
        case 'age':
          aValue = new Date(a.createdAt || 0).getTime()
          bValue = new Date(b.createdAt || 0).getTime()
          break
        default:
          return 0
      }
      
      if (nodesSortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })
  }, [clusterDetails, nodeStatusFilter, nodesSearchTerm, nodesSortField, nodesSortDirection])

  // Memoized filtered workloads
  const filteredWorkloads = useMemo(() => {
    if (!clusterDetails) return []
    
    let filtered = clusterDetails.deployments
    
    if (workloadsNamespaceFilter !== 'all') {
      filtered = filtered.filter(d => d.namespace === workloadsNamespaceFilter)
    }
    
    if (workloadsSearchTerm) {
      const searchLower = workloadsSearchTerm.toLowerCase()
      filtered = filtered.filter(d => 
        d.name.toLowerCase().includes(searchLower) ||
        d.namespace.toLowerCase().includes(searchLower)
      )
    }
    
    return filtered
  }, [clusterDetails, workloadsNamespaceFilter, workloadsSearchTerm])

  // Memoized filtered and sorted deployments
  const filteredAndSortedDeployments = useMemo(() => {
    if (!clusterDetails) return []
    
    let filtered = clusterDetails.deployments
    
    if (deploymentsSearchTerm) {
      const searchLower = deploymentsSearchTerm.toLowerCase()
      filtered = filtered.filter(d => 
        d.name.toLowerCase().includes(searchLower) ||
        d.namespace.toLowerCase().includes(searchLower)
      )
    }
    
    // Sort deployments
    return [...filtered].sort((a, b) => {
      let aValue: any, bValue: any
      
      switch (deploymentsSortField) {
        case 'name':
          aValue = a.name.toLowerCase()
          bValue = b.name.toLowerCase()
          break
        case 'namespace':
          aValue = a.namespace.toLowerCase()
          bValue = b.namespace.toLowerCase()
          break
        case 'ready':
          // Parse ready field like "2/2" to get readyReplicas for sorting
          aValue = (a as any).readyReplicas || 0
          bValue = (b as any).readyReplicas || 0
          break
        case 'upToDate':
          aValue = a.upToDate || 0
          bValue = b.upToDate || 0
          break
        case 'available':
          aValue = a.available || 0
          bValue = b.available || 0
          break
        case 'age':
          // Convert age strings to comparable values
          aValue = new Date((a as any).creationTimestamp || 0).getTime()
          bValue = new Date((b as any).creationTimestamp || 0).getTime()
          break
        default:
          return 0
      }
      
      if (deploymentsSortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })
  }, [clusterDetails, deploymentsSearchTerm, deploymentsSortField, deploymentsSortDirection])

  // Memoized filtered services
  const filteredServices = useMemo(() => {
    if (!clusterDetails) return []
    
    let filtered = clusterDetails.services
    
    if (servicesNamespaceFilter !== 'all') {
      filtered = filtered.filter(s => s.namespace === servicesNamespaceFilter)
    }
    
    if (servicesSearchTerm) {
      const searchLower = servicesSearchTerm.toLowerCase()
      filtered = filtered.filter(s => 
        s.name.toLowerCase().includes(searchLower) ||
        s.namespace.toLowerCase().includes(searchLower)
      )
    }
    
    return filtered
  }, [clusterDetails, servicesNamespaceFilter, servicesSearchTerm])

  // Memoized filtered certificates
  const filteredCertificates = useMemo(() => {
    if (!certificates) return []
    
    let filtered = certificates
    
    if (certificateFilter !== 'all') {
      if (certificateFilter === 'expired') {
        filtered = filtered.filter(c => c.status === 'Expired')
      } else if (certificateFilter === 'critical') {
        filtered = filtered.filter(c => c.daysUntilExpiry <= 10 && c.daysUntilExpiry >= 0)
      } else if (certificateFilter === 'warning') {
        filtered = filtered.filter(c => c.daysUntilExpiry > 10 && c.daysUntilExpiry <= 30)
      } else if (certificateFilter === 'valid') {
        filtered = filtered.filter(c => c.daysUntilExpiry > 30)
      }
    }
    
    if (certificatesNamespaceFilter !== 'all') {
      filtered = filtered.filter(c => c.namespace === certificatesNamespaceFilter)
    }
    
    if (certificatesSearchTerm) {
      const searchLower = certificatesSearchTerm.toLowerCase()
      filtered = filtered.filter(c => 
        (c.secretName && c.secretName.toLowerCase().includes(searchLower)) ||
        c.namespace.toLowerCase().includes(searchLower) ||
        (c.commonName && c.commonName.toLowerCase().includes(searchLower))
      )
    }
    
    return filtered
  }, [certificates, certificateFilter, certificatesNamespaceFilter, certificatesSearchTerm])

  // Memoized filtered and sorted images
  const filteredAndSortedImages = useMemo(() => {
    if (!clusterDetails) return []
    
    let filtered = clusterDetails.images
    
    if (imagesNamespaceFilter !== 'all') {
      filtered = filtered.filter(img => img.namespaces.includes(imagesNamespaceFilter))
    }
    
    if (imagesSearchTerm) {
      const searchLower = imagesSearchTerm.toLowerCase()
      filtered = filtered.filter(img => 
        img.name.toLowerCase().includes(searchLower) ||
        img.tag.toLowerCase().includes(searchLower) ||
        img.fullName.toLowerCase().includes(searchLower)
      )
    }
    
    // Sort images
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0
      
      switch (imagesSortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'tag':
          comparison = a.tag.localeCompare(b.tag)
          break
        case 'pods':
          comparison = a.podCount - b.podCount
          break
        case 'namespaces':
          comparison = a.namespaces.length - b.namespaces.length
          break
        case 'nodes':
          comparison = a.nodes.length - b.nodes.length
          break
        case 'pullPolicy':
          comparison = (a.pullPolicy || '').localeCompare(b.pullPolicy || '')
          break
        case 'age':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        default:
          comparison = 0
      }
      
      return imagesSortDirection === 'asc' ? comparison : -comparison
    })
    
    return sorted
  }, [clusterDetails, imagesNamespaceFilter, imagesSearchTerm, imagesSortField, imagesSortDirection])

  // Memoize fetch functions with useCallback
  const fetchClusterDetails = useCallback(async (showLoading = true) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    try {
      if (showLoading) setLoading(true)
      const response = await fetch(`/api/clusters/${clusterId}/details`, { signal: controller.signal })
      if (!response.ok) {
        throw new Error('Failed to fetch cluster details')
      }
      const data = await response.json()
      setError(null)
      // Preserve separately loaded data (openebsInfo, images) when updating
      setClusterDetails(prev => ({
        ...data,
        openebsInfo: prev?.openebsInfo || data.openebsInfo,
        images: prev?.images || data.images
      }))
      setLastUpdated(new Date())
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Loading cluster details timed out. Please try again.')
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred')
      }
    } finally {
      clearTimeout(timeout)
      if (showLoading) setLoading(false)
    }
  }, [clusterId])

  const fetchClusterHealthIssues = useCallback(async () => {
    try {
      const response = await fetch(`/api/clusters/${clusterId}/health`)
      if (!response.ok) {
        throw new Error('Failed to fetch cluster health issues')
      }

      const data = await response.json()
      setCustomerNamespaces(data.customerManagedNamespaces || [])
      setHealthIssues({
        podErrors: data.podErrors || [],
        podResourceWarnings: data.podResourceWarnings || [],
        certificateWarnings: data.certificateWarnings || [],
        certificateErrors: data.certificateErrors || [],
        cordonedNodeWarnings: data.cordonedNodeWarnings || [],
        cordonedNodeErrors: data.cordonedNodeErrors || [],
        recentEventErrors: data.recentEventErrors || []
      })
    } catch (err) {
      console.warn('Failed to fetch health issues:', err)
      setHealthIssues({
        podErrors: [],
        podResourceWarnings: [],
        certificateWarnings: [],
        certificateErrors: [],
        cordonedNodeWarnings: [],
        cordonedNodeErrors: [],
        recentEventErrors: []
      })
    }
  }, [clusterId])

  const fetchEvents = useCallback(async (force = false, silent = false) => {
    if (eventsLoading) return
    if (!force && eventsLoaded) return
    
    try {
      if (!silent) {
        setEventsLoading(true)
      }
      const response = await fetch(`/api/clusters/${clusterId}/events`)
      if (!response.ok) {
        throw new Error('Failed to fetch events')
      }
      const data = await response.json()
      const incomingEvents = Array.isArray(data.events) ? data.events : []
      const nextSignature = incomingEvents
        .map((event: EventDetails) => [
          event.type || '',
          event.reason || '',
          event.object || '',
          event.namespace || '',
          event.message || '',
          event.lastTime || '',
          String(event.count || 0)
        ].join('|'))
        .join('\n')

      if (nextSignature !== lastEventsSignatureRef.current) {
        setEvents(incomingEvents)
        lastEventsSignatureRef.current = nextSignature
      }
      setEventsLoaded(true)
    } catch (err) {
      console.error('Failed to fetch events:', err)
      setEvents([])
      lastEventsSignatureRef.current = ''
    } finally {
      if (!silent) {
        setEventsLoading(false)
      }
    }
  }, [clusterId, eventsLoaded, eventsLoading])

  const getEventFilterType = useCallback((event: EventDetails): string => {
    const type = (event.type || '').trim()
    const normalizedType = type.toLowerCase()

    if (normalizedType === 'warning') return 'Warning'
    if (normalizedType === 'normal') return 'Normal'
    if (normalizedType === 'error') return 'Error'

    const reason = (event.reason || '').toLowerCase()
    const message = (event.message || '').toLowerCase()
    if (reason.includes('error') || message.includes('error')) return 'Error'

    return type || 'Unknown'
  }, [])

  const availableEventTypes = useMemo(() => {
    return Array.from(new Set(events.map((event) => getEventFilterType(event)))).sort((a, b) => a.localeCompare(b))
  }, [events, getEventFilterType])

  const displayedEventTypes = useMemo(() => {
    const defaultTypes = ['Normal', 'Warning', 'Error']
    return Array.from(new Set([...defaultTypes, ...availableEventTypes]))
  }, [availableEventTypes])

  const filteredEvents = useMemo(() => {
    if (selectedEventTypes.length === 0) return []
    return events.filter((event) => selectedEventTypes.includes(getEventFilterType(event)))
  }, [events, selectedEventTypes, getEventFilterType])

  const loadImageUpdateState = useCallback(async () => {
    try {
      const response = await fetch(`/api/clusters/${clusterId}/images/update-state`)
      if (!response.ok) {
        return
      }

      const data = await response.json() as {
        imagesWithUpdates?: string[]
        imageUpdateDetails?: Record<string, { newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }>
        lastImageUpdateCheckAt?: string | null
      }

      setImagesWithUpdates(new Set(Array.isArray(data.imagesWithUpdates) ? data.imagesWithUpdates : []))
      setImageUpdateDetails(data.imageUpdateDetails && typeof data.imageUpdateDetails === 'object' ? data.imageUpdateDetails : {})
      setLastImageUpdateCheckAt(data.lastImageUpdateCheckAt || null)
    } catch (err) {
      console.warn('Failed to load persisted image update state:', err)
    }
  }, [clusterId])

  const persistImageUpdateState = useCallback(async (
    persistedImagesWithUpdates: Set<string>,
    persistedImageUpdateDetails: Record<string, { newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }>,
    persistedLastImageUpdateCheckAt: string | null
  ) => {
    try {
      await fetch(`/api/clusters/${clusterId}/images/update-state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          imagesWithUpdates: Array.from(persistedImagesWithUpdates),
          imageUpdateDetails: persistedImageUpdateDetails,
          lastImageUpdateCheckAt: persistedLastImageUpdateCheckAt
        })
      })
    } catch (err) {
      console.warn('Failed to persist image update state:', err)
    }
  }, [clusterId])

  useEffect(() => {
    loadImageUpdateState()
  }, [loadImageUpdateState])

  useEffect(() => {
    if (!clusterDetails?.images || clusterDetails.images.length === 0) return

    const validImageNames = new Set(clusterDetails.images.map(image => image.fullName))
    const filteredUpdates = new Set(Array.from(imagesWithUpdates).filter(imageName => validImageNames.has(imageName)))
    const filteredDetails = Object.fromEntries(
      Object.entries(imageUpdateDetails).filter(([imageName]) => validImageNames.has(imageName))
    ) as Record<string, { newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }>

    if (filteredUpdates.size !== imagesWithUpdates.size) {
      setImagesWithUpdates(filteredUpdates)
    }

    if (Object.keys(filteredDetails).length !== Object.keys(imageUpdateDetails).length) {
      setImageUpdateDetails(filteredDetails)
    }

    if (filteredUpdates.size !== imagesWithUpdates.size || Object.keys(filteredDetails).length !== Object.keys(imageUpdateDetails).length) {
      persistImageUpdateState(filteredUpdates, filteredDetails, lastImageUpdateCheckAt)
    }
  }, [clusterDetails?.images, imagesWithUpdates, imageUpdateDetails, lastImageUpdateCheckAt, persistImageUpdateState])

  useEffect(() => {
    if (displayedEventTypes.length === 0) {
      setSelectedEventTypes([])
      return
    }

    setSelectedEventTypes((prev) => {
      if (prev.length === 0) return displayedEventTypes

      const stillAvailable = prev.filter((type) => displayedEventTypes.includes(type))
      return stillAvailable.length > 0 ? stillAvailable : displayedEventTypes
    })
  }, [displayedEventTypes])

  useEffect(() => {
    if (activeTab !== 'events' || !autoRefreshEvents) return

    const interval = setInterval(() => {
      fetchEvents(true, true)
    }, 1000)

    return () => clearInterval(interval)
  }, [activeTab, autoRefreshEvents, fetchEvents])

  useEffect(() => {
    if (activeTab !== 'events' || !autoScrollEvents || !eventsContainerRef.current) return

    eventsContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [events, autoScrollEvents, activeTab])

  const fetchCertificates = useCallback(async () => {
    if (certificatesLoaded || certificatesLoading) return
    
    try {
      setCertificatesLoading(true)
      const response = await fetch(`/api/clusters/${clusterId}/certificates`)
      if (!response.ok) {
        throw new Error('Failed to fetch certificates')
      }
      const data = await response.json()
      setCertificates(data.certificates)
      setCertificatesStats({
        total: data.totalCertificates,
        expired: data.expiredCertificates,
        critical: data.criticalCertificates,
        warning: data.warningCertificates,
        valid: data.validCertificates,
        expiringSoon: data.criticalCertificates + data.warningCertificates,
        cnpgCritical: data.cnpgCriticalCertificates || 0,
        cnpgWarning: data.cnpgWarningCertificates || 0
      })
      setCertificatesLoaded(true)
    } catch (err) {
      console.error('Failed to fetch certificates:', err)
      setCertificates([])
    } finally {
      setCertificatesLoading(false)
    }
  }, [clusterId, certificatesLoaded, certificatesLoading])

  useEffect(() => {
    if (!clusterDetails || certificatesLoaded || certificatesLoading) return
    fetchCertificates()
  }, [clusterDetails, certificatesLoaded, certificatesLoading, fetchCertificates])

  const fetchStorage = useCallback(async () => {
    if (storageLoaded || storageLoading) return
    
    setStorageLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/storage`)
      if (!response.ok) {
        throw new Error('Failed to fetch storage')
      }
      const data = await response.json()
      setStorageData(data)
      setStorageLoaded(true)
    } catch (err) {
      console.error('Failed to fetch storage:', err)
      setStorageData(null)
    } finally {
      setStorageLoading(false)
    }
  }, [clusterId, storageLoaded, storageLoading])

  const fetchNetworking = useCallback(async (force = false) => {
    if ((!force && networkingLoaded) || networkingLoading) return
    
    setNetworkingLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/networking`)
      if (!response.ok) {
        throw new Error('Failed to fetch networking')
      }
      const data = await response.json()
      setNetworkingData(data)
      setNetworkingLoaded(true)
    } catch (err) {
      console.error('Failed to fetch networking:', err)
      setNetworkingData(null)
    } finally {
      setNetworkingLoading(false)
    }
  }, [clusterId, networkingLoaded, networkingLoading])

  const fetchRbac = useCallback(async () => {
    if (rbacLoaded || rbacLoading) return
    
    setRbacLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/rbac`)
      if (response.status === 401) {
        setRbacData({
          clusterRoleBindings: [],
          roleBindings: [],
          serviceAccounts: [],
          clusterRoles: {},
          roles: {},
          summary: {
            totalClusterRoleBindings: 0,
            totalRoleBindings: 0,
            totalServiceAccounts: 0,
            totalClusterRoles: 0,
            totalRoles: 0
          },
          error: 'Unauthorized'
        })
        setRbacLoaded(true)
        return
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData?.error || `Failed to fetch RBAC data (${response.status})`
        throw new Error(errorMessage)
      }
      const data = await response.json()
      setRbacData(data)
      setRbacLoaded(true)
    } catch (err) {
      console.warn('RBAC data unavailable:', err)
      setRbacData(null)
      setRbacLoaded(true)
    } finally {
      setRbacLoading(false)
    }
  }, [clusterId, rbacLoaded, rbacLoading])

  const fetchImages = useCallback(async () => {
    if (imagesLoaded || imagesLoading || !clusterDetails) return
    
    setImagesLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/images`)
      if (!response.ok) {
        throw new Error('Failed to fetch images')
      }
      const data = await response.json()
      // Update cluster details with images
      setClusterDetails(prev => prev ? { ...prev, images: data.images } : null)
      setImagesLoaded(true)
    } catch (err) {
      console.error('Failed to fetch images:', err)
    } finally {
      setImagesLoading(false)
    }
  }, [clusterId, imagesLoaded, imagesLoading, clusterDetails])

  const fetchOpenEBS = useCallback(async () => {
    if (openebsLoaded || openebsLoading || !clusterDetails) return
    
    setOpenebsLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/openebs`)
      if (!response.ok) {
        throw new Error('Failed to fetch OpenEBS info')
      }
      const data = await response.json()
      // Update cluster details with OpenEBS info
      setClusterDetails(prev => prev ? { ...prev, openebsInfo: data } : null)
      setOpenebsLoaded(true)
    } catch (err) {
      console.error('Failed to fetch OpenEBS info:', err)
    } finally {
      setOpenebsLoading(false)
    }
  }, [clusterId, openebsLoaded, openebsLoading, clusterDetails])

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tabId)
    window.history.replaceState(null, '', url)
    if (tabId === 'events' && !eventsLoaded) {
      fetchEvents()
    }
    if (tabId === 'certificates' && !certificatesLoaded) {
      fetchCertificates()
    }
    if (tabId === 'storage' && !storageLoaded) {
      fetchStorage()
    }
    if (tabId === 'networking') {
      fetchNetworking(true)
    }
    if (tabId === 'rbac' && !rbacLoaded) {
      fetchRbac()
    }
    if (tabId === 'images' && !imagesLoaded) {
      fetchImages()
    }
    if (tabId === 'openebs' && !openebsLoaded) {
      fetchOpenEBS()
    }
  }, [eventsLoaded, certificatesLoaded, storageLoaded, networkingLoaded, rbacLoaded, imagesLoaded, openebsLoaded, fetchEvents, fetchCertificates, fetchStorage, fetchNetworking, fetchRbac, fetchImages, fetchOpenEBS])

  const handleStoragePoolClick = useCallback((pool: OpenEBSStoragePool) => {
    setSelectedStoragePool(pool)
    setShowStoragePoolModal(true)
  }, [])

  const closeStoragePoolModal = useCallback(() => {
    setShowStoragePoolModal(false)
    setSelectedStoragePool(null)
  }, [])

  useEffect(() => {
    fetchClusterDetails(true) // Show loading on initial load
    fetchClusterHealthIssues()
    
    // Set up live data updates every 30 seconds (without page refresh).
    // Skipped while the tab is in the background, and never overlapping.
    let running = false
    const refresh = async () => {
      if (running || document.hidden) return
      running = true
      try {
        await Promise.all([
          fetchClusterDetails(false), // Don't show loading for background updates
          fetchClusterHealthIssues()
        ])
      } finally {
        running = false
      }
    }
    const interval = setInterval(refresh, 30000)
    document.addEventListener('visibilitychange', refresh)
    
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [clusterId, fetchClusterDetails, fetchClusterHealthIssues]) // Removed 'loading' from dependencies to prevent re-render loops

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'ready':
      case 'running':
      case 'active':
      case 'healthy':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'notready':
      case 'pending':
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case 'failed':
      case 'error':
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'ready':
      case 'running':
      case 'active':
      case 'healthy':
        return 'text-green-600 bg-green-50'
      case 'notready':
      case 'pending':
      case 'warning':
        return 'text-yellow-600 bg-yellow-50'
      case 'failed':
      case 'error':
      case 'unhealthy':
        return 'text-red-600 bg-red-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  const getVolumeStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'bound':
      case 'available':
        return 'bg-green-100 text-green-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'failed':
      case 'released':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getPoolStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'online':
      case 'healthy':
      case 'ready':
        return 'bg-green-100 text-green-800'
      case 'degraded':
      case 'warning':
        return 'bg-yellow-100 text-yellow-800'
      case 'offline':
      case 'failed':
      case 'error':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatStorageSize = (size: string | undefined) => {
    if (!size) return 'N/A'
    
    // If it's a pure number (likely bytes), convert directly
    if (/^\d+$/.test(size)) {
      const bytes = parseInt(size)
      return formatBytes(bytes)
    }
    
    // If it's a decimal number (likely bytes), convert directly
    if (/^\d+\.\d+$/.test(size)) {
      const bytes = parseFloat(size)
      return formatBytes(bytes)
    }
    
    // Handle Kubernetes storage size formats (Ki, Mi, Gi, Ti, Pi)
    const sizeRegex = /^(\d+(?:\.\d+)?)\s*([KMGTPE]?i?)$/i
    const match = size.match(sizeRegex)
    
    if (!match) {
      // If no match, try to extract just numbers and assume bytes
      const numMatch = size.match(/(\d+(?:\.\d+)?)/)
      if (numMatch) {
        const bytes = parseFloat(numMatch[1])
        return formatBytes(bytes)
      }
      return size // Return as is if we can't parse it
    }
    
    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()
    
    // Convert to bytes first
    let bytes = value
    switch (unit) {
      case 'KI':
      case 'K':
        bytes = value * 1024
        break
      case 'MI':
      case 'M':
        bytes = value * 1024 * 1024
        break
      case 'GI':
      case 'G':
        bytes = value * 1024 * 1024 * 1024
        break
      case 'TI':
      case 'T':
        bytes = value * 1024 * 1024 * 1024 * 1024
        break
      case 'PI':
      case 'P':
        bytes = value * 1024 * 1024 * 1024 * 1024 * 1024
        break
      default:
        // If no unit specified, assume bytes
        bytes = value
    }
    
    return formatBytes(bytes)
  }

  const formatAge = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    if (days > 0) return `${days}d`
    if (hours > 0) return `${hours}h`
    return `${minutes}m`
  }

  // Logs functions
  const fetchPods = async (namespace: string) => {
    if (!namespace) return
    
    try {
      const response = await fetch(`/api/clusters/${clusterId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace })
      })
      
      if (response.ok) {
        const data = await response.json()
        setNamespacePods(data.pods)
      }
    } catch (error) {
      console.error('Error fetching pods:', error)
    }
  }

  const fetchLogs = useCallback(async (namespace: string, pod: string, container?: string, showLoading = true) => {
    if (!namespace || !pod) {
      return
    }
    
    try {
      // Only show loading indicator on initial fetch, not during auto-refresh
      if (showLoading) {
        setLogsLoading(true)
      }
      const params = new URLSearchParams({
        namespace,
        pod,
        lines: '1000' // Increased to 1000 lines to match backend default
      })
      
      if (container) {
        params.append('container', container)
      }
      
      const response = await fetch(`/api/clusters/${clusterId}/logs?${params}`)
      
      if (response.ok) {
        const data = await response.json()
        // Only update if logs actually changed to prevent flickering
        if (data.logs) {
          setLogs(prev => (prev === data.logs ? prev : data.logs))
        } else {
          const fallbackMessage = 'No logs available for this container.'
          setLogs(prev => (prev === fallbackMessage ? prev : fallbackMessage))
        }
      } else {
        const errorData = await response.json()
        const errorMsg = 'Error fetching logs: ' + (errorData.error || response.statusText)
        setLogs(prev => (prev === errorMsg ? prev : errorMsg))
      }
    } catch (error) {
      const errorMsg = 'Error fetching logs: ' + (error as Error).message
      setLogs(prev => (prev === errorMsg ? prev : errorMsg))
    } finally {
      if (showLoading) {
        setLogsLoading(false)
      }
    }
  }, [clusterId])

  // Auto-refresh logs every 1 second when enabled (live tail)
  useEffect(() => {
    if (activeTab !== 'logs' || !autoRefreshLogs || !selectedNamespace || !selectedPod || !selectedContainer) {
      return
    }

    const interval = setInterval(() => {
      fetchLogs(selectedNamespace, selectedPod, selectedContainer, false) // Don't show loading during auto-refresh
    }, 1000)

    return () => clearInterval(interval)
  }, [activeTab, autoRefreshLogs, selectedNamespace, selectedPod, selectedContainer, fetchLogs])

  const handleNamespaceChange = async (namespace: string) => {
    setSelectedNamespace(namespace)
    setSelectedPod('')
    setSelectedContainer('')
    setLogs('')
    setPodContainers([])
    
    if (namespace) {
      await fetchPods(namespace)
    } else {
      setNamespacePods([])
    }
  }

  const handlePodChange = (podName: string) => {
    setSelectedPod(podName)
    setSelectedContainer('')
    setLogs('')
    
    const pod = namespacePods.find(p => p.name === podName)
    if (pod) {
      setPodContainers(pod.containers)
      // Auto-select and fetch first container
      if (pod.containers.length > 0) {
        const container = pod.containers[0].name
        setSelectedContainer(container)
        fetchLogs(selectedNamespace, podName, container)
      }
    } else {
      setPodContainers([])
    }
  }

  const handleContainerChange = (containerName: string) => {
    setSelectedContainer(containerName)
    if (containerName && selectedNamespace && selectedPod) {
      fetchLogs(selectedNamespace, selectedPod, containerName)
    }
  }

  // Images sorting
  const handleImageSort = (field: typeof imagesSortField) => {
    if (imagesSortField === field) {
      setImagesSortDirection(imagesSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setImagesSortField(field)
      setImagesSortDirection('asc')
    }
  }

  const getSortedImages = () => {
    if (!clusterDetails?.images) return []
    
    // First filter by search term, namespace, and update status
    const filtered = clusterDetails.images.filter(image => {
      const matchesSearch = image.name.toLowerCase().includes(imagesSearchTerm.toLowerCase())
      const matchesNamespace = imagesNamespaceFilter === 'all' || image.namespaces.includes(imagesNamespaceFilter)
      const matchesUpdateFilter = !imagesShowOnlyUpdates || imagesWithUpdates.has(image.fullName)
      return matchesSearch && matchesNamespace && matchesUpdateFilter
    })
    
    // Then sort
    const sorted = [...filtered].sort((a, b) => {
      let compareA: any
      let compareB: any
      
      switch (imagesSortField) {
        case 'name':
          compareA = a.name.toLowerCase()
          compareB = b.name.toLowerCase()
          break
        case 'tag':
          compareA = a.tag.toLowerCase()
          compareB = b.tag.toLowerCase()
          break
        case 'pods':
          compareA = a.podCount
          compareB = b.podCount
          break
        case 'namespaces':
          // Sort alphabetically by first namespace, fallback to empty string if no namespaces
          compareA = (a.namespaces[0] || '').toLowerCase()
          compareB = (b.namespaces[0] || '').toLowerCase()
          break
        case 'nodes':
          compareA = a.nodes.length
          compareB = b.nodes.length
          break
        case 'pullPolicy':
          compareA = (a.pullPolicy || 'IfNotPresent').toLowerCase()
          compareB = (b.pullPolicy || 'IfNotPresent').toLowerCase()
          break
        case 'age':
          compareA = new Date(a.createdAt).getTime()
          compareB = new Date(b.createdAt).getTime()
          break
        default:
          return 0
      }
      
      if (compareA < compareB) return imagesSortDirection === 'asc' ? -1 : 1
      if (compareA > compareB) return imagesSortDirection === 'asc' ? 1 : -1
      return 0
    })
    
    return sorted
  }

  // Check for image updates from registry
  const checkForImageUpdates = async () => {
    if (!clusterDetails?.images || checkingForUpdates) return
    
    try {
      setCheckingForUpdates(true)
      setShowUpdateCheckModal(true)
      
      const imagesToCheck = clusterDetails.images
      const results: Array<{ fullName: string; status: 'checking' | 'update-available' | 'up-to-date' | 'error'; error?: string; newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }> = 
        imagesToCheck.map(img => ({ fullName: img.fullName, status: 'checking' }))
      
      setUpdateCheckProgress({
        total: imagesToCheck.length,
        checked: 0,
        current: imagesToCheck[0]?.fullName || '',
        results
      })
      
      const updatedImages = new Set<string>()
      const updateDetailsMap: Record<string, { newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }> = {}
      
      // Check images one by one for real-time progress
      for (let i = 0; i < imagesToCheck.length; i++) {
        const image = imagesToCheck[i]
        
        setUpdateCheckProgress(prev => ({
          ...prev,
          current: image.fullName,
          checked: i
        }))
        
        console.log(`[Frontend] Checking image:`, {
          name: image.name,
          tag: image.tag,
          fullName: image.fullName
        })
        
        try {
          const response = await fetch(`/api/clusters/${clusterId}/images/check-updates`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              images: [{
                name: image.name,
                tag: image.tag,
                fullName: image.fullName
              }]
            })
          })
          
          if (response.ok) {
            const data = await response.json()
            const hasUpdate = data.imagesWithUpdates.length > 0
            const imageDetails = data.updateDetails?.[image.fullName]
            
            if (hasUpdate) {
              updatedImages.add(image.fullName)
            }

            updateDetailsMap[image.fullName] = {
              newerVersion: imageDetails?.newerVersion,
              checkedVia: imageDetails?.checkedVia
            }
            
            // Update the result for this image
            setUpdateCheckProgress(prev => ({
              ...prev,
              results: prev.results.map(r => 
                r.fullName === image.fullName 
                  ? {
                    ...r,
                    status: hasUpdate ? 'update-available' : 'up-to-date',
                    newerVersion: imageDetails?.newerVersion,
                    checkedVia: imageDetails?.checkedVia
                  }
                  : r
              )
            }))
          } else {
            setUpdateCheckProgress(prev => ({
              ...prev,
              results: prev.results.map(r => 
                r.fullName === image.fullName 
                  ? { ...r, status: 'error', error: 'Failed to check' }
                  : r
              )
            }))
          }
        } catch (err) {
          setUpdateCheckProgress(prev => ({
            ...prev,
            results: prev.results.map(r => 
              r.fullName === image.fullName 
                ? { ...r, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }
                : r
            )
          }))
        }
      }
      
      // Mark as complete
      setUpdateCheckProgress(prev => ({
        ...prev,
        checked: imagesToCheck.length,
        current: ''
      }))
      
      setImagesWithUpdates(updatedImages)
      setImageUpdateDetails(updateDetailsMap)
      const checkedAt = new Date().toISOString()
      setLastImageUpdateCheckAt(checkedAt)
      await persistImageUpdateState(updatedImages, updateDetailsMap, checkedAt)
    } catch (err) {
      console.error('Error checking for image updates:', err)
    } finally {
      setCheckingForUpdates(false)
    }
  }

  if (loading && !clusterDetails) {
    // Show skeleton only on initial load, not on refresh
    return (
      <AppShell title="Loading cluster…">
      <div className="theme-compat">
        <div>
          <div className="animate-pulse space-y-6">
            {/* Header skeleton */}
            <div className="flex items-center space-x-4">
              <div className="h-10 w-32 bg-gray-300 rounded"></div>
              <div className="h-8 w-64 bg-gray-300 rounded"></div>
            </div>
            {/* Cards skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white p-6 rounded-lg shadow">
                  <div className="h-4 w-24 bg-gray-300 rounded mb-2"></div>
                  <div className="h-8 w-16 bg-gray-300 rounded"></div>
                </div>
              ))}
            </div>
            {/* Content skeleton */}
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="h-6 w-48 bg-gray-300 rounded mb-4"></div>
              <div className="space-y-3">
                <div className="h-4 w-full bg-gray-300 rounded"></div>
                <div className="h-4 w-full bg-gray-300 rounded"></div>
                <div className="h-4 w-3/4 bg-gray-300 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </AppShell>
    )
  }

  if (!clusterDetails) {
    return (
      <AppShell title="Cluster">
      <div className="theme-compat">
        <div className="max-w-3xl">
          <Card className="p-6">
            <div className="text-center">
              <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Failed to load cluster details</h2>
              <p className="text-gray-600 mb-4">{error || 'Cluster not found'}</p>
              <Button onClick={fetchClusterDetails}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </Card>
        </div>
      </div>
      </AppShell>
    )
  }

  const clusterTabs: ClusterNavItem[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'nodes', label: 'Nodes', icon: Server },
    ...(clusterDetails.openebsInfo?.installed
      ? [{ id: 'openebs', label: 'OpenEBS', icon: Database }]
      : [{ id: 'storage', label: 'Storage', icon: HardDrive }]),
    { id: 'networking', label: 'Networking', icon: Globe },
    { id: 'images', label: 'Images', icon: Package },
    { id: 'helm', label: 'Helm', icon: Ship },
    { id: 'backups', label: 'Backups', icon: Archive },
    { id: 'workloads', label: 'Workloads', icon: Cpu },
    { id: 'services', label: 'Services', icon: Network },
    { id: 'certificates', label: 'Certificates', icon: Key },
    { id: 'rbac', label: 'RBAC/SA', icon: Users },
    { id: 'events', label: 'Events', icon: AlertTriangle },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'talos', label: 'Talos', icon: Shield },
  ].map(tab => {
    // Alert counts shown next to the Overview and Certificates entries
    if (tab.id === 'overview') {
      const alerts = getAllAlerts()
      return { ...tab, critical: alerts?.critical.length || 0, warning: alerts?.warning.length || 0 }
    }
    if (tab.id === 'certificates') {
      return {
        ...tab,
        critical: (certificatesStats.expired || 0) + (certificatesStats.critical || 0),
        warning: certificatesStats.warning || 0,
      }
    }
    return tab
  })
  const activeTabLabel = clusterTabs.find(tab => tab.id === activeTab)?.label

  return (
    <AppShell
      customerFilter
      title={
        <span className="flex items-center gap-2">
          {clusterDetails.name}
          {activeTabLabel && <span className="font-normal text-slate-500">/ {activeTabLabel}</span>}
        </span>
      }
      subtitle={
        <span className="flex items-center gap-1.5">
          <span className="status-dot status-dot-ok animate-pulse" />
          Live · updated {Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s ago
          {clusterDetails.description && <> · {clusterDetails.description}</>}
        </span>
      }
      actions={
        <button
          onClick={() => fetchClusterDetails(true)}
          disabled={loading}
          className="btn-secondary"
          title={loading ? 'Refreshing...' : 'Manual Refresh'}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      }
      clusterNav={{
        clusterId: Number(clusterId),
        items: clusterTabs,
        activeId: activeTab,
        onSelect: handleTabChange,
      }}
    >
      <div className="theme-compat">
        {/* Cluster Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-center">
              <Server className="h-8 w-8 text-blue-500 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Nodes</p>
                <p className="text-2xl font-bold">{clusterDetails.nodes.length}</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center">
              <Activity className="h-8 w-8 text-green-500 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Pods</p>
                <p className="text-2xl font-bold">{clusterDetails.metrics.podCount}</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center">
              <Cpu className="h-8 w-8 text-orange-500 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">CPU Usage</p>
                <p className="text-2xl font-bold">{((clusterDetails.metrics.usedCPU / clusterDetails.metrics.totalCPU) * 100).toFixed(1)}%</p>
              </div>
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center">
              <HardDrive className="h-8 w-8 text-purple-500 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Memory Usage</p>
                <p className="text-2xl font-bold">{((clusterDetails.metrics.usedMemory / clusterDetails.metrics.totalMemory) * 100).toFixed(1)}%</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Alerts Section */}
            {(() => {
              const alerts = getAllAlerts()
              const totalAlerts = alerts.critical.length + alerts.warning.length + alerts.info.length
              
              if (totalAlerts === 0) {
                return (
                  <Card className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <CheckCircle className="h-6 w-6 text-green-500 mr-3" />
                        <div>
                          <h3 className="text-lg font-semibold text-green-800">All Systems Healthy</h3>
                          <p className="text-sm text-green-600">No alerts detected across the cluster</p>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              }

              return (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center">
                      <AlertTriangle className="h-6 w-6 text-red-500 mr-3" />
                      Cluster Alerts
                      <span className="ml-2 text-sm bg-red-100 text-red-800 px-2 py-1 rounded-full">
                        {totalAlerts}
                      </span>
                    </h3>
                  </div>

                  <div className="space-y-4">
                    {/* Critical Alerts */}
                    {alerts.critical.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-red-800 mb-2 flex items-center">
                          <XCircle className="h-4 w-4 mr-2" />
                          Critical ({alerts.critical.length})
                        </h4>
                        <div className="space-y-2">
                          {alerts.critical.map((alert) => (
                            <div key={alert.id} className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center">
                                    <span className="text-sm font-medium text-red-900">{alert.title}</span>
                                    <span className="ml-2 text-xs bg-red-200 text-red-800 px-2 py-1 rounded-full">
                                      {alert.source}
                                    </span>
                                  </div>
                                  <p className="text-sm text-red-700 mt-1">{alert.message}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Warning Alerts */}
                    {alerts.warning.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-yellow-800 mb-2 flex items-center">
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          Warnings ({alerts.warning.length})
                        </h4>
                        <div className="space-y-2">
                          {alerts.warning.map((alert) => (
                            <div key={alert.id} className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center">
                                    <span className="text-sm font-medium text-yellow-900">{alert.title}</span>
                                    <span className="ml-2 text-xs bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">
                                      {alert.source}
                                    </span>
                                  </div>
                                  <p className="text-sm text-yellow-700 mt-1">{alert.message}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Info Alerts */}
                    {alerts.info.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-blue-800 mb-2 flex items-center">
                          <Clock className="h-4 w-4 mr-2" />
                          Information ({alerts.info.length})
                        </h4>
                        <div className="space-y-2">
                          {alerts.info.map((alert) => (
                            <div key={alert.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center">
                                    <span className="text-sm font-medium text-blue-900">{alert.title}</span>
                                    <span className="ml-2 text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">
                                      {alert.source}
                                    </span>
                                  </div>
                                  <p className="text-sm text-blue-700 mt-1">{alert.message}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })()}

            <HealthHistory clusterId={clusterId} />

            {/* Cluster Information */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Cluster Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-600">Endpoint</p>
                  <p className="text-sm text-gray-900">{clusterDetails.endpoint}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Kubernetes Version</p>
                  <p className="text-sm text-gray-900">{clusterDetails.kubernetesVersion}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Talos Version</p>
                  <p className="text-sm text-gray-900">{clusterDetails.talosVersion}</p>
                </div>
              </div>
            </Card>

            {/* Resource Usage */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">CPU Usage</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Used: {clusterDetails.metrics.usedCPU.toFixed(2)} cores</span>
                    <span>Total: {clusterDetails.metrics.totalCPU.toFixed(2)} cores</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full" 
                      style={{ width: `${(clusterDetails.metrics.usedCPU / clusterDetails.metrics.totalCPU) * 100}%` }}
                    ></div>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Memory Usage</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Used: {formatBytes(clusterDetails.metrics.usedMemory)}</span>
                    <span>Total: {formatBytes(clusterDetails.metrics.totalMemory)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full" 
                      style={{ width: `${(clusterDetails.metrics.usedMemory / clusterDetails.metrics.totalMemory) * 100}%` }}
                    ></div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'nodes' && (
          <div className="space-y-6">
            {/* Cluster-Wide Performance Overview */}
            <Card className="p-6 bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-gray-200">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <BarChart3 className="h-5 w-5 mr-2 text-gray-700" />
                Cluster Performance Overview
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Overall CPU */}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-gray-700">Cluster CPU</span>
                    <Cpu className="h-5 w-5 text-blue-600" />
                  </div>
                  {(() => {
                    const totalCPU = clusterDetails.nodes.reduce((sum, node) => sum + Number(node.cpuCapacity), 0)
                    const usedCPU = clusterDetails.nodes.reduce((sum, node) => sum + normalizeCpuUsageCores(Number(node.cpuUsage), Number(node.cpuCapacity)), 0)
                    const cpuPercent = totalCPU > 0 ? (usedCPU / totalCPU * 100) : 0
                    return (
                      <>
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-3xl font-bold text-gray-900">{cpuPercent.toFixed(1)}%</span>
                          <span className="text-sm text-gray-600">{usedCPU.toFixed(1)} / {totalCPU.toFixed(1)} cores</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div className={`h-3 rounded-full transition-all ${cpuPercent > 80 ? 'bg-red-500' : cpuPercent > 60 ? 'bg-yellow-500' : 'bg-blue-500'}`} 
                               style={{ width: `${Math.min(100, cpuPercent)}%` }}></div>
                        </div>
                      </>
                    )
                  })()}
                </div>
                
                {/* Overall Memory */}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-gray-700">Cluster Memory</span>
                    <HardDrive className="h-5 w-5 text-green-600" />
                  </div>
                  {(() => {
                    const totalMem = clusterDetails.nodes.reduce((sum, node) => sum + Number(node.memoryCapacity), 0)
                    const usedMem = clusterDetails.nodes.reduce((sum, node) => sum + Number(node.memoryUsage), 0)
                    const memPercent = totalMem > 0 ? (usedMem / totalMem * 100) : 0
                    return (
                      <>
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-3xl font-bold text-gray-900">{memPercent.toFixed(1)}%</span>
                          <span className="text-sm text-gray-600">{formatBytes(usedMem)} / {formatBytes(totalMem)}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div className={`h-3 rounded-full transition-all ${memPercent > 80 ? 'bg-red-500' : memPercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                               style={{ width: `${Math.min(100, memPercent)}%` }}></div>
                        </div>
                      </>
                    )
                  })()}
                </div>
                
                {/* Node Health */}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-gray-700">Node Health</span>
                    <Activity className="h-5 w-5 text-purple-600" />
                  </div>
                  {(() => {
                    const readyNodes = clusterDetails.nodes.filter(n => n.status === 'Ready').length
                    const totalNodes = clusterDetails.nodes.length
                    const healthPercent = totalNodes > 0 ? (readyNodes / totalNodes * 100) : 0
                    return (
                      <>
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-3xl font-bold text-gray-900">{readyNodes}/{totalNodes}</span>
                          <span className="text-sm text-gray-600">Ready</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div className={`h-3 rounded-full transition-all ${healthPercent === 100 ? 'bg-green-500' : healthPercent > 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                               style={{ width: `${healthPercent}%` }}></div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </Card>

            {/* Node Status Filters */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-medium text-gray-700 mr-2">Filter by Status:</span>
              <button
                onClick={() => setNodeStatusFilter('all')}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  nodeStatusFilter === 'all' 
                    ? 'bg-gray-900 text-white' 
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setNodeStatusFilter('ready')}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  nodeStatusFilter === 'ready' 
                    ? 'bg-green-600 text-white' 
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                Ready
              </button>
              <button
                onClick={() => setNodeStatusFilter('notready')}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  nodeStatusFilter === 'notready' 
                    ? 'bg-yellow-600 text-white' 
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                Not Ready
              </button>
              <button
                onClick={() => setNodeStatusFilter('cordoned')}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  nodeStatusFilter === 'cordoned' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                Cordoned
              </button>
            </div>

            {/* Dense Node Performance Table */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Node Performance</h3>
                <div className="flex items-center space-x-4 text-xs text-gray-600">
                  <div className="flex items-center"><div className="w-3 h-3 rounded bg-red-500 mr-1"></div> &gt;80%</div>
                  <div className="flex items-center"><div className="w-3 h-3 rounded bg-yellow-500 mr-1"></div> 60-80%</div>
                  <div className="flex items-center"><div className="w-3 h-3 rounded bg-blue-500 mr-1"></div> &lt;60%</div>
                </div>
              </div>
              
              <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full text-sm text-gray-900">
                  <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                    <tr>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'name') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('name')
                            setNodesSortDirection('asc')
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          Node
                          {nodesSortField === 'name' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'role') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('role')
                            setNodesSortDirection('asc')
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          Role
                          {nodesSortField === 'role' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'status') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('status')
                            setNodesSortDirection('asc')
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          Status
                          {nodesSortField === 'status' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'cpu') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('cpu')
                            setNodesSortDirection('desc') // Default to desc for CPU percentage
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          CPU
                          {nodesSortField === 'cpu' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'memory') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('memory')
                            setNodesSortDirection('desc') // Default to desc for memory percentage
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          Memory
                          {nodesSortField === 'memory' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'disk') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('disk')
                            setNodesSortDirection('desc') // Default to desc for disk percentage
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          Disk
                          {nodesSortField === 'disk' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'pods') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('pods')
                            setNodesSortDirection('desc') // Default to desc for pod count
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          Pods
                          {nodesSortField === 'pods' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                        onClick={() => {
                          if (nodesSortField === 'age') {
                            setNodesSortDirection(nodesSortDirection === 'asc' ? 'desc' : 'asc')
                          } else {
                            setNodesSortField('age')
                            setNodesSortDirection('asc')
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          Age
                          {nodesSortField === 'age' && (
                            nodesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {/* Sort and filter nodes: control plane first, then by name */}
                    {filteredNodes.map((node, index) => {
                        const cpuPercent = calculateCpuPercent(Number(node.cpuUsage), Number(node.cpuCapacity))
                        const memPercent = (Number(node.memoryUsage) / Number(node.memoryCapacity)) * 100
                        const diskPercent = (node.bootDiskUsage / node.bootDiskCapacity) * 100
                        const podsCount = clusterDetails.pods.filter(p => p.node === node.name).length
                        const isCP = node.roles.includes('control-plane')
                        const isHot = cpuPercent > 80 || memPercent > 80
                        const isError = node.status === 'CordonedNotReady'
                        
                        return (
                          <tr key={node.name} className={`hover:bg-gray-50 transition-colors ${
                            isError ? 'bg-red-100 border-l-4 border-red-600 font-semibold' : isHot ? 'bg-red-50' : ''
                          }`}>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center">
                                <div className={`p-1 rounded mr-2 ${isCP ? 'bg-blue-100' : 'bg-green-100'}`}>
                                  {isCP ? <Crown className="h-3 w-3 text-blue-600" /> : <Server className="h-3 w-3 text-green-600" />}
                                </div>
                                <span className="text-xs font-medium text-gray-900 truncate max-w-32">{node.name}</span>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${
                                isCP ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-green-100 text-green-800 border-green-200'
                              }`}>
                                {isCP ? 'Control' : 'Worker'}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${getStatusColor(node.status)}`}>
                                {getStatusIcon(node.status)}
                                <span className="ml-1">{node.status}</span>
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="w-24">
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <span className="font-medium">{cpuPercent.toFixed(1)}%</span>
                                  <span className="text-gray-500 text-xs">{Number(node.cpuUsage).toFixed(1)}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-1.5">
                                  <div className={`h-1.5 rounded-full ${cpuPercent > 80 ? 'bg-red-500' : cpuPercent > 60 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                                       style={{ width: `${Math.min(100, cpuPercent)}%` }}></div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="w-24">
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <span className="font-medium">{memPercent.toFixed(1)}%</span>
                                  <span className="text-gray-500 text-xs">{formatBytes(Number(node.memoryUsage))}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-1.5">
                                  <div className={`h-1.5 rounded-full ${memPercent > 80 ? 'bg-red-500' : memPercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                       style={{ width: `${Math.min(100, memPercent)}%` }}></div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="w-24">
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <span className="font-medium">{diskPercent.toFixed(1)}%</span>
                                  <span className="text-gray-500 text-xs">{formatBytes(node.bootDiskUsage)}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-1.5">
                                  <div className={`h-1.5 rounded-full ${diskPercent > 80 ? 'bg-red-500' : diskPercent > 60 ? 'bg-yellow-500' : 'bg-purple-500'}`}
                                       style={{ width: `${Math.min(100, diskPercent)}%` }}></div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                <Activity className="h-2.5 w-2.5 mr-1" />
                                {podsCount}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-xs text-gray-500 font-mono">{formatAge(node.createdAt)}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Search Bar for Detailed Cards */}
            <div className="mb-4">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search nodes by name or label (e.g., 'node1' or 'node-role.kubernetes.io/control-plane')..."
                  value={nodesSearchTerm}
                  onChange={(e) => setNodesSearchTerm(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
                {nodesSearchTerm && (
                  <button
                    onClick={() => setNodesSearchTerm('')}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Detailed Node Cards - Compact Version */}
            <div className="space-y-3">
              {filteredNodes
                .filter(node => {
                  if (!nodesSearchTerm) return true
                  const searchLower = nodesSearchTerm.toLowerCase()
                  // Search in node name
                  if (node.name.toLowerCase().includes(searchLower)) return true
                  // Search in labels
                  if (node.labels) {
                    return Object.entries(node.labels).some(([key, value]) => 
                      key.toLowerCase().includes(searchLower) || 
                      value.toLowerCase().includes(searchLower)
                    )
                  }
                  return false
                })
                .map((node) => {
                  const isError = node.status === 'CordonedNotReady'
                  const borderColor = isError ? 'border-red-600' : node.roles.includes('control-plane') ? 'border-blue-500' : 'border-green-500'
                  const bgColor = isError ? 'bg-red-100' : ''
                  
                  return (
                  <Card key={node.name} className={`p-4 border-l-4 ${borderColor} ${bgColor} ${isError ? 'shadow-lg shadow-red-200' : ''}`}>
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                      {/* Node Info */}
                      <div>
                        <div className="flex items-center mb-2">
                          {node.roles.includes('control-plane') ? 
                            <Crown className="h-4 w-4 text-blue-600 mr-2" /> : 
                            <Server className="h-4 w-4 text-green-600 mr-2" />
                          }
                          <h4 className="text-sm font-semibold">{node.name}</h4>
                        </div>
                        <div className="space-y-1 text-xs text-gray-600">
                          <div>IP: {node.addresses.find(a => a.type === 'InternalIP')?.address || 'N/A'}</div>
                          <div>Age: {formatAge(node.createdAt)}</div>
                          <div>v{node.version}</div>
                        </div>
                      </div>
                      
                      {/* System Info */}
                      <div className="text-xs">
                        <div className="font-semibold text-gray-700 mb-2">System</div>
                        <div className="space-y-1 text-gray-600">
                          <div className="truncate">{node.osImage}</div>
                          <div className="truncate">{node.kernelVersion}</div>
                          <div className="truncate">{node.containerRuntime}</div>
                        </div>
                      </div>
                      
                      {/* Resources */}
                      <div className="col-span-2">
                        <div className="font-semibold text-xs text-gray-700 mb-2">Resources</div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <div className="text-xs text-gray-600 mb-1">CPU</div>
                            <div className="text-sm font-bold">{calculateCpuPercent(Number(node.cpuUsage), Number(node.cpuCapacity)).toFixed(0)}%</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-600 mb-1">Memory</div>
                            <div className="text-sm font-bold">{((Number(node.memoryUsage) / Number(node.memoryCapacity)) * 100).toFixed(0)}%</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-600 mb-1">Disk</div>
                            <div className="text-sm font-bold">{((node.bootDiskUsage / node.bootDiskCapacity) * 100).toFixed(0)}%</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Node Labels & Taints */}
                    {((node.labels && Object.keys(node.labels).length > 0) || (node.taints && node.taints.length > 0)) && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        {node.labels && Object.keys(node.labels).length > 0 && (
                          <>
                            <div className="font-semibold text-xs text-gray-700 mb-2">Labels</div>
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(node.labels).map(([key, value]) => (
                                <span 
                                  key={key}
                                  className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-mono ${
                                    node.status === 'CordonedNotReady' 
                                      ? 'bg-red-200 text-red-900 border-2 border-red-500 font-semibold shadow-sm' 
                                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                                  }`}
                                >
                                  {key}={value}
                                </span>
                              ))}
                            </div>
                          </>
                        )}

                        {node.taints && node.taints.length > 0 && (
                          <>
                            <div className={`font-semibold text-xs text-gray-700 ${node.labels && Object.keys(node.labels).length > 0 ? 'mt-3 mb-2' : 'mb-2'}`}>
                              Taints
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {node.taints.map((taint) => {
                                const taintValue = taint.value ? `=${taint.value}` : ''
                                return (
                                  <span
                                    key={`${taint.key}:${taint.value || ''}:${taint.effect}`}
                                    className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-mono ${
                                      node.status === 'CordonedNotReady'
                                        ? 'bg-red-200 text-red-900 border-2 border-red-500 font-semibold shadow-sm'
                                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                                    }`}
                                  >
                                    {taint.key}{taintValue}:{taint.effect}
                                  </span>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </Card>
                  )
                })}
            </div>
          </div>
        )}

        {/* OpenEBS Tab */}
        {activeTab === 'openebs' && clusterDetails.openebsInfo?.installed && (
          <div className="space-y-6">
            {/* OpenEBS Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                <div className="flex items-center">
                  <div className="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                    <Database className="h-8 w-8 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-blue-700">Storage Classes</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {clusterDetails.openebsInfo.storageClasses.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                <div className="flex items-center">
                  <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                    <HardDrive className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-green-700">Volumes</p>
                    <p className="text-2xl font-bold text-green-900">
                      {clusterDetails.openebsInfo.volumes.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                <div className="flex items-center">
                  <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                    <Server className="h-8 w-8 text-purple-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-purple-700">Storage Pools</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {clusterDetails.openebsInfo.storagePools.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
                <div className="flex items-center">
                  <div className="p-3 bg-orange-500 bg-opacity-20 rounded-xl">
                    <Network className="h-8 w-8 text-orange-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-orange-700">Namespaces</p>
                    <p className="text-2xl font-bold text-orange-900">
                      {clusterDetails.openebsInfo.namespaces.length}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* OpenEBS Version and Status */}
            <Card className="p-6 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="p-3 bg-green-100 rounded-xl mr-4">
                    <Database className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">OpenEBS</h3>
                    <p className="text-gray-600">Container Storage Interface</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 border border-green-200">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    v{clusterDetails.openebsInfo.version || 'Unknown'}
                  </span>
                </div>
              </div>
            </Card>

            {/* Storage Classes */}
            {clusterDetails.openebsInfo.storageClasses.length > 0 && (
              <div>
                <div className="flex items-center mb-4">
                  <Database className="h-5 w-5 text-blue-600 mr-2" />
                  <h3 className="text-xl font-semibold text-gray-900">Storage Classes</h3>
                  <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                    {clusterDetails.openebsInfo.storageClasses.length}
                  </span>
                </div>
                
                <Card className="p-6 border-l-4 border-blue-500">
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Provisioner</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Reclaim Policy</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Volume Binding</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Expansion</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Age</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {clusterDetails.openebsInfo.storageClasses.map((sc) => (
                          <tr key={sc.name} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center">
                                <div className="p-2 bg-blue-100 rounded-lg mr-3">
                                  <Database className="h-4 w-4 text-blue-600" />
                                </div>
                                <span className="text-sm font-medium text-gray-900">{sc.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm text-gray-600 font-mono text-xs bg-gray-100 px-2 py-1 rounded border truncate max-w-48">
                                {sc.provisioner}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
                                sc.reclaimPolicy === 'Delete' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-green-100 text-green-800 border-green-200'
                              }`}>
                                {sc.reclaimPolicy === 'Delete' ? (
                                  <XCircle className="h-3 w-3 mr-1" />
                                ) : (
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                )}
                                {sc.reclaimPolicy}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                <Network className="h-3 w-3 mr-1" />
                                {sc.volumeBindingMode}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {sc.allowVolumeExpansion ? (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Allowed
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Disabled
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 font-mono">{sc.age}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* Volumes */}
            {clusterDetails.openebsInfo.volumes.length > 0 && (() => {
              // Get unique namespaces for the dropdown
              const uniqueNamespaces = Array.from(
                new Set(
                  clusterDetails.openebsInfo.volumes
                    .map(volume => volume.namespace)
                    .filter(namespace => namespace) // Filter out null/undefined
                )
              ).sort()

              // Filter and sort volumes based on search term, namespace, and sort criteria
              const filteredVolumes = sortVolumes(
                clusterDetails.openebsInfo.volumes.filter(volume => {
                  const matchesSearch = !volumesSearchTerm || 
                    volume.name.toLowerCase().includes(volumesSearchTerm.toLowerCase())
                  
                  const matchesNamespace = volumesNamespaceFilter === 'all' || 
                    volume.namespace === volumesNamespaceFilter

                  return matchesSearch && matchesNamespace
                }),
                volumesSortField,
                volumesSortDirection
              )

              return (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Volumes</h3>
                    <div className="flex items-center gap-4">
                      {/* Namespace Filter */}
                      <div className="flex items-center gap-2">
                        <label htmlFor="volumes-namespace-filter" className="text-sm font-medium text-gray-700">
                          Namespace:
                        </label>
                        <select
                          id="volumes-namespace-filter"
                          value={volumesNamespaceFilter}
                          onChange={(e) => setVolumesNamespaceFilter(e.target.value)}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="all">All Namespaces</option>
                          {uniqueNamespaces.map(namespace => (
                            <option key={namespace} value={namespace}>
                              {namespace}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Search */}
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        <input
                          type="text"
                          placeholder="Search volumes..."
                          value={volumesSearchTerm}
                          onChange={(e) => setVolumesSearchTerm(e.target.value)}
                          className="pl-10 pr-8 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-64"
                        />
                        {volumesSearchTerm && (
                          <button
                            onClick={() => setVolumesSearchTerm('')}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <span className="text-sm text-gray-500">
                        {filteredVolumes.length} of {clusterDetails.openebsInfo.volumes.length} volumes
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          {[
                            { key: 'name' as const, label: 'Name' },
                            { key: 'type' as const, label: 'Type' },
                            { key: 'namespace' as const, label: 'Namespace' },
                            { key: 'storageClass' as const, label: 'Storage Class' },
                            { key: 'capacity' as const, label: 'Capacity' },
                            { key: 'used' as const, label: 'Used' },
                            { key: 'available' as const, label: 'Available' },
                            { key: 'status' as const, label: 'Status' },
                            { key: 'age' as const, label: 'Age' }
                          ].map(({ key, label }) => (
                            <th 
                              key={key}
                              className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 transition-colors"
                              onClick={() => {
                                if (volumesSortField === key) {
                                  setVolumesSortDirection(volumesSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setVolumesSortField(key)
                                  setVolumesSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center gap-1">
                                {label}
                                {volumesSortField === key ? (
                                  volumesSortDirection === 'asc' ? (
                                    <ChevronUp className="h-3 w-3" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3" />
                                  )
                                ) : (
                                  <div className="h-3 w-3" /> /* Placeholder for alignment */
                                )}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredVolumes.map((volume, idx) => (
                        <tr key={`${volume.type}-${volume.name}-${idx}`} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2 text-sm font-medium text-gray-900 truncate max-w-48">{volume.name}</td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              volume.type === 'PersistentVolume' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                            }`}>
                              {volume.type === 'PersistentVolume' ? 'PV' : 'PVC'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {volume.namespace ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                {volume.namespace}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600 truncate max-w-32">{volume.storageClass}</td>
                          <td className="px-3 py-2 text-sm text-gray-600 font-mono text-xs">{volume.capacity}</td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {volume.used && volume.used !== 'Unknown' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 font-mono">
                                {volume.used}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {volume.available && volume.available !== 'Unknown' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 font-mono">
                                {volume.available}
                              </span>
                            ) : volume.capacity && volume.type === 'PersistentVolumeClaim' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 font-mono">
                                ~{volume.capacity}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getVolumeStatusColor(volume.status)}`}>
                              <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-current"></span>
                              {volume.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-500">{volume.age}</td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </div>
                </Card>
              )
            })()}

            {/* Storage Pools */}
            {clusterDetails.openebsInfo.storagePools.length > 0 && (
              <div>
                <div className="flex items-center mb-4">
                  <HardDrive className="h-5 w-5 text-purple-600 mr-2" />
                  <h3 className="text-xl font-semibold text-gray-900">Storage Pools by Node</h3>
                  <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">
                    {clusterDetails.openebsInfo.storagePools.length} pools
                  </span>
                </div>
                
                <div className="space-y-6">
                  {(() => {
                    // Group storage pools by node
                    const poolsByNode = clusterDetails.openebsInfo.storagePools.reduce((acc, pool) => {
                      const nodeName = pool.node || 'Unknown Node'
                      if (!acc[nodeName]) {
                        acc[nodeName] = []
                      }
                      acc[nodeName].push(pool)
                      return acc
                    }, {} as Record<string, typeof clusterDetails.openebsInfo.storagePools>)
                    
                    return Object.entries(poolsByNode).map(([nodeName, pools]) => (
                      <Card key={nodeName} className="p-6 border-l-4 border-purple-500 hover:shadow-lg transition-shadow duration-200">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center">
                            <div className="p-3 bg-purple-100 rounded-xl mr-4">
                              <Server className="h-6 w-6 text-purple-600" />
                            </div>
                            <div>
                              <h4 className="text-lg font-semibold text-gray-900">{nodeName}</h4>
                              <p className="text-gray-600">Storage Node</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 border border-purple-200">
                              <HardDrive className="h-4 w-4 mr-2" />
                              {pools.length} pool{pools.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {pools.map((pool, idx) => (
                            <div 
                              key={`${pool.name}-${idx}`} 
                              className="bg-gray-50 rounded-lg p-4 border border-gray-200 cursor-pointer hover:bg-white hover:border-purple-300 hover:shadow-md transition-all duration-200"
                              onClick={() => handleStoragePoolClick(pool)}
                            >
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center">
                                  <div className="p-2 bg-purple-100 rounded-lg mr-3">
                                    <Database className="h-4 w-4 text-purple-600" />
                                  </div>
                                  <h5 className="font-semibold text-gray-900 text-sm">{pool.name}</h5>
                                </div>
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getPoolStatusColor(pool.status)}`}>
                                  <span className="w-2 h-2 mr-1 rounded-full bg-current"></span>
                                  {pool.status}
                                </span>
                              </div>
                              
                              <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">Type:</span>
                                  <span className="font-medium bg-gray-100 px-2 py-0.5 rounded text-xs">{pool.type}</span>
                                </div>
                                
                                {pool.capacity && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Capacity:</span>
                                    <span className="font-mono text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                      {formatStorageSize(pool.capacity)}
                                    </span>
                                  </div>
                                )}
                                
                                {pool.used && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Used:</span>
                                    <span className="font-mono text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
                                      {formatStorageSize(pool.used)}
                                    </span>
                                  </div>
                                )}
                                
                                {pool.available && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Available:</span>
                                    <span className="font-mono text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                                      {formatStorageSize(pool.available)}
                                    </span>
                                  </div>
                                )}
                                
                                {pool.replicationFactor && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Replication:</span>
                                    <span className="font-medium">{pool.replicationFactor}</span>
                                  </div>
                                )}
                                
                                <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                                  <span className="text-gray-600">Age:</span>
                                  <span className="font-mono text-xs text-gray-500">{pool.age}</span>
                                </div>
                                
                                {/* Usage Progress Bar */}
                                {pool.capacity && pool.used && (() => {
                                  const usedBytes = safeParseFloat(pool.used)
                                  const capacityBytes = safeParseFloat(pool.capacity)
                                  const percentage = capacityBytes > 0 ? (usedBytes / capacityBytes) * 100 : 0
                                  const validPercentage = isNaN(percentage) ? 0 : percentage
                                  
                                  return (
                                    <div className="pt-2">
                                      <div className="flex justify-between text-xs mb-1">
                                        <span className="text-gray-600">Usage</span>
                                        <span className="font-medium">
                                          {validPercentage.toFixed(1)}%
                                        </span>
                                      </div>
                                      <div className="w-full bg-gray-200 rounded-full h-2">
                                        <div 
                                          className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
                                          style={{ 
                                            width: `${Math.min(100, validPercentage)}%` 
                                          }}
                                        ></div>
                                      </div>
                                    </div>
                                  )
                                })()}
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))
                  })()}
                </div>
              </div>
            )}

            {/* OpenEBS Nodes */}
            {clusterDetails.openebsInfo.nodes.length > 0 && (
              <div>
                <div className="flex items-center mb-4">
                  <Server className="h-5 w-5 text-teal-600 mr-2" />
                  <h3 className="text-xl font-semibold text-gray-900">OpenEBS Storage Nodes</h3>
                  <span className="ml-2 px-2 py-1 bg-teal-100 text-teal-800 text-xs font-medium rounded-full">
                    {clusterDetails.openebsInfo.nodes.length} nodes
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {clusterDetails.openebsInfo.nodes.map((node) => (
                    <Card key={node.name} className="p-6 border-l-4 border-teal-500 hover:shadow-lg transition-shadow duration-200">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center">
                          <div className="p-3 bg-teal-100 rounded-xl mr-4">
                            <Server className="h-6 w-6 text-teal-600" />
                          </div>
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900">{node.name}</h4>
                            <p className="text-gray-600 text-sm">Storage Node</p>
                          </div>
                        </div>
                      </div>

                      {/* Storage Information */}
                      <div className="bg-gray-50 rounded-lg p-4 mb-4">
                        <h5 className="font-semibold text-gray-700 mb-3 flex items-center">
                          <HardDrive className="h-4 w-4 mr-2" />
                          Storage Capacity
                        </h5>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600 text-sm">Total Capacity:</span>
                            <span className="font-mono text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              {formatStorageSize(node.storageCapacity)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600 text-sm">Allocatable:</span>
                            <span className="font-mono text-sm bg-green-100 text-green-800 px-2 py-1 rounded">
                              {formatStorageSize(node.storageAllocatable)}
                            </span>
                          </div>
                          
                          {/* Storage Usage Progress Bar */}
                          {node.storageCapacity && node.storageAllocatable && (
                            <div className="pt-2">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-600">Allocatable Storage</span>
                                <span className="font-medium">
                                  {node.allocatablePercentage}%
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div 
                                  className="bg-teal-500 h-2 rounded-full transition-all duration-300" 
                                  style={{ 
                                    width: `${Math.min(100, node.allocatablePercentage)}%` 
                                  }}
                                ></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* OpenEBS Labels */}
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h5 className="font-semibold text-gray-700 mb-3 flex items-center">
                          <Database className="h-4 w-4 mr-2" />
                          OpenEBS Labels
                          <span className="ml-2 px-1.5 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full">
                            {Object.keys(node.openebsLabels).length}
                          </span>
                        </h5>
                        <div className="space-y-2">
                          {Object.entries(node.openebsLabels).length > 0 ? (
                            Object.entries(node.openebsLabels).map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between p-2 bg-white rounded border">
                                <span className="text-gray-600 text-sm font-medium truncate flex-1 mr-2">
                                  {key}
                                </span>
                                <span className="text-gray-900 text-sm font-mono bg-gray-100 px-2 py-1 rounded flex-shrink-0">
                                  {value}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="flex items-center justify-center p-4 text-gray-500 text-sm">
                              <XCircle className="h-4 w-4 mr-2" />
                              No OpenEBS labels configured
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Networking Tab */}
        {activeTab === 'networking' && (
          <div className="space-y-6">
            {networkingLoading ? (
              <div className="flex items-center justify-center p-8">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                Loading networking information...
              </div>
            ) : networkingData ? (
              <>
                {/* Networking Overview Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                        <Globe className="h-8 w-8 text-green-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-green-600">Gateways / Routes</p>
                        <p className="text-2xl font-bold text-green-900">
                          {networkingData.gatewayApi?.installed
                            ? `${networkingData.statistics.totalGateways ?? 0} / ${networkingData.statistics.totalRoutes ?? 0}`
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                        <Shield className="h-8 w-8 text-purple-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-purple-600">Network Policies</p>
                        <p className="text-2xl font-bold text-purple-900">{networkingData.statistics.totalNetworkPolicies}</p>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                        <Router className="h-8 w-8 text-blue-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-blue-600">IP Pools</p>
                        <p className="text-2xl font-bold text-blue-900">{networkingData.statistics.totalIPPools}</p>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6 bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-orange-500 bg-opacity-20 rounded-xl">
                        <Wifi className="h-8 w-8 text-orange-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-orange-600">LoadBalancer IPs</p>
                        <p className="text-2xl font-bold text-orange-900">
                          {networkingData.ipPoolsAndSubnets?.subnets?.find((subnet: any) => subnet.type === 'LoadBalancer')?.count || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Network Traffic Visualization */}
                <div className="bg-gradient-to-r from-indigo-50 to-indigo-100 p-6 rounded-lg border-2 border-indigo-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-indigo-900 flex items-center">
                      <Network className="h-5 w-5 mr-2 text-indigo-600" />
                      Namespace Network Topology
                    </h3>
                    
                    <div className="flex items-center space-x-2">
                      <label className="text-sm font-medium text-indigo-700">Filter by namespace:</label>
                      <select
                        value={selectedNetworkNamespace}
                        onChange={(e) => setSelectedNetworkNamespace(e.target.value)}
                        className="px-3 py-2 border border-indigo-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="all">All Namespaces</option>
                        {clusterDetails?.namespaces
                          ?.filter((ns: any) => !['kube-system', 'kube-public', 'kube-node-lease'].includes(ns.name))
                          .map((ns: any) => (
                            <option key={ns.name} value={ns.name}>{ns.name}</option>
                          ))
                        }
                      </select>
                    </div>
                  </div>
                  
                  <NetworkVisualizationNew 
                    clusterId={clusterId}
                    namespace={selectedNetworkNamespace === 'all' ? undefined : selectedNetworkNamespace}
                  />
                </div>

                {/* Gateway API: Gateways, routes and classes */}
                {/* All namespaces: the namespace selector above belongs to the traffic visualization */}
                <GatewayApiSection data={networkingData.gatewayApi} hiddenNamespaces={hiddenNamespaces} namespace="all" />

                {/* Ingresses: only shown for clusters that still have them (replaced by the Gateway API) */}
                {networkingData.ingresses.length > 0 && (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <Globe className="h-5 w-5 mr-2 text-green-600" />
                      Ingresses ({networkingData.ingresses.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Namespace</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hosts</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Class</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Load Balancer</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {networkingData.ingresses.map((ingress: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{ingress.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{ingress.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {ingress.hosts.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {ingress.hosts.map((host: any, hostIdx: number) => (
                                    <span key={hostIdx} className="inline-flex px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                                      {host}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-400">No hosts</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{ingress.ingressClass}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {ingress.loadBalancer?.ingress?.[0]?.ip || ingress.loadBalancer?.ingress?.[0]?.hostname || 'Pending'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatAge(ingress.creationTimestamp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
                )}

                {/* IP Pools Section */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <Router className="h-5 w-5 mr-2 text-blue-600" />
                      LoadBalancer IP Pools ({networkingData.ipPoolsAndSubnets.ipPools.length})
                    </h3>
                  </div>
                  
                  {networkingData.ipPoolsAndSubnets.ipPools.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {networkingData.ipPoolsAndSubnets.ipPools.map((pool: any, idx: number) => (
                        <div key={idx} className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold text-blue-900">{pool.name}</h4>
                            <span className={`px-2 py-1 text-xs font-medium rounded ${
                              pool.type === 'MetalLB IP Pool' ? 'bg-purple-100 text-purple-800' :
                              pool.type === 'Calico IP Pool' ? 'bg-green-100 text-green-800' :
                              pool.type === 'Cilium Pod IP Pool' ? 'bg-orange-100 text-orange-800' :
                              pool.type?.includes('Antrea') ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {pool.type}
                            </span>
                          </div>
                          
                          <div className="space-y-2 text-sm">
                            {pool.cidr && (
                              <div className="flex items-center">
                                <span className="text-gray-600 mr-2">CIDR:</span>
                                <span className="font-mono bg-white px-2 py-1 rounded border">{pool.cidr}</span>
                              </div>
                            )}
                            
                            {pool.addresses && pool.addresses.length > 0 && (
                              <div>
                                <span className="text-gray-600 mb-1 block">Addresses:</span>
                                <div className="flex flex-wrap gap-1">
                                  {pool.addresses.map((addr: any, addrIdx: number) => (
                                    <span key={addrIdx} className="font-mono bg-white px-2 py-1 rounded border text-xs">
                                      {addr}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {pool.disabled !== undefined && (
                              <div className="flex items-center">
                                <span className="text-gray-600 mr-2">Status:</span>
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  pool.disabled ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                                }`}>
                                  {pool.disabled ? 'Disabled' : 'Enabled'}
                                </span>
                              </div>
                            )}
                            
                            {pool.natOutgoing !== undefined && (
                              <div className="flex items-center">
                                <span className="text-gray-600 mr-2">NAT Outgoing:</span>
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  pool.natOutgoing ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {pool.natOutgoing ? 'Yes' : 'No'}
                                </span>
                              </div>
                            )}
                            
                            {pool.maskSize && (
                              <div className="flex items-center">
                                <span className="text-gray-600 mr-2">Mask Size:</span>
                                <span className="font-mono bg-white px-2 py-1 rounded border">/{pool.maskSize}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Router className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                      <p>No IP pools configured or detected</p>
                      <p className="text-sm mt-1">IP pools from MetalLB, Calico, Cilium, or Antrea would appear here</p>
                    </div>
                  )}
                </Card>

                {/* Kubernetes Subnets Section */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <Wifi className="h-5 w-5 mr-2 text-orange-600" />
                      Kubernetes Network Subnets
                    </h3>
                  </div>
                  
                  <div className="space-y-6">
                    {/* Cluster CIDR Information */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {networkingData.ipPoolsAndSubnets.clusterCIDR && (
                        <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                          <div className="flex items-center mb-2">
                            <Network className="h-4 w-4 text-green-600 mr-2" />
                            <h4 className="font-semibold text-green-900">Cluster CIDR</h4>
                          </div>
                          <span className="font-mono text-sm bg-white px-3 py-2 rounded border block">
                            {networkingData.ipPoolsAndSubnets.clusterCIDR}
                          </span>
                        </div>
                      )}
                      
                      {networkingData.ipPoolsAndSubnets.serviceCIDR && (
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                          <div className="flex items-center mb-2">
                            <Router className="h-4 w-4 text-blue-600 mr-2" />
                            <h4 className="font-semibold text-blue-900">Service CIDR</h4>
                          </div>
                          <span className="font-mono text-sm bg-white px-3 py-2 rounded border block">
                            {networkingData.ipPoolsAndSubnets.serviceCIDR}
                          </span>
                        </div>
                      )}
                      
                      {networkingData.ipPoolsAndSubnets.podCIDR && networkingData.ipPoolsAndSubnets.podCIDR.length > 0 && (
                        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
                          <div className="flex items-center mb-2">
                            <Database className="h-4 w-4 text-purple-600 mr-2" />
                            <h4 className="font-semibold text-purple-900">Pod CIDRs</h4>
                          </div>
                          <div className="space-y-1">
                            {networkingData.ipPoolsAndSubnets.podCIDR.map((cidr: any, idx: number) => (
                              <span key={idx} className="font-mono text-sm bg-white px-3 py-2 rounded border block">
                                {cidr}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Used Subnets */}
                    {networkingData.ipPoolsAndSubnets.subnets.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                          <Layers className="h-4 w-4 mr-2" />
                          Used IP Addresses by Type
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {networkingData.ipPoolsAndSubnets.subnets.map((subnet: any, idx: number) => (
                            <div key={idx} className="bg-gray-50 p-4 rounded-lg border">
                              <div className="flex items-center justify-between mb-3">
                                <h5 className="font-medium text-gray-900">{subnet.name}</h5>
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  subnet.type === 'LoadBalancer' ? 'bg-purple-100 text-purple-800' :
                                  subnet.type === 'ClusterIP' ? 'bg-green-100 text-green-800' :
                                  subnet.type === 'Egress' ? 'bg-orange-100 text-orange-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {subnet.count} addresses
                                </span>
                              </div>
                              
                              {subnet.usedAddresses.length > 0 ? (
                                <div className="max-h-32 overflow-y-auto">
                                  <div className="flex flex-wrap gap-1">
                                    {subnet.usedAddresses.map((addr: any, addrIdx: number) => (
                                      <span key={addrIdx} className="font-mono text-xs bg-white px-2 py-1 rounded border">
                                        {addr}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-gray-500 text-sm">No addresses in use</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Network Policies Table */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <Shield className="h-5 w-5 mr-2 text-purple-600" />
                      Network Policies ({networkingData.networkPolicies.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Namespace</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Policy Types</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ingress Rules</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Egress Rules</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {networkingData.networkPolicies.map((policy: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{policy.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{policy.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <div className="flex flex-wrap gap-1">
                                {policy.policyTypes.map((type: any, typeIdx: number) => (
                                  <span key={typeIdx} className="inline-flex px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded">
                                    {type}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{policy.ingress.length}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{policy.egress.length}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatAge(policy.creationTimestamp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Load Balancer Addresses */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <Layers className="h-5 w-5 mr-2 text-orange-600" />
                      Load Balancer Addresses
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {networkingData.services
                      .filter((service: any) => service.type === 'LoadBalancer' && service.status?.loadBalancer?.ingress)
                      .map((service: any, idx: number) => (
                        <div key={idx} className="bg-gray-50 p-4 rounded-lg border">
                          <div className="font-medium text-gray-900 mb-2">{service.name}</div>
                          <div className="text-sm text-gray-600 mb-2">{service.namespace}</div>
                          <div className="space-y-1">
                            {service.status.loadBalancer.ingress.map((ing: any, ingIdx: number) => (
                              <div key={ingIdx} className="text-sm font-mono">
                                {ing.ip && (
                                  <div className="flex items-center">
                                    <span className="text-gray-500 mr-2">IP:</span>
                                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">{ing.ip}</span>
                                  </div>
                                )}
                                {ing.hostname && (
                                  <div className="flex items-center">
                                    <span className="text-gray-500 mr-2">Host:</span>
                                    <span className="bg-green-100 text-green-800 px-2 py-1 rounded">{ing.hostname}</span>
                                  </div>
                                )}
                              </div>
                            ))}

                            {((service.externalIPs && service.externalIPs.length > 0) || service.loadBalancerIP) && (
                              <div className="mt-2 pt-2 border-t border-gray-200">
                                <div className="text-xs text-gray-500 mb-1">Egress Addresses</div>
                                <div className="flex flex-wrap gap-1">
                                  {Array.from(new Set([
                                    ...(service.externalIPs || []),
                                    ...(service.loadBalancerIP ? [service.loadBalancerIP] : [])
                                  ])).map((egressIp: any, egressIdx: number) => (
                                    <span key={egressIdx} className="bg-orange-100 text-orange-800 px-2 py-1 rounded text-xs font-mono">
                                      {egressIp}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    {networkingData.services.filter((service: any) => service.type === 'LoadBalancer' && service.status?.loadBalancer?.ingress).length === 0 && (
                      <div className="col-span-full text-center text-gray-500 py-8">
                        <Layers className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                        No load balancer addresses found
                      </div>
                    )}
                  </div>
                </Card>
              </>
            ) : (
              <div className="flex items-center justify-center p-8 text-gray-500">
                <XCircle className="h-6 w-6 mr-2" />
                Failed to load networking information
              </div>
            )}
          </div>
        )}

        {/* Images Tab */}
        {activeTab === 'images' && (
          <div className="space-y-6">
            {/* Images Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="p-6 bg-gradient-to-r from-indigo-50 to-indigo-100 border-indigo-200">
                <div className="flex items-center">
                  <div className="p-3 bg-indigo-500 bg-opacity-20 rounded-xl">
                    <HardDrive className="h-8 w-8 text-indigo-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-indigo-700">Total Images</p>
                    <p className="text-2xl font-bold text-indigo-900">
                      {clusterDetails.images.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                <div className="flex items-center">
                  <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                    <Activity className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-green-700">Running Pods</p>
                    <p className="text-2xl font-bold text-green-900">
                      {new Set(clusterDetails.images.flatMap(img => img.pods.map(p => `${p.namespace}/${p.name}`))).size}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                <div className="flex items-center">
                  <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                    <Network className="h-8 w-8 text-purple-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-purple-700">Namespaces</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {new Set(clusterDetails.images.flatMap(img => img.namespaces)).size}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
                <div className="flex items-center">
                  <div className="p-3 bg-orange-500 bg-opacity-20 rounded-xl">
                    <Server className="h-8 w-8 text-orange-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-orange-700">Nodes</p>
                    <p className="text-2xl font-bold text-orange-900">
                      {new Set(clusterDetails.images.flatMap(img => img.nodes)).size}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Search Bar, Filters, and Check for Updates Button */}
            <div className="mb-4 flex gap-4">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search images by name..."
                  value={imagesSearchTerm}
                  onChange={(e) => setImagesSearchTerm(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
                {imagesSearchTerm && (
                  <button
                    onClick={() => setImagesSearchTerm('')}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              
              {/* Namespace Filter Dropdown */}
              <div className="w-64">
                <select
                  value={imagesNamespaceFilter}
                  onChange={(e) => setImagesNamespaceFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md leading-5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="all">All Namespaces</option>
                  {clusterDetails?.images && Array.from(new Set(clusterDetails.images.flatMap(img => img.namespaces))).sort().map(ns => (
                    <option key={ns} value={ns}>{ns}</option>
                  ))}
                </select>
              </div>
              
              {/* Check for Updates Button */}
              <div className="flex flex-col">
                <Button
                  onClick={checkForImageUpdates}
                  disabled={checkingForUpdates}
                  className="whitespace-nowrap"
                >
                  {checkingForUpdates ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Check for Updates
                    </>
                  )}
                </Button>
                {lastImageUpdateCheckAt && (
                  <span className="text-xs text-gray-500 mt-1">
                    Last checked: {new Date(lastImageUpdateCheckAt).toLocaleString()}
                  </span>
                )}
              </div>
              
              {/* Show update count if any found */}
              {imagesWithUpdates.size > 0 && (
                <div className="flex items-center px-3 py-2 bg-blue-100 text-blue-800 rounded-md border border-blue-300">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  <span className="text-sm font-medium">
                    {imagesWithUpdates.size} update{imagesWithUpdates.size !== 1 ? 's' : ''} available
                  </span>
                </div>
              )}
            </div>

            {/* Images Table */}
            <div>
              <div className="flex items-center mb-4">
                <HardDrive className="h-5 w-5 text-indigo-600 mr-2" />
                <h3 className="text-xl font-semibold text-gray-900">Container Images</h3>
                <span className="ml-2 px-2 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full">
                  {getSortedImages().length} {imagesSearchTerm && `of ${clusterDetails.images.length}`} images
                </span>
                {imagesWithUpdates.size > 0 && (
                  <button
                    onClick={() => setImagesShowOnlyUpdates(!imagesShowOnlyUpdates)}
                    className={`ml-2 px-2 py-1 text-xs font-bold rounded-full flex items-center transition-colors ${
                      imagesShowOnlyUpdates 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-blue-500 text-white hover:bg-blue-600 animate-pulse'
                    }`}
                    title={imagesShowOnlyUpdates ? 'Show all images' : 'Show only images with updates'}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {imagesWithUpdates.size} update{imagesWithUpdates.size > 1 ? 's' : ''} available
                  </button>
                )}
              </div>
              
              <Card className="p-3 border-l-4 border-indigo-500">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th 
                          className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleImageSort('name')}
                        >
                          <div className="flex items-center">
                            Image
                            {imagesSortField === 'name' && (
                              <span className="ml-1">{imagesSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleImageSort('pods')}
                        >
                          <div className="flex items-center">
                            Pods
                            {imagesSortField === 'pods' && (
                              <span className="ml-1">{imagesSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleImageSort('namespaces')}
                        >
                          <div className="flex items-center">
                            Namespaces
                            {imagesSortField === 'namespaces' && (
                              <span className="ml-1">{imagesSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleImageSort('nodes')}
                        >
                          <div className="flex items-center">
                            Nodes
                            {imagesSortField === 'nodes' && (
                              <span className="ml-1">{imagesSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleImageSort('pullPolicy')}
                        >
                          <div className="flex items-center">
                            Pull
                            {imagesSortField === 'pullPolicy' && (
                              <span className="ml-1">{imagesSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleImageSort('age')}
                        >
                          <div className="flex items-center">
                            Age
                            {imagesSortField === 'age' && (
                              <span className="ml-1">{imagesSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleImageSort('tag')}
                        >
                          <div className="flex items-center">
                            Tag
                            {imagesSortField === 'tag' && (
                              <span className="ml-1">{imagesSortDirection === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {getSortedImages().map((image, idx) => {
                        const hasUpdate = imagesWithUpdates.has(image.fullName)
                        return (
                          <tr 
                            key={`${image.fullName}-${idx}`} 
                            className={`hover:bg-gray-50 transition-colors ${hasUpdate ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                          >
                            <td className="px-2 py-1.5">
                              <div className="flex items-center">
                                <div className="p-1 bg-indigo-100 rounded mr-1.5">
                                  <HardDrive className="h-3 w-3 text-indigo-600" />
                                </div>
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-900 truncate block" title={image.fullName}>{image.fullName}</span>
                                  {hasUpdate && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold bg-blue-500 text-white animate-pulse">
                                      <RefreshCw className="h-3 w-3 mr-1" />
                                      UPDATE
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                {image.podCount}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-600">{image.namespaces.join(', ')}</span>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="text-xs text-gray-600 truncate block max-w-[200px]" title={image.nodes.join(', ')}>
                                {image.nodes.join(', ')}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                image.pullPolicy === 'Always' ? 'bg-yellow-100 text-yellow-800' :
                                image.pullPolicy === 'Never' ? 'bg-red-100 text-red-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {image.pullPolicy || 'IfNotPresent'}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-xs text-gray-500 font-mono">{formatAge(image.createdAt)}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-gray-100 text-gray-800 border">
                                  {image.tag}
                                </span>
                                {hasUpdate && imageUpdateDetails[image.fullName]?.newerVersion && (
                                  <>
                                    <span className="text-blue-600">→</span>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-blue-500 text-white border border-blue-600">
                                      {imageUpdateDetails[image.fullName].newerVersion}
                                    </span>
                                  </>
                                )}
                                {hasUpdate && !imageUpdateDetails[image.fullName]?.newerVersion && (
                                  <span className="inline-flex items-center text-blue-600" title="Newer version available">
                                    <TrendingUp className="h-4 w-4" />
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {getSortedImages().length === 0 && (
                  <div className="text-center py-8">
                    <HardDrive className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-500">
                      {imagesSearchTerm ? `No images match "${imagesSearchTerm}"` : 'No container images found'}
                    </p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* Storage Tab */}
        {activeTab === 'storage' && !clusterDetails.openebsInfo?.installed && (
          <div className="space-y-6">
            {storageLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <span className="ml-3 text-gray-600">Loading storage information...</span>
              </div>
            ) : storageData && storageData.statistics ? (
              <>
                {/* Storage Overview Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                  <Card className="p-6 bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-orange-500 bg-opacity-20 rounded-xl">
                        <HardDrive className="h-8 w-8 text-orange-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-orange-700">Persistent Volumes</p>
                        <p className="text-2xl font-bold text-orange-900">
                          {storageData.statistics?.totalPVs || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                        <Database className="h-8 w-8 text-blue-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-blue-700">Storage Classes</p>
                        <p className="text-2xl font-bold text-blue-900">
                          {storageData.statistics?.totalStorageClasses || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-6 bg-gradient-to-r from-teal-50 to-teal-100 border-teal-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-teal-500 bg-opacity-20 rounded-xl">
                        <Database className="h-8 w-8 text-teal-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-teal-700">Persistent Volume Claims</p>
                        <p className="text-2xl font-bold text-teal-900">
                          {storageData.statistics?.totalPVCs || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                        <BarChart3 className="h-8 w-8 text-purple-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-purple-700">Total Capacity</p>
                        <p className="text-2xl font-bold text-purple-900">
                          {storageData.statistics?.totalCapacity || '0'}
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                        <CheckCircle className="h-8 w-8 text-green-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-green-700">Bound PVs</p>
                        <p className="text-2xl font-bold text-green-900">
                          {storageData.statistics?.boundPVs || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Storage Classes Table */}
                <div>
                  <div className="flex items-center mb-4">
                    <Database className="h-5 w-5 text-blue-600 mr-2" />
                    <h3 className="text-xl font-semibold text-gray-900">Storage Classes</h3>
                    <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                      {storageData.storageClasses?.length || 0} classes
                    </span>
                  </div>
                  
                  <Card className="p-4 border-l-4 border-blue-500">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Name</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Provisioner</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Reclaim Policy</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Volume Binding</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Expansion</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Default</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Age</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(storageData.storageClasses || []).map((sc: any) => (
                            <tr key={sc.name} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2">
                                <div className="flex items-center">
                                  <div className="p-1 bg-blue-100 rounded mr-2">
                                    <Database className="h-3 w-3 text-blue-600" />
                                  </div>
                                  <span className="text-xs font-medium text-gray-900 truncate max-w-48">{sc.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded">
                                  {sc.provisioner}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  sc.reclaimPolicy === 'Delete' ? 'bg-red-100 text-red-800' :
                                  sc.reclaimPolicy === 'Retain' ? 'bg-green-100 text-green-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {sc.reclaimPolicy}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600">{sc.volumeBindingMode}</span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  sc.allowVolumeExpansion ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {sc.allowVolumeExpansion ? (
                                    <>
                                      <CheckCircle className="h-2.5 w-2.5 mr-1" />
                                      Yes
                                    </>
                                  ) : (
                                    'No'
                                  )}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {sc.isDefault ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                    <CheckCircle className="h-2.5 w-2.5 mr-1" />
                                    Default
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 font-mono">{sc.age}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(storageData.storageClasses?.length || 0) === 0 && (
                      <div className="text-center py-8">
                        <Database className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                        <p className="text-gray-500">No storage classes found</p>
                      </div>
                    )}
                  </Card>
                </div>

                {/* Persistent Volumes Table */}
                <div>
                  <div className="flex items-center mb-4">
                    <HardDrive className="h-5 w-5 text-orange-600 mr-2" />
                    <h3 className="text-xl font-semibold text-gray-900">Persistent Volumes</h3>
                    <span className="ml-2 px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full">
                      {storageData.persistentVolumes?.length || 0} volumes
                    </span>
                  </div>
                  
                  <Card className="p-4 border-l-4 border-orange-500">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Name</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Capacity</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Claim</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Storage Class</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Age</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(storageData.persistentVolumes || []).map((pv: any) => (
                            <tr key={pv.name} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2">
                                <div className="flex items-center">
                                  <div className="p-1 bg-orange-100 rounded mr-2">
                                    <HardDrive className="h-3 w-3 text-orange-600" />
                                  </div>
                                  <span className="text-xs font-medium text-gray-900 truncate max-w-48">{pv.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">
                                  {pv.capacity}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  pv.status === 'Bound' ? 'bg-green-100 text-green-800' :
                                  pv.status === 'Available' ? 'bg-blue-100 text-blue-800' :
                                  'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {pv.status === 'Bound' && <CheckCircle className="h-2.5 w-2.5 mr-1" />}
                                  {pv.status}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {pv.claimName ? (
                                  <span className="text-xs text-blue-600 font-medium">{pv.claimName}</span>
                                ) : (
                                  <span className="text-xs text-gray-400">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600">{pv.storageClass || '-'}</span>
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 font-mono">{pv.age}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(storageData.persistentVolumes?.length || 0) === 0 && (
                      <div className="text-center py-8">
                        <HardDrive className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                        <p className="text-gray-500">No persistent volumes found</p>
                      </div>
                    )}
                  </Card>
                </div>

                {/* Persistent Volume Claims Table */}
                <div>
                  <div className="flex items-center mb-4">
                    <Database className="h-5 w-5 text-teal-600 mr-2" />
                    <h3 className="text-xl font-semibold text-gray-900">Persistent Volume Claims</h3>
                    <span className="ml-2 px-2 py-1 bg-teal-100 text-teal-800 text-xs font-medium rounded-full">
                      {storageData.persistentVolumeClaims?.length || 0} claims
                    </span>
                  </div>
                  
                  <Card className="p-4 border-l-4 border-teal-500">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Name</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Namespace</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Capacity</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Used</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Free</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Usage %</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Usage Source</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Volume</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Storage Class</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Age</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(storageData.persistentVolumeClaims || []).map((pvc: any) => (
                            <tr key={`${pvc.namespace}-${pvc.name}`} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2">
                                <div className="flex items-center">
                                  <div className="p-1 bg-teal-100 rounded mr-2">
                                    <Database className="h-3 w-3 text-teal-600" />
                                  </div>
                                  <span className="text-xs font-medium text-gray-900 truncate max-w-48">{pvc.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                  <Network className="h-2.5 w-2.5 mr-1" />
                                  {pvc.namespace}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">
                                  {pvc.capacity}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {pvc.usedStorage && pvc.usedStorage !== '0B' ? (
                                  <span className="inline-flex items-center text-xs font-mono tabular-nums whitespace-nowrap text-orange-700 bg-orange-100 px-2 py-1 rounded">
                                    {pvc.usedStorage}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-xs text-gray-400 whitespace-nowrap">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {pvc.freeStorage && pvc.freeStorage !== '0B' ? (
                                  <span className="inline-flex items-center text-xs font-mono tabular-nums whitespace-nowrap text-green-700 bg-green-100 px-2 py-1 rounded">
                                    {pvc.freeStorage}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-xs text-gray-400 whitespace-nowrap">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {pvc.usagePercentage !== undefined && pvc.usagePercentage > 0 ? (
                                  <div className="flex items-center space-x-2">
                                    <div className="w-12 bg-gray-200 rounded-full h-2">
                                      <div 
                                        className={`h-2 rounded-full ${
                                          pvc.usagePercentage > 80 ? 'bg-red-500' :
                                          pvc.usagePercentage > 60 ? 'bg-yellow-500' :
                                          'bg-green-500'
                                        }`}
                                        style={{ width: `${Math.min(pvc.usagePercentage, 100)}%` }}
                                      ></div>
                                    </div>
                                    <span className={`text-xs font-medium ${
                                      pvc.usagePercentage > 80 ? 'text-red-700' :
                                      pvc.usagePercentage > 60 ? 'text-yellow-700' :
                                      'text-green-700'
                                    }`}>
                                      {pvc.usagePercentage}%
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {pvc.usageStatus === 'Measured via df' ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                    {pvc.usageStatus}
                                  </span>
                                ) : pvc.usageStatus === 'Mounted pod found, df failed' ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                                    {pvc.usageStatus}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                                    {pvc.usageStatus || 'Unknown'}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  pvc.status === 'Bound' ? 'bg-green-100 text-green-800' :
                                  pvc.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-red-100 text-red-800'
                                }`}>
                                  {pvc.status === 'Bound' && <CheckCircle className="h-2.5 w-2.5 mr-1" />}
                                  {pvc.status}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {pvc.volumeName ? (
                                  <span className="text-xs text-orange-600 font-medium">{pvc.volumeName}</span>
                                ) : (
                                  <span className="text-xs text-gray-400">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600">{pvc.storageClass || '-'}</span>
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 font-mono">{pvc.age}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(storageData.persistentVolumeClaims?.length || 0) === 0 && (
                      <div className="text-center py-8">
                        <Database className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                        <p className="text-gray-500">No persistent volume claims found</p>
                      </div>
                    )}
                  </Card>
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <HardDrive className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">Failed to load storage information</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'workloads' && (
          <div className="space-y-6">
            {/* Workloads Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                <div className="flex items-center">
                  <div className="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                    <Cpu className="h-8 w-8 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-blue-700">Deployments</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {clusterDetails.deployments.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                <div className="flex items-center">
                  <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                    <Activity className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-green-700">Total Pods</p>
                    <p className="text-2xl font-bold text-green-900">
                      {clusterDetails.pods.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                <div className="flex items-center">
                  <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                    <Network className="h-8 w-8 text-purple-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-purple-700">Namespaces</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {new Set(clusterDetails.pods.map(pod => pod.namespace)).size}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
                <div className="flex items-center">
                  <div className="p-3 bg-orange-500 bg-opacity-20 rounded-xl">
                    <AlertTriangle className="h-8 w-8 text-orange-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-orange-700">With Restarts</p>
                    <p className="text-2xl font-bold text-orange-900">
                      {clusterDetails.pods.filter(pod => pod.restarts > 0).length}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Deployments */}
            <div>
              <div className="flex items-center mb-4">
                <Cpu className="h-5 w-5 text-blue-600 mr-2" />
                <h3 className="text-xl font-semibold text-gray-900">Deployments</h3>
                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                  {filteredAndSortedDeployments.length}
                </span>
              </div>
              
              {/* Deployments Search */}
              <div className="mb-4">
                <div className="relative max-w-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Search deployments by name..."
                    value={deploymentsSearchTerm}
                    onChange={(e) => setDeploymentsSearchTerm(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {deploymentsSearchTerm && (
                    <button
                      onClick={() => setDeploymentsSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              
              <Card className="p-4 border-l-4 border-blue-500">
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full text-sm text-gray-900">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                      <tr>
                        <th 
                          className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                          onClick={() => {
                            if (deploymentsSortField === 'name') {
                              setDeploymentsSortDirection(deploymentsSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setDeploymentsSortField('name')
                              setDeploymentsSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Deployment
                            {deploymentsSortField === 'name' && (
                              deploymentsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                          onClick={() => {
                            if (deploymentsSortField === 'namespace') {
                              setDeploymentsSortDirection(deploymentsSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setDeploymentsSortField('namespace')
                              setDeploymentsSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Namespace
                            {deploymentsSortField === 'namespace' && (
                              deploymentsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                          onClick={() => {
                            if (deploymentsSortField === 'ready') {
                              setDeploymentsSortDirection(deploymentsSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setDeploymentsSortField('ready')
                              setDeploymentsSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Ready
                            {deploymentsSortField === 'ready' && (
                              deploymentsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                          onClick={() => {
                            if (deploymentsSortField === 'upToDate') {
                              setDeploymentsSortDirection(deploymentsSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setDeploymentsSortField('upToDate')
                              setDeploymentsSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Up-to-date
                            {deploymentsSortField === 'upToDate' && (
                              deploymentsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                          onClick={() => {
                            if (deploymentsSortField === 'available') {
                              setDeploymentsSortDirection(deploymentsSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setDeploymentsSortField('available')
                              setDeploymentsSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Available
                            {deploymentsSortField === 'available' && (
                              deploymentsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                          onClick={() => {
                            if (deploymentsSortField === 'age') {
                              setDeploymentsSortDirection(deploymentsSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setDeploymentsSortField('age')
                              setDeploymentsSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Age
                            {deploymentsSortField === 'age' && (
                              deploymentsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredAndSortedDeployments.map((deployment) => (
                        <tr key={`${deployment.namespace}-${deployment.name}`} className="hover:bg-gray-50 transition-colors">
                          <td className="px-2 py-1.5">
                            <div className="flex items-center">
                              <div className="p-1 bg-blue-100 rounded mr-2">
                                <Cpu className="h-2.5 w-2.5 text-blue-600" />
                              </div>
                              <span className="text-xs font-medium text-gray-900 truncate max-w-48">{deployment.name}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                              <Database className="h-2.5 w-2.5 mr-1" />
                              {deployment.namespace}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                              <CheckCircle className="h-2.5 w-2.5 mr-1" />
                              {deployment.ready}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                              {deployment.upToDate}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                              {deployment.available}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-xs text-gray-500 font-mono">{deployment.age}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Pods */}
            <div>
              {/* Search Bar */}
              <div className="mb-4">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Search pods by name..."
                    value={workloadsSearchTerm}
                    onChange={(e) => setWorkloadsSearchTerm(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-green-500 focus:border-green-500 sm:text-sm"
                  />
                  {workloadsSearchTerm && (
                    <button
                      onClick={() => setWorkloadsSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Activity className="h-5 w-5 text-green-600 mr-2" />
                  <h3 className="text-xl font-semibold text-gray-900">Pods</h3>
                  <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                    {clusterDetails.pods
                      .filter(pod => workloadsNamespaceFilter === 'all' || pod.namespace === workloadsNamespaceFilter)
                      .filter(pod => pod.name.toLowerCase().includes(workloadsSearchTerm.toLowerCase()))
                      .length}
                  </span>
                </div>
                
                {/* Namespace Filter */}
                <div className="flex items-center space-x-2">
                  <label className="text-sm font-medium text-gray-700">Namespace:</label>
                  <select
                    className="px-3 py-1 border rounded text-sm bg-white min-w-[150px]"
                    value={workloadsNamespaceFilter}
                    onChange={(e) => setWorkloadsNamespaceFilter(e.target.value)}
                  >
                    <option value="all">All Namespaces</option>
                    {[...new Set(clusterDetails.pods.map(pod => pod.namespace))].sort().map((namespace) => (
                      <option key={namespace} value={namespace}>
                        {namespace} ({clusterDetails.pods.filter(pod => pod.namespace === namespace).length})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <Card className="p-4 border-l-4 border-green-500">
                <div className="overflow-x-auto -mx-4 px-4">
                  <div className="inline-block min-w-full align-middle">
                    <div className="max-h-[600px] overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="sticky top-0 bg-white z-10 shadow-sm">
                          <tr className="border-b border-gray-200">
                            {[
                              { key: 'name' as const, label: 'Pod' },
                              { key: 'namespace' as const, label: 'Namespace' },
                              { key: 'status' as const, label: 'Status' },
                              { key: 'ready' as const, label: 'Ready' },
                              { key: 'restarts' as const, label: 'Restarts' },
                              { key: 'cpuUsage' as const, label: 'CPU Usage' },
                              { key: 'memoryUsage' as const, label: 'Mem Usage' },
                              { key: null, label: 'CPU Req' }, // Not sortable
                              { key: null, label: 'CPU Lim' }, // Not sortable
                              { key: null, label: 'Mem Req' }, // Not sortable
                              { key: null, label: 'Mem Lim' }, // Not sortable
                              { key: 'node' as const, label: 'Node' },
                              { key: 'age' as const, label: 'Age' }
                            ].map(({ key, label }, index) => (
                              <th 
                                key={index}
                                className={`px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap ${
                                  key ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''
                                }`}
                                onClick={key ? () => {
                                  if (podsSortField === key) {
                                    setPodsSortDirection(podsSortDirection === 'asc' ? 'desc' : 'asc')
                                  } else {
                                    setPodsSortField(key)
                                    setPodsSortDirection('asc')
                                  }
                                } : undefined}
                              >
                                <div className="flex items-center gap-1">
                                  {label}
                                  {key && podsSortField === key ? (
                                    podsSortDirection === 'asc' ? (
                                      <ChevronUp className="h-3 w-3" />
                                    ) : (
                                      <ChevronDown className="h-3 w-3" />
                                    )
                                  ) : key ? (
                                    <div className="h-3 w-3" /> /* Placeholder for alignment */
                                  ) : null}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                        {sortPods(
                          clusterDetails.pods
                            .filter(pod => workloadsNamespaceFilter === 'all' || pod.namespace === workloadsNamespaceFilter)
                            .filter(pod => pod.name.toLowerCase().includes(workloadsSearchTerm.toLowerCase())),
                          podsSortField,
                          podsSortDirection
                        ).map((pod) => (
                            <tr key={`${pod.namespace}-${pod.name}`} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2">
                                <div className="flex items-center">
                                  <div className="p-1.5 bg-green-100 rounded mr-2">
                                    <Activity className="h-3 w-3 text-green-600" />
                                  </div>
                                  <span className="text-xs font-medium text-gray-900 truncate max-w-48">{pod.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                  <Network className="h-2.5 w-2.5 mr-1" />
                                  {pod.namespace}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(pod.status)}`}>
                                  <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-current"></span>
                                  {pod.status}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                                  {pod.ready}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {pod.restarts > 0 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                                    <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                                    {pod.restarts}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                    <CheckCircle className="h-2.5 w-2.5 mr-1" />
                                    {pod.restarts}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-green-100 px-1.5 py-0.5 rounded border">
                                  {pod.currentUsage?.cpu || '-'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-green-100 px-1.5 py-0.5 rounded border">
                                  {pod.currentUsage?.memory || '-'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-blue-100 px-1.5 py-0.5 rounded border">
                                  {pod.resources?.requests.cpu || '-'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-orange-100 px-1.5 py-0.5 rounded border">
                                  {pod.resources?.limits.cpu || '-'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-blue-100 px-1.5 py-0.5 rounded border">
                                  {pod.resources?.requests.memory || '-'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-orange-100 px-1.5 py-0.5 rounded border">
                                  {pod.resources?.limits.memory || '-'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 font-mono bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-32">
                                  {pod.node}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 font-mono">{pod.age}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  </div>
                </div>
                {clusterDetails.pods.filter(pod => workloadsNamespaceFilter === 'all' || pod.namespace === workloadsNamespaceFilter).length === 0 && (
                  <div className="text-center py-8">
                    <Activity className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-500">No pods found</p>
                  </div>
                )}
                <div className="mt-3 px-4 py-2 bg-gray-50 rounded text-xs text-gray-600">
                  Showing {clusterDetails.pods.filter(pod => workloadsNamespaceFilter === 'all' || pod.namespace === workloadsNamespaceFilter).length} 
                  {workloadsNamespaceFilter === 'all' ? ` of ${clusterDetails.pods.length} total pods` : ` pods in ${workloadsNamespaceFilter} namespace`}
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'services' && (
          <div className="space-y-6">
            {/* Services Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                <div className="flex items-center">
                  <div className="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                    <Network className="h-8 w-8 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-blue-700">Total Services</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {clusterDetails.services.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                <div className="flex items-center">
                  <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-green-700">LoadBalancer</p>
                    <p className="text-2xl font-bold text-green-900">
                      {clusterDetails.services.filter(service => service.type === 'LoadBalancer').length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
                <div className="flex items-center">
                  <div className="p-3 bg-orange-500 bg-opacity-20 rounded-xl">
                    <Server className="h-8 w-8 text-orange-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-orange-700">NodePort</p>
                    <p className="text-2xl font-bold text-orange-900">
                      {clusterDetails.services.filter(service => service.type === 'NodePort').length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                <div className="flex items-center">
                  <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                    <Database className="h-8 w-8 text-purple-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-purple-700">ClusterIP</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {clusterDetails.services.filter(service => service.type === 'ClusterIP').length}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Services Search and Filters */}
            <div className="mb-4 flex gap-4">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search services by name..."
                  value={servicesSearchTerm}
                  onChange={(e) => setServicesSearchTerm(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
                {servicesSearchTerm && (
                  <button
                    onClick={() => setServicesSearchTerm('')}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              
              {/* Namespace Filter Dropdown */}
              <div className="w-64">
                <select
                  value={servicesNamespaceFilter}
                  onChange={(e) => setServicesNamespaceFilter(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md leading-5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="all">All Namespaces</option>
                  {clusterDetails?.services && Array.from(new Set(clusterDetails.services.map(s => s.namespace))).sort().map(ns => (
                    <option key={ns} value={ns}>{ns}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Services Table */}
            <div>
              <div className="flex items-center mb-4">
                <Network className="h-5 w-5 text-blue-600 mr-2" />
                <h3 className="text-xl font-semibold text-gray-900">Services</h3>
                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                  {clusterDetails.services
                    .filter(service => servicesNamespaceFilter === 'all' || service.namespace === servicesNamespaceFilter)
                    .filter(service => service.name.toLowerCase().includes(servicesSearchTerm.toLowerCase()))
                    .length}
                </span>
              </div>
              
              <Card className="p-4 border-l-4 border-blue-500">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th 
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 user-select-none"
                          onClick={() => {
                            if (servicesSortField === 'name') {
                              setServicesSortDirection(servicesSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setServicesSortField('name')
                              setServicesSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Service
                            {servicesSortField === 'name' && (
                              servicesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 user-select-none"
                          onClick={() => {
                            if (servicesSortField === 'namespace') {
                              setServicesSortDirection(servicesSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setServicesSortField('namespace')
                              setServicesSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Namespace
                            {servicesSortField === 'namespace' && (
                              servicesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 user-select-none"
                          onClick={() => {
                            if (servicesSortField === 'type') {
                              setServicesSortDirection(servicesSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setServicesSortField('type')
                              setServicesSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Type
                            {servicesSortField === 'type' && (
                              servicesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 user-select-none"
                          onClick={() => {
                            if (servicesSortField === 'clusterIP') {
                              setServicesSortDirection(servicesSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setServicesSortField('clusterIP')
                              setServicesSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Cluster IP
                            {servicesSortField === 'clusterIP' && (
                              servicesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 user-select-none"
                          onClick={() => {
                            if (servicesSortField === 'externalIP') {
                              setServicesSortDirection(servicesSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setServicesSortField('externalIP')
                              setServicesSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            External IP
                            {servicesSortField === 'externalIP' && (
                              servicesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 user-select-none"
                          onClick={() => {
                            if (servicesSortField === 'ports') {
                              setServicesSortDirection(servicesSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setServicesSortField('ports')
                              setServicesSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Ports
                            {servicesSortField === 'ports' && (
                              servicesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 user-select-none"
                          onClick={() => {
                            if (servicesSortField === 'age') {
                              setServicesSortDirection(servicesSortDirection === 'asc' ? 'desc' : 'asc')
                            } else {
                              setServicesSortField('age')
                              setServicesSortDirection('asc')
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            Age
                            {servicesSortField === 'age' && (
                              servicesSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortServices(
                        clusterDetails.services
                          .filter(service => servicesNamespaceFilter === 'all' || service.namespace === servicesNamespaceFilter)
                          .filter(service => service.name.toLowerCase().includes(servicesSearchTerm.toLowerCase())),
                        servicesSortField,
                        servicesSortDirection
                      ).map((service) => (
                        <tr key={`${service.namespace}-${service.name}`} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2">
                            <div className="flex items-center">
                              <div className="p-1.5 bg-blue-100 rounded mr-2">
                                <Network className="h-3 w-3 text-blue-600" />
                              </div>
                              <span className="text-xs font-medium text-gray-900 truncate max-w-48">{service.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                              <Database className="h-2.5 w-2.5 mr-1" />
                              {service.namespace}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              service.type === 'LoadBalancer' ? 'bg-green-100 text-green-800 border-green-200' :
                              service.type === 'NodePort' ? 'bg-orange-100 text-orange-800 border-orange-200' :
                              service.type === 'ClusterIP' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                              'bg-gray-100 text-gray-800 border-gray-200'
                            }`}>
                              {service.type === 'LoadBalancer' && <CheckCircle className="h-2.5 w-2.5 mr-1" />}
                              {service.type === 'NodePort' && <Server className="h-2.5 w-2.5 mr-1" />}
                              {service.type === 'ClusterIP' && <Database className="h-2.5 w-2.5 mr-1" />}
                              {service.type}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs text-gray-600 font-mono bg-gray-100 px-1.5 py-0.5 rounded border">
                              {service.clusterIP}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {service.externalIP ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                <CheckCircle className="h-2.5 w-2.5 mr-1" />
                                {service.externalIP}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                <XCircle className="h-2.5 w-2.5 mr-1" />
                                None
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="space-y-0.5">
                              {service.ports.map((port: any, idx: number) => (
                                <div key={idx} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-blue-50 text-blue-800 border border-blue-200 mr-0.5">
                                  <Network className="h-2.5 w-2.5 mr-1" />
                                  {port.port}:{port.targetPort}/{port.protocol}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 font-mono">{service.age}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Certificates Tab */}
        {activeTab === 'certificates' && (
          <div className="space-y-6">
            {/* Certificates Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                <div className="flex items-center">
                  <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                    <Key className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-green-700">Total Certificates</p>
                    <p className="text-2xl font-bold text-green-900">
                      {certificates.length}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-6 bg-gradient-to-r from-yellow-50 to-yellow-100 border-yellow-200">
                <div className="flex items-center">
                  <div className="p-3 bg-yellow-500 bg-opacity-20 rounded-xl">
                    <AlertTriangle className="h-8 w-8 text-yellow-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-yellow-700">Expiring Soon</p>
                    <p className="text-2xl font-bold text-yellow-900">
                      {certificatesStats.expiringSoon}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-6 bg-gradient-to-r from-red-50 to-red-100 border-red-200">
                <div className="flex items-center">
                  <div className="p-3 bg-red-500 bg-opacity-20 rounded-xl">
                    <XCircle className="h-8 w-8 text-red-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-red-700">Expired</p>
                    <p className="text-2xl font-bold text-red-900">
                      {certificatesStats.expired}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                <div className="flex items-center">
                  <div className="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                    <CheckCircle className="h-8 w-8 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-blue-700">Valid</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {certificatesStats.valid}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Certificates Loading */}
            {certificatesLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                <span>Loading certificates...</span>
              </div>
            ) : (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Cluster Certificates</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Displays TLS certificates, service certificates, and authentication certificates. 
                      Modern clusters may use OIDC tokens or service account tokens for user authentication instead of client certificates.
                    </p>
                    {(certificatesStats.cnpgCritical > 0 || certificatesStats.cnpgWarning > 0) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {certificatesStats.cnpgCritical > 0 && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            CNPG PostgreSQL Error (≤3 dagen): {certificatesStats.cnpgCritical}
                          </span>
                        )}
                        {certificatesStats.cnpgWarning > 0 && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            CNPG PostgreSQL Warning (≤6 dagen): {certificatesStats.cnpgWarning}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <Button 
                    onClick={() => {
                      setCertificatesLoaded(false)
                      fetchCertificates()
                    }}
                    variant="outline"
                    disabled={certificatesLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${certificatesLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>

                {/* Search and Namespace Filter */}
                <div className="mb-4 flex gap-4">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      placeholder="Search certificates by name or subject..."
                      value={certificatesSearchTerm}
                      onChange={(e) => setCertificatesSearchTerm(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                    {certificatesSearchTerm && (
                      <button
                        onClick={() => setCertificatesSearchTerm('')}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  
                  {/* Namespace Filter Dropdown */}
                  <div className="w-64">
                    <select
                      value={certificatesNamespaceFilter}
                      onChange={(e) => setCertificatesNamespaceFilter(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md leading-5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      <option value="all">All Namespaces</option>
                      {certificates && Array.from(new Set(certificates.map(c => c.namespace).filter(Boolean))).sort().map(ns => (
                        <option key={ns} value={ns}>{ns}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Certificate Filter */}
                <div className="mb-4">
                  <div className="flex items-center space-x-4">
                    <label className="text-sm font-medium text-gray-700">Filter by category:</label>
                    <select 
                      value={certificateFilter}
                      onChange={(e) => setCertificateFilter(e.target.value)}
                      className="px-3 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Categories</option>
                      <option value="Authentication">Authentication</option>
                      <option value="Kubernetes System">Kubernetes System</option>
                      <option value="Talos/ETCD">Talos/ETCD</option>
                      <option value="Kubernetes API">Kubernetes API</option>
                      <option value="Certificate Authority">Certificate Authority</option>
                      <option value="Application">Application</option>
                    </select>
                  </div>
                </div>

                {certificates.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No certificates found in this cluster
                  </div>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="min-w-full text-sm text-gray-900">
                      <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                          <th className="px-3 py-3 text-left min-w-[200px]">Certificate</th>
                          <th className="px-3 py-3 text-left min-w-[120px]">Namespace</th>
                          <th className="px-3 py-3 text-left min-w-[100px]">Category</th>
                          <th className="px-3 py-3 text-left min-w-[80px]">Status</th>
                          <th className="px-3 py-3 text-left min-w-[150px]">Issuer</th>
                          <th className="px-3 py-3 text-left min-w-[150px]">Subject</th>
                          <th className="px-3 py-3 text-left min-w-[110px]">Valid From</th>
                          <th className="px-3 py-3 text-left min-w-[110px]">Expires</th>
                          <th className="px-3 py-3 text-left min-w-[80px]">Days Left</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {certificates
                          .filter(cert => certificateFilter === 'all' || cert.category === certificateFilter)
                          .filter(cert => certificatesNamespaceFilter === 'all' || cert.namespace === certificatesNamespaceFilter)
                          .filter(cert => 
                            cert.name.toLowerCase().includes(certificatesSearchTerm.toLowerCase()) ||
                            cert.subject?.toLowerCase().includes(certificatesSearchTerm.toLowerCase()) ||
                            ''
                          )
                          .map((cert, index) => {
                          const daysLeft = cert.daysUntilExpiry
                          const statusColor = cert.status === 'expired' ? 'red' : 
                                            cert.status === 'critical' ? 'orange' :
                                            cert.status === 'warning' ? 'yellow' : 'green'
                          
                          return (
                            <tr key={`${cert.namespace}-${cert.name}-${index}`} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2">
                                <div className="flex items-center min-w-0">
                                  <div className={`p-1.5 bg-${statusColor}-100 rounded mr-2 flex-shrink-0`}>
                                    <Key className={`h-3 w-3 text-${statusColor}-600`} />
                                  </div>
                                  <span className="text-xs font-medium text-gray-900 truncate" title={cert.name}>
                                    {cert.name}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200 whitespace-nowrap">
                                  <Network className="h-2.5 w-2.5 mr-1 flex-shrink-0" />
                                  <span className="truncate" title={cert.namespace}>{cert.namespace}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                                  cert.category === 'Kubernetes System' ? 'bg-purple-100 text-purple-800' :
                                  cert.category === 'Talos/ETCD' ? 'bg-indigo-100 text-indigo-800' :
                                  cert.category === 'Kubernetes API' ? 'bg-cyan-100 text-cyan-800' :
                                  cert.category === 'Authentication' ? 'bg-pink-100 text-pink-800' :
                                  cert.category === 'Certificate Authority' ? 'bg-amber-100 text-amber-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {cert.category === 'Kubernetes System' ? <Shield className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   cert.category === 'Talos/ETCD' ? <Database className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   cert.category === 'Kubernetes API' ? <Server className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   cert.category === 'Authentication' ? <Users className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   cert.category === 'Certificate Authority' ? <Key className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   <Package className="h-2.5 w-2.5 mr-1 flex-shrink-0" />}
                                  {cert.category || 'Application'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                                  cert.status === 'expired' ? 'bg-red-100 text-red-800' :
                                  cert.status === 'critical' ? 'bg-orange-100 text-orange-800' :
                                  cert.status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-green-100 text-green-800'
                                }`}>
                                  {cert.status === 'expired' ? <XCircle className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   cert.status === 'critical' ? <AlertTriangle className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   cert.status === 'warning' ? <AlertTriangle className="h-2.5 w-2.5 mr-1 flex-shrink-0" /> :
                                   <CheckCircle className="h-2.5 w-2.5 mr-1 flex-shrink-0" />}
                                  {cert.status}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 truncate block" title={cert.issuer}>
                                  {cert.issuer}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600 truncate block" title={cert.subject}>
                                  {cert.subject}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
                                  {new Date(cert.validFrom).toLocaleDateString('en-US', { 
                                    month: '2-digit', 
                                    day: '2-digit', 
                                    year: 'numeric' 
                                  })}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
                                  {new Date(cert.expiresAt).toLocaleDateString('en-US', { 
                                    month: '2-digit', 
                                    day: '2-digit', 
                                    year: 'numeric' 
                                  })}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`text-xs font-medium whitespace-nowrap ${
                                  daysLeft < 0 ? 'text-red-600' :
                                  daysLeft < 7 ? 'text-orange-600' :
                                  daysLeft < 30 ? 'text-yellow-600' :
                                  'text-green-600'
                                }`}>
                                  {daysLeft < 0 ? 'Expired' : `${daysLeft}d`}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>

                    {certificates.filter(cert => certificateFilter === 'all' || cert.category === certificateFilter).length > 0 && (
                      <p className="text-sm text-gray-500 mt-4">
                        Showing {certificates.filter(cert => certificateFilter === 'all' || cert.category === certificateFilter).length} 
                        {certificateFilter !== 'all' ? ` ${certificateFilter.toLowerCase()}` : ''} certificates
                        {certificateFilter !== 'all' && ` of ${certificates.length} total`}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            )}
          </div>
        )}

        {activeTab === 'rbac' && (
          <div className="space-y-6">
            {/* RBAC Loading */}
            {rbacLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                <span>Loading RBAC data...</span>
              </div>
            ) : rbacData ? (
              <>
                {rbacData.error === 'Unauthorized' && (
                  <Card className="p-4 border-yellow-200 bg-yellow-50">
                    <div className="flex items-start">
                      <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-yellow-800">RBAC data is not available for your current session.</p>
                        <p className="text-xs text-yellow-700 mt-1">Log in again to load RBAC information for this cluster.</p>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Overview Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                        <Shield className="h-8 w-8 text-purple-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-purple-700">ClusterRoleBindings</p>
                        <p className="text-2xl font-bold text-purple-900">
                          {rbacData.clusterRoleBindings?.length || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-6 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                        <Key className="h-8 w-8 text-blue-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-blue-700">RoleBindings</p>
                        <p className="text-2xl font-bold text-blue-900">
                          {rbacData.roleBindings?.length || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-6 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                        <Users className="h-8 w-8 text-green-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-green-700">ServiceAccounts</p>
                        <p className="text-2xl font-bold text-green-900">
                          {rbacData.serviceAccounts?.length || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-6 bg-gradient-to-r from-indigo-50 to-indigo-100 border-indigo-200">
                    <div className="flex items-center">
                      <div className="p-3 bg-indigo-500 bg-opacity-20 rounded-xl">
                        <User className="h-8 w-8 text-indigo-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-indigo-700">User Accounts</p>
                        <p className="text-2xl font-bold text-indigo-900">
                          {(() => {
                            const users = new Set()
                            rbacData.clusterRoleBindings?.forEach((crb: any) => {
                              crb.subjects?.forEach((subject: any) => {
                                if (subject.kind === 'User') users.add(subject.name)
                              })
                            })
                            rbacData.roleBindings?.forEach((rb: any) => {
                              rb.subjects?.forEach((subject: any) => {
                                if (subject.kind === 'User') users.add(subject.name)
                              })
                            })
                            return users.size
                          })()}
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* User Accounts Section */}
                <Card className="p-4">
                  <div className="flex items-center mb-4">
                    <User className="h-5 w-5 text-blue-600 mr-2" />
                    <h3 className="text-lg font-semibold">User Accounts</h3>
                    <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                      {(() => {
                        const users = new Set()
                        rbacData.clusterRoleBindings?.forEach((crb: any) => {
                          crb.subjects?.forEach((subject: any) => {
                            if (subject.kind === 'User') users.add(subject.name)
                          })
                        })
                        rbacData.roleBindings?.forEach((rb: any) => {
                          rb.subjects?.forEach((subject: any) => {
                            if (subject.kind === 'User') users.add(subject.name)
                          })
                        })
                        return users.size
                      })()}
                    </span>
                  </div>
                  
                  {(() => {
                    const userBindings: any[] = []
                    const processedUsers = new Set()
                    
                    // Collect users from ClusterRoleBindings
                    rbacData.clusterRoleBindings?.forEach((crb: any) => {
                      crb.subjects?.forEach((subject: any) => {
                        if (subject.kind === 'User' && !processedUsers.has(subject.name)) {
                          processedUsers.add(subject.name)
                          userBindings.push({
                            userName: subject.name,
                            bindingName: crb.name,
                            bindingType: 'ClusterRoleBinding',
                            role: crb.roleRef.name,
                            roleKind: crb.roleRef.kind,
                            namespace: null
                          })
                        }
                      })
                    })
                    
                    // Collect users from RoleBindings
                    rbacData.roleBindings?.forEach((rb: any) => {
                      rb.subjects?.forEach((subject: any) => {
                        if (subject.kind === 'User') {
                          const key = `${subject.name}-${rb.namespace}`
                          if (!processedUsers.has(key)) {
                            processedUsers.add(key)
                            userBindings.push({
                              userName: subject.name,
                              bindingName: rb.name,
                              bindingType: 'RoleBinding',
                              role: rb.roleRef.name,
                              roleKind: rb.roleRef.kind,
                              namespace: rb.namespace
                            })
                          }
                        }
                      })
                    })
                    
                    return userBindings.length > 0 ? (
                      <div className="space-y-2">
                        {userBindings.map((binding: any, idx: number) => {
                          const userKey = `${binding.userName}-${binding.bindingName}-${binding.namespace || 'cluster'}`
                          const isExpanded = expandedUserPermissions.has(userKey)
                          
                          // Get role permissions
                          const roleRef = binding.roleKind === 'ClusterRole' 
                            ? rbacData.clusterRoles?.[binding.role]
                            : rbacData.roles?.[`${binding.namespace}/${binding.role}`]
                          
                          return (
                            <div key={idx} className="border rounded-lg bg-white">
                              <div 
                                className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                                onClick={() => {
                                  const newExpanded = new Set(expandedUserPermissions)
                                  if (isExpanded) {
                                    newExpanded.delete(userKey)
                                  } else {
                                    newExpanded.add(userKey)
                                  }
                                  setExpandedUserPermissions(newExpanded)
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                    <span className="inline-flex items-center px-2 py-1 rounded text-sm font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                      <User className="h-3 w-3 mr-1" />
                                      {binding.userName}
                                    </span>
                                    <span className={`inline-flex items-center px-2 py-1 rounded text-sm font-medium ${
                                      binding.bindingType === 'ClusterRoleBinding' 
                                        ? 'bg-purple-100 text-purple-800 border border-purple-200' 
                                        : 'bg-blue-100 text-blue-800 border border-blue-200'
                                    }`}>
                                      {binding.bindingType === 'ClusterRoleBinding' && <Crown className="h-3 w-3 mr-1" />}
                                      {binding.bindingType === 'RoleBinding' && <Key className="h-3 w-3 mr-1" />}
                                      {binding.bindingType}
                                    </span>
                                    <span className="inline-flex items-center px-2 py-1 rounded text-sm font-medium bg-green-100 text-green-800 border border-green-200">
                                      {binding.roleKind === 'ClusterRole' && <Crown className="h-3 w-3 mr-1" />}
                                      {binding.role}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                                    {binding.namespace ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                        <Database className="h-2.5 w-2.5 mr-1" />
                                        {binding.namespace}
                                      </span>
                                    ) : (
                                      <span>Cluster-wide</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {isExpanded && (
                                <div className="border-t bg-gray-50 p-3">
                                  <div className="space-y-3">
                                    <div className="flex items-center space-x-2 text-xs text-gray-600">
                                      <FileText className="h-3 w-3" />
                                      <span className="font-medium">Permissions for role: {binding.role}</span>
                                    </div>
                                    
                                    {roleRef?.rules ? (
                                      <div className="space-y-4">
                                        {/* Security Risk Assessment */}
                                        <div className="mb-6">
                                          {(() => {
                                            const allVerbs = new Set()
                                            const allResources = new Set()
                                            const allGroups = new Set()
                                            const dangerousResources = new Set()
                                            
                                            roleRef.rules.forEach((rule: any) => {
                                              rule.verbs?.forEach((v: string) => allVerbs.add(v))
                                              rule.resources?.forEach((r: string) => {
                                                allResources.add(r)
                                                if (['secrets', 'serviceaccounts', 'clusterroles', 'clusterrolebindings', 'roles', 'rolebindings'].includes(r.toLowerCase())) {
                                                  dangerousResources.add(r)
                                                }
                                              })
                                              rule.apiGroups?.forEach((g: string) => allGroups.add(g || 'core'))
                                            })
                                            
                                            const hasWildcard = allVerbs.has('*')
                                            const canWrite = ['create', 'update', 'patch', 'delete'].some(v => allVerbs.has(v))
                                            const canRead = ['get', 'list', 'watch'].some(v => allVerbs.has(v))
                                            const hasSecretsAccess = allResources.has('secrets')
                                            const hasRBACAccess = dangerousResources.size > 0
                                            const isNamespaceScoped = binding.namespace !== null
                                            
                                            let riskLevel = 'LOW'
                                            let riskColor = 'green'
                                            let riskExplanation = 'Limited read-only access'
                                            
                                            if (hasWildcard) {
                                              if (isNamespaceScoped) {
                                                riskLevel = 'HIGH'
                                                riskColor = 'orange'
                                                riskExplanation = `Full admin control within '${binding.namespace}' namespace only`
                                              } else {
                                                riskLevel = 'CRITICAL'
                                                riskColor = 'red'
                                                riskExplanation = 'Can do ANYTHING in the entire cluster - full administrative control'
                                              }
                                            } else if (hasRBACAccess && canWrite) {
                                              if (isNamespaceScoped) {
                                                riskLevel = 'MEDIUM'
                                                riskColor = 'orange'
                                                riskExplanation = `Can modify security permissions within '${binding.namespace}' namespace`
                                              } else {
                                                riskLevel = 'HIGH'
                                                riskColor = 'red'
                                                riskExplanation = 'Can modify security permissions cluster-wide and escalate privileges'
                                              }
                                            } else if (hasSecretsAccess) {
                                              if (isNamespaceScoped) {
                                                riskLevel = 'MEDIUM'
                                                riskColor = 'orange'
                                                riskExplanation = `Can access secrets within '${binding.namespace}' namespace`
                                              } else {
                                                riskLevel = 'HIGH'
                                                riskColor = 'orange'
                                                riskExplanation = 'Can access sensitive secrets across all namespaces'
                                              }
                                            } else if (canWrite) {
                                              if (isNamespaceScoped) {
                                                riskLevel = 'LOW'
                                                riskColor = 'green'
                                                riskExplanation = `Can modify resources within '${binding.namespace}' namespace only`
                                              } else {
                                                riskLevel = 'MEDIUM'
                                                riskColor = 'orange'
                                                riskExplanation = 'Can modify resources across the entire cluster'
                                              }
                                            } else if (canRead) {
                                              riskLevel = 'LOW'
                                              riskColor = 'green'
                                              riskExplanation = isNamespaceScoped ? 
                                                `Read-only access to '${binding.namespace}' namespace` : 
                                                'Read-only access to cluster information'
                                            }
                                            
                                            const accessPercentage = hasWildcard ? (isNamespaceScoped ? 70 : 100) : 
                                                                   (canWrite ? 
                                                                     (hasRBACAccess ? (isNamespaceScoped ? 60 : 90) : 
                                                                      hasSecretsAccess ? (isNamespaceScoped ? 45 : 75) : 
                                                                      (isNamespaceScoped ? 30 : 60)) : 
                                                                   (canRead ? (isNamespaceScoped ? 15 : 30) : 0))
                                            
                                            return (
                                              <div className={`p-6 rounded-xl border-2 ${riskColor === 'red' ? 'bg-red-50 border-red-200' : riskColor === 'orange' ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                                                <div className="flex items-start justify-between mb-4">
                                                  <div className="flex items-center space-x-3">
                                                    {riskLevel === 'CRITICAL' ? <AlertOctagon className="h-6 w-6 text-red-600" /> :
                                                     riskLevel === 'HIGH' ? <AlertTriangle className="h-6 w-6 text-red-500" /> :
                                                     riskLevel === 'MEDIUM' ? <AlertTriangle className="h-6 w-6 text-orange-500" /> :
                                                     <Shield className="h-6 w-6 text-green-500" />}
                                                    <div>
                                                      <div className="flex items-center space-x-2">
                                                        <span className="text-lg font-bold text-gray-800">Security Risk Assessment</span>
                                                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${riskColor === 'red' ? 'bg-red-100 text-red-800' : riskColor === 'orange' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                                                          {riskLevel}
                                                        </span>
                                                      </div>
                                                      <p className="text-sm text-gray-600 mt-1">{riskExplanation}</p>
                                                    </div>
                                                  </div>
                                                  <div className="text-right">
                                                    <div className="text-2xl font-bold text-gray-800">{accessPercentage}%</div>
                                                    <div className="text-xs text-gray-500">Access Level</div>
                                                  </div>
                                                </div>
                                                
                                                {/* Access Level Meter */}
                                                <div className="mb-4">
                                                  <div className="flex items-center justify-between mb-2">
                                                    <span className="text-sm font-medium text-gray-700">Cluster Access Level</span>
                                                    <Gauge className="h-4 w-4 text-gray-500" />
                                                  </div>
                                                  <div className="w-full bg-gray-200 rounded-full h-3">
                                                    <div 
                                                      className={`h-3 rounded-full transition-all duration-500 ${
                                                        riskColor === 'red' ? 'bg-gradient-to-r from-red-500 to-red-600' :
                                                        riskColor === 'orange' ? 'bg-gradient-to-r from-orange-500 to-orange-600' :
                                                        'bg-gradient-to-r from-green-500 to-green-600'
                                                      }`}
                                                      style={{width: `${accessPercentage}%`}}
                                                    ></div>
                                                  </div>
                                                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                    <span>No Access</span>
                                                    <span>Read Only</span>
                                                    <span>Read/Write</span>
                                                    <span>Full Admin</span>
                                                  </div>
                                                </div>
                                                
                                                {/* What This User Can Do */}
                                                <div className="grid grid-cols-2 gap-4">
                                                  <div className="bg-white rounded-lg p-4 border">
                                                    <div className="flex items-center mb-3">
                                                      <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                                                      <span className="font-semibold text-green-700">CAN DO</span>
                                                    </div>
                                                    <div className="space-y-2 text-sm">
                                                      {canRead && <div className="flex items-center"><Eye className="h-3 w-3 mr-2 text-green-500" /><span>View cluster resources</span></div>}
                                                      {allVerbs.has('list') && <div className="flex items-center"><Target className="h-3 w-3 mr-2 text-green-500" /><span>List {Array.from(allResources).slice(0, 3).join(', ')}</span></div>}
                                                      {canWrite && <div className="flex items-center"><Edit className="h-3 w-3 mr-2 text-orange-500" /><span>Modify resources</span></div>}
                                                      {allVerbs.has('create') && <div className="flex items-center"><Plus className="h-3 w-3 mr-2 text-blue-500" /><span>Create new resources</span></div>}
                                                      {allVerbs.has('delete') && <div className="flex items-center"><Trash2 className="h-3 w-3 mr-2 text-red-500" /><span>Delete resources</span></div>}
                                                      {hasWildcard && <div className="flex items-center"><Zap className="h-3 w-3 mr-2 text-red-500" /><span>ALL operations</span></div>}
                                                      {!canRead && !canWrite && <div className="flex items-center text-gray-500"><Lock className="h-3 w-3 mr-2" /><span>Very limited access</span></div>}
                                                    </div>
                                                  </div>
                                                  
                                                  <div className="bg-white rounded-lg p-4 border">
                                                    <div className="flex items-center mb-3">
                                                      <Info className="h-5 w-5 text-blue-500 mr-2" />
                                                      <span className="font-semibold text-blue-700">SCOPE</span>
                                                    </div>
                                                    <div className="space-y-2 text-sm">
                                                      {binding.namespace ? (
                                                        <>
                                                          <div className="flex items-center bg-green-50 p-2 rounded border border-green-200">
                                                            <Shield className="h-4 w-4 mr-2 text-green-600" />
                                                            <span className="font-medium text-green-800">Namespace-scoped (Lower Risk)</span>
                                                          </div>
                                                          <div className="flex items-center ml-2"><Database className="h-3 w-3 mr-2 text-blue-500" /><span>Limited to &apos;{binding.namespace}&apos; namespace only</span></div>
                                                          <div className="flex items-center ml-2 text-green-600"><CheckCircle className="h-3 w-3 mr-2" /><span>Cannot affect other namespaces</span></div>
                                                        </>
                                                      ) : (
                                                        <>
                                                          <div className="flex items-center bg-orange-50 p-2 rounded border border-orange-200">
                                                            <AlertTriangle className="h-4 w-4 mr-2 text-orange-600" />
                                                            <span className="font-medium text-orange-800">Cluster-wide (Higher Risk)</span>
                                                          </div>
                                                          <div className="flex items-center ml-2"><Globe className="h-3 w-3 mr-2 text-purple-500" /><span>Access to ALL namespaces</span></div>
                                                          <div className="flex items-center ml-2 text-orange-600"><AlertTriangle className="h-3 w-3 mr-2" /><span>Can affect entire cluster</span></div>
                                                        </>
                                                      )}
                                                      <div className="flex items-center"><Package className="h-3 w-3 mr-2 text-purple-500" /><span>{allResources.size} resource types</span></div>
                                                      <div className="flex items-center"><Globe className="h-3 w-3 mr-2 text-blue-500" /><span>{allGroups.size} API groups</span></div>
                                                      {hasSecretsAccess && (
                                                        <div className="flex items-center">
                                                          <AlertTriangle className="h-3 w-3 mr-2 text-orange-500" />
                                                          <span>Can access secrets {binding.namespace ? `in '${binding.namespace}'` : 'cluster-wide'}</span>
                                                        </div>
                                                      )}
                                                      {hasRBACAccess && (
                                                        <div className="flex items-center">
                                                          <AlertOctagon className="h-3 w-3 mr-2 text-red-500" />
                                                          <span>Can modify permissions {binding.namespace ? `in '${binding.namespace}'` : 'cluster-wide'}</span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            )
                                          })()}
                                        </div>
                                        
                                        {/* Real-World Permission Examples */}
                                        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
                                          <div className="flex items-center mb-4">
                                            <Target className="h-6 w-6 text-blue-600 mr-3" />
                                            <h3 className="text-lg font-bold text-blue-800">What This Actually Means</h3>
                                          </div>
                                          
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {(() => {
                                              const allVerbs = new Set()
                                              const allResources = new Set()
                                              roleRef.rules.forEach((rule: any) => {
                                                rule.verbs?.forEach((v: string) => allVerbs.add(v))
                                                rule.resources?.forEach((r: string) => allResources.add(r))
                                              })
                                              
                                              const scenarios = []
                                              
                                              // Check common scenarios
                                              if (allResources.has('pods') && allVerbs.has('get')) {
                                                scenarios.push({
                                                  icon: <Eye className="h-4 w-4 text-green-500" />,
                                                  title: "View Pod Details",
                                                  description: "Can see pod status, logs, and resource usage",
                                                  level: "safe"
                                                })
                                              }
                                              
                                              if (allResources.has('deployments') && allVerbs.has('create')) {
                                                scenarios.push({
                                                  icon: <Plus className="h-4 w-4 text-blue-500" />,
                                                  title: "Deploy Applications",
                                                  description: "Can create new deployments and services",
                                                  level: "moderate"
                                                })
                                              }
                                              
                                              if (allResources.has('secrets')) {
                                                scenarios.push({
                                                  icon: <AlertTriangle className="h-4 w-4 text-orange-500" />,
                                                  title: "Access Secrets",
                                                  description: "Can view passwords, API keys, and certificates",
                                                  level: "danger"
                                                })
                                              }
                                              
                                              if (allResources.has('nodes') && allVerbs.has('get')) {
                                                scenarios.push({
                                                  icon: <Server className="h-4 w-4 text-purple-500" />,
                                                  title: "Monitor Infrastructure",
                                                  description: "Can view cluster nodes and their health status",
                                                  level: "safe"
                                                })
                                              }
                                              
                                              if (allVerbs.has('delete') && allResources.has('pods')) {
                                                scenarios.push({
                                                  icon: <Trash2 className="h-4 w-4 text-red-500" />,
                                                  title: "Delete Workloads",
                                                  description: "Can terminate running applications and pods",
                                                  level: "danger"
                                                })
                                              }
                                              
                                              if (allResources.has('clusterroles') || allResources.has('clusterrolebindings')) {
                                                scenarios.push({
                                                  icon: <Crown className="h-4 w-4 text-red-500" />,
                                                  title: "Modify Security",
                                                  description: "Can grant or revoke permissions to other users",
                                                  level: "critical"
                                                })
                                              }
                                              
                                              if (allVerbs.has('*')) {
                                                scenarios.push({
                                                  icon: <Zap className="h-4 w-4 text-red-500" />,
                                                  title: "Complete Control",
                                                  description: "Full administrative access to everything",
                                                  level: "critical"
                                                })
                                              }
                                              
                                              // If no specific scenarios, add generic ones
                                              if (scenarios.length === 0) {
                                                if (allVerbs.has('get') || allVerbs.has('list')) {
                                                  scenarios.push({
                                                    icon: <Eye className="h-4 w-4 text-green-500" />,
                                                    title: "Read Information",
                                                    description: "Can view cluster resources and their status",
                                                    level: "safe"
                                                  })
                                                }
                                                
                                                if (scenarios.length === 0) {
                                                  scenarios.push({
                                                    icon: <Lock className="h-4 w-4 text-gray-500" />,
                                                    title: "Limited Access",
                                                    description: "Very restricted permissions in this cluster",
                                                    level: "safe"
                                                  })
                                                }
                                              }
                                              
                                              return scenarios.map((scenario, idx) => (
                                                <div key={idx} className={`p-4 rounded-lg border-2 ${
                                                  scenario.level === 'critical' ? 'bg-red-50 border-red-200' :
                                                  scenario.level === 'danger' ? 'bg-orange-50 border-orange-200' :
                                                  scenario.level === 'moderate' ? 'bg-yellow-50 border-yellow-200' :
                                                  'bg-green-50 border-green-200'
                                                }`}>
                                                  <div className="flex items-start space-x-3">
                                                    <div className="flex-shrink-0 mt-0.5">
                                                      {scenario.icon}
                                                    </div>
                                                    <div>
                                                      <h4 className="font-semibold text-gray-800 text-sm">{scenario.title}</h4>
                                                      <p className="text-xs text-gray-600 mt-1">{scenario.description}</p>
                                                      <div className={`inline-block px-2 py-1 rounded text-xs font-medium mt-2 ${
                                                        scenario.level === 'critical' ? 'bg-red-100 text-red-700' :
                                                        scenario.level === 'danger' ? 'bg-orange-100 text-orange-700' :
                                                        scenario.level === 'moderate' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-green-100 text-green-700'
                                                      }`}>
                                                        {scenario.level === 'critical' ? 'HIGH RISK' :
                                                         scenario.level === 'danger' ? 'MEDIUM RISK' :
                                                         scenario.level === 'moderate' ? 'LOW RISK' : 'SAFE'}
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                              ))
                                            })()}
                                          </div>
                                        </div>
                                        
                                        {/* Permission Summary Cards */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                          {(() => {
                                            const allVerbs = new Set()
                                            const allResources = new Set()
                                            const allGroups = new Set()
                                            roleRef.rules.forEach((rule: any) => {
                                              rule.verbs?.forEach((v: string) => allVerbs.add(v))
                                              rule.resources?.forEach((r: string) => allResources.add(r))
                                              rule.apiGroups?.forEach((g: string) => allGroups.add(g || 'core'))
                                            })
                                            
                                            const hasWildcard = allVerbs.has('*')
                                            const canWrite = ['create', 'update', 'patch', 'delete'].some(v => allVerbs.has(v))
                                            const canRead = ['get', 'list', 'watch'].some(v => allVerbs.has(v))
                                            
                                            return (
                                              <>
                                                <div className={`p-3 rounded-lg border-2 relative overflow-hidden ${hasWildcard ? 'bg-red-50 border-red-200' : canWrite ? 'bg-orange-50 border-orange-200' : canRead ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center">
                                                      {hasWildcard ? <Zap className="h-4 w-4 text-red-500" /> :
                                                       canWrite ? <Edit className="h-4 w-4 text-orange-500" /> :
                                                       canRead ? <Eye className="h-4 w-4 text-green-500" /> :
                                                       <Lock className="h-4 w-4 text-gray-500" />}
                                                      <span className="ml-2 text-xs font-semibold">Access Level</span>
                                                    </div>
                                                    <TrendingUp className="h-3 w-3 text-gray-400" />
                                                  </div>
                                                  <div className="mt-2">
                                                    <div className={`text-sm font-bold ${hasWildcard ? 'text-red-700' : canWrite ? 'text-orange-700' : canRead ? 'text-green-700' : 'text-gray-700'}`}>
                                                      {hasWildcard ? 'FULL ADMIN' : canWrite ? 'READ + WRITE' : canRead ? 'READ ONLY' : 'RESTRICTED'}
                                                    </div>
                                                    <div className="text-xs text-gray-600 mt-1">
                                                      {hasWildcard ? 'Complete control' : canWrite ? 'Can modify cluster' : canRead ? 'View only access' : 'Very limited'}
                                                    </div>
                                                  </div>
                                                  <div className={`absolute bottom-0 left-0 h-1 ${hasWildcard ? 'bg-red-500' : canWrite ? 'bg-orange-500' : canRead ? 'bg-green-500' : 'bg-gray-500'}`} 
                                                       style={{width: hasWildcard ? '100%' : canWrite ? '75%' : canRead ? '40%' : '10%'}}></div>
                                                </div>
                                                
                                                <div className="p-3 rounded-lg bg-blue-50 border-2 border-blue-200">
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center">
                                                      <Globe className="h-4 w-4 text-blue-500" />
                                                      <span className="ml-2 text-xs font-semibold text-blue-700">API Groups</span>
                                                    </div>
                                                    <span className="text-sm font-bold text-blue-800">{allGroups.size}</span>
                                                  </div>
                                                  <div className="mt-1 text-xs text-blue-600">
                                                    {allGroups.size > 3 ? `${Array.from(allGroups).slice(0, 2).join(', ')} +${allGroups.size - 2}` : Array.from(allGroups).join(', ')}
                                                  </div>
                                                </div>
                                                
                                                <div className="p-3 rounded-lg bg-purple-50 border-2 border-purple-200">
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center">
                                                      <Package className="h-4 w-4 text-purple-500" />
                                                      <span className="ml-2 text-xs font-semibold text-purple-700">Resources</span>
                                                    </div>
                                                    <span className="text-sm font-bold text-purple-800">{allResources.size}</span>
                                                  </div>
                                                  <div className="mt-1 text-xs text-purple-600">
                                                    {allResources.size > 3 ? `${Array.from(allResources).slice(0, 2).join(', ')} +${allResources.size - 2}` : Array.from(allResources).join(', ')}
                                                  </div>
                                                </div>
                                                
                                                <div className="p-3 rounded-lg bg-indigo-50 border-2 border-indigo-200">
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center">
                                                      <Settings className="h-4 w-4 text-indigo-500" />
                                                      <span className="ml-2 text-xs font-semibold text-indigo-700">Actions</span>
                                                    </div>
                                                    <span className="text-sm font-bold text-indigo-800">{allVerbs.size}</span>
                                                  </div>
                                                  <div className="mt-1 text-xs text-indigo-600">
                                                    {allVerbs.size > 3 ? `${Array.from(allVerbs).slice(0, 2).join(', ')} +${allVerbs.size - 2}` : Array.from(allVerbs).join(', ')}
                                                  </div>
                                                </div>
                                              </>
                                            )
                                          })()}
                                        </div>
                                        
                                        {/* Detailed Rules */}
                                        <div className="space-y-3">
                                          <div className="flex items-center space-x-2 text-sm font-semibold text-gray-700">
                                            <Shield className="h-4 w-4" />
                                            <span>Permission Rules</span>
                                          </div>
                                          
                                          {roleRef.rules.map((rule: any, ruleIdx: number) => (
                                            <div key={ruleIdx} className="bg-white rounded-xl border-2 border-gray-100 overflow-hidden shadow-sm">
                                              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-2 border-b">
                                                <div className="flex items-center justify-between">
                                                  <span className="text-sm font-semibold text-gray-700">Rule #{ruleIdx + 1}</span>
                                                  <div className="flex space-x-1">
                                                    {rule.verbs?.includes('*') && <div className="w-2 h-2 bg-red-500 rounded-full"></div>}
                                                    {['create', 'update', 'patch', 'delete'].some((v: string) => rule.verbs?.includes(v)) && <div className="w-2 h-2 bg-orange-500 rounded-full"></div>}
                                                    {['get', 'list', 'watch'].some((v: string) => rule.verbs?.includes(v)) && <div className="w-2 h-2 bg-green-500 rounded-full"></div>}
                                                  </div>
                                                </div>
                                              </div>
                                              
                                              <div className="p-4 space-y-4">
                                                {/* API Groups */}
                                                <div>
                                                  <div className="flex items-center mb-2">
                                                    <Globe className="h-4 w-4 text-blue-500 mr-2" />
                                                    <span className="text-sm font-medium text-gray-700">API Groups</span>
                                                  </div>
                                                  <div className="flex flex-wrap gap-1">
                                                    {(rule.apiGroups || ['']).map((group: string, gIdx: number) => (
                                                      <span key={gIdx} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5"></div>
                                                        {group || 'core'}
                                                      </span>
                                                    ))}
                                                  </div>
                                                </div>
                                                
                                                {/* Resources */}
                                                <div>
                                                  <div className="flex items-center mb-2">
                                                    <Package className="h-4 w-4 text-purple-500 mr-2" />
                                                    <span className="text-sm font-medium text-gray-700">Resources</span>
                                                  </div>
                                                  <div className="flex flex-wrap gap-1">
                                                    {(rule.resources || []).map((resource: string, rIdx: number) => (
                                                      <span key={rIdx} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                                                        <div className="w-1.5 h-1.5 bg-purple-500 rounded-full mr-1.5"></div>
                                                        {resource}
                                                      </span>
                                                    ))}
                                                  </div>
                                                </div>
                                                
                                                {/* Actions/Verbs */}
                                                <div>
                                                  <div className="flex items-center mb-2">
                                                    <Settings className="h-4 w-4 text-indigo-500 mr-2" />
                                                    <span className="text-sm font-medium text-gray-700">Actions</span>
                                                  </div>
                                                  <div className="flex flex-wrap gap-1">
                                                    {(rule.verbs || []).map((verb: string, vIdx: number) => {
                                                      let icon = <Eye className="h-3 w-3" />
                                                      let colorClass = 'bg-green-100 text-green-800 border-green-200'
                                                      
                                                      if (verb === '*') {
                                                        icon = <Zap className="h-3 w-3" />
                                                        colorClass = 'bg-red-100 text-red-800 border-red-200'
                                                      } else if (['create', 'post'].includes(verb)) {
                                                        icon = <Plus className="h-3 w-3" />
                                                        colorClass = 'bg-blue-100 text-blue-800 border-blue-200'
                                                      } else if (['update', 'patch', 'put'].includes(verb)) {
                                                        icon = <Edit className="h-3 w-3" />
                                                        colorClass = 'bg-orange-100 text-orange-800 border-orange-200'
                                                      } else if (['delete'].includes(verb)) {
                                                        icon = <Trash2 className="h-3 w-3" />
                                                        colorClass = 'bg-red-100 text-red-800 border-red-200'
                                                      }
                                                      
                                                      return (
                                                        <span key={vIdx} className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
                                                          {icon}
                                                          <span className="ml-1.5">{verb}</span>
                                                        </span>
                                                      )
                                                    })}
                                                  </div>
                                                </div>
                                                
                                                {/* Resource Names if present */}
                                                {rule.resourceNames && rule.resourceNames.length > 0 && (
                                                  <div className="pt-2 border-t border-gray-100">
                                                    <div className="flex items-center mb-2">
                                                      <Lock className="h-4 w-4 text-yellow-500 mr-2" />
                                                      <span className="text-sm font-medium text-gray-700">Specific Resources</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                      {rule.resourceNames.map((name: string, nIdx: number) => (
                                                        <span key={nIdx} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                                                          <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full mr-1.5"></div>
                                                          {name}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-500 italic">
                                        Role definition not found or no rules defined
                                      </div>
                                    )}
                                    
                                    <div className="pt-2 border-t text-xs text-gray-500">
                                      <span className="font-medium">Bound via:</span> {binding.bindingName}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <User className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                        <p className="text-sm">No User accounts found in role bindings</p>
                        <p className="text-xs text-gray-400 mt-1">Users appear when bound to roles via ClusterRoleBindings or RoleBindings</p>
                      </div>
                    )
                  })()}
                </Card>

                {/* ClusterRoleBindings */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                      <Shield className="h-5 w-5 text-purple-600 mr-2" />
                      <h3 className="text-lg font-semibold">ClusterRoleBindings</h3>
                    </div>
                    <Button 
                      onClick={() => {
                        setRbacLoaded(false)
                        fetchRbac()
                      }}
                      variant="outline"
                      disabled={rbacLoading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${rbacLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
                  
                  {/* ClusterRoleBindings Search */}
                  <div className="mb-4">
                    <div className="relative max-w-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        placeholder="Search by name..."
                        value={clusterRoleBindingsSearchTerm}
                        onChange={(e) => setClusterRoleBindingsSearchTerm(e.target.value)}
                        className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {clusterRoleBindingsSearchTerm && (
                        <button
                          onClick={() => setClusterRoleBindingsSearchTerm('')}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {rbacData.clusterRoleBindings && rbacData.clusterRoleBindings.length > 0 ? (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="min-w-full text-sm text-gray-900">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                          <tr>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (clusterRoleBindingsSortField === 'name') {
                                  setClusterRoleBindingsSortDirection(clusterRoleBindingsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setClusterRoleBindingsSortField('name')
                                  setClusterRoleBindingsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Name
                                {clusterRoleBindingsSortField === 'name' && (
                                  clusterRoleBindingsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (clusterRoleBindingsSortField === 'role') {
                                  setClusterRoleBindingsSortDirection(clusterRoleBindingsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setClusterRoleBindingsSortField('role')
                                  setClusterRoleBindingsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Role
                                {clusterRoleBindingsSortField === 'role' && (
                                  clusterRoleBindingsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Subjects</th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (clusterRoleBindingsSortField === 'age') {
                                  setClusterRoleBindingsSortDirection(clusterRoleBindingsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setClusterRoleBindingsSortField('age')
                                  setClusterRoleBindingsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Age
                                {clusterRoleBindingsSortField === 'age' && (
                                  clusterRoleBindingsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {sortClusterRoleBindings(
                            rbacData.clusterRoleBindings.filter((crb: any) => 
                              crb.name.toLowerCase().includes(clusterRoleBindingsSearchTerm.toLowerCase())
                            ),
                            clusterRoleBindingsSortField,
                            clusterRoleBindingsSortDirection
                          ).map((crb: any) => (
                            <tr key={crb.name} className="hover:bg-gray-50 transition-colors">
                              <td className="px-2 py-1.5 font-medium text-xs truncate max-w-48">{crb.name}</td>
                              <td className="px-2 py-1.5">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                                  <Crown className="h-2.5 w-2.5 mr-1" />
                                  {crb.roleRef.name}
                                </span>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="space-y-0.5 max-w-64">
                                  {crb.subjects?.slice(0, 3).map((subject: any, idx: number) => (
                                    <div key={idx} className="text-xs">
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${
                                        subject.kind === 'ServiceAccount' ? 'bg-green-100 text-green-800 border-green-200' :
                                        subject.kind === 'User' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                        'bg-gray-100 text-gray-800 border-gray-200'
                                      }`}>
                                        {subject.kind}: {subject.name}
                                        {subject.namespace && ` (${subject.namespace})`}
                                      </span>
                                    </div>
                                  ))}
                                  {crb.subjects && crb.subjects.length > 3 && (
                                    <div className="text-xs text-gray-500">
                                      +{crb.subjects.length - 3} more
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-xs text-gray-500 font-mono">{formatAge(crb.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      No ClusterRoleBindings found
                    </div>
                  )}
                </Card>

                {/* RoleBindings */}
                <Card className="p-4">
                  <div className="flex items-center mb-4">
                    <Key className="h-5 w-5 text-blue-600 mr-2" />
                    <h3 className="text-lg font-semibold">RoleBindings</h3>
                    <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                      {rbacData.roleBindings
                        .filter((rb: any) => roleBindingsNamespaceFilter === 'all' || rb.namespace === roleBindingsNamespaceFilter)
                        .filter((rb: any) => rb.name.toLowerCase().includes(roleBindingsSearchTerm.toLowerCase()))
                        .length}
                    </span>
                  </div>
                  
                  {/* RoleBindings Search and Namespace Filter */}
                  <div className="mb-4 flex flex-col sm:flex-row gap-3">
                    <div className="relative max-w-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        placeholder="Search by name..."
                        value={roleBindingsSearchTerm}
                        onChange={(e) => setRoleBindingsSearchTerm(e.target.value)}
                        className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {roleBindingsSearchTerm && (
                        <button
                          onClick={() => setRoleBindingsSearchTerm('')}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <select
                      value={roleBindingsNamespaceFilter}
                      onChange={(e) => setRoleBindingsNamespaceFilter(e.target.value)}
                      className="block max-w-xs px-3 py-2 border border-gray-300 rounded-md text-sm leading-5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="all">All Namespaces</option>
                      {rbacData?.roleBindings && (Array.from(new Set(rbacData.roleBindings.map((rb: any) => rb.namespace))).sort() as string[]).map((ns: string, index: number) => (
                        <option key={ns} value={ns}>{ns}</option>
                      ))}
                    </select>
                  </div>
                  {rbacData.roleBindings && rbacData.roleBindings.length > 0 ? (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="min-w-full text-sm text-gray-900">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                          <tr>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (roleBindingsSortField === 'name') {
                                  setRoleBindingsSortDirection(roleBindingsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setRoleBindingsSortField('name')
                                  setRoleBindingsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Name
                                {roleBindingsSortField === 'name' && (
                                  roleBindingsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (roleBindingsSortField === 'namespace') {
                                  setRoleBindingsSortDirection(roleBindingsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setRoleBindingsSortField('namespace')
                                  setRoleBindingsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Namespace
                                {roleBindingsSortField === 'namespace' && (
                                  roleBindingsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (roleBindingsSortField === 'role') {
                                  setRoleBindingsSortDirection(roleBindingsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setRoleBindingsSortField('role')
                                  setRoleBindingsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Role
                                {roleBindingsSortField === 'role' && (
                                  roleBindingsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Subjects</th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (roleBindingsSortField === 'age') {
                                  setRoleBindingsSortDirection(roleBindingsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setRoleBindingsSortField('age')
                                  setRoleBindingsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Age
                                {roleBindingsSortField === 'age' && (
                                  roleBindingsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {sortRoleBindings(
                            rbacData.roleBindings
                              .filter((rb: any) => roleBindingsNamespaceFilter === 'all' || rb.namespace === roleBindingsNamespaceFilter)
                              .filter((rb: any) => rb.name.toLowerCase().includes(roleBindingsSearchTerm.toLowerCase())),
                            roleBindingsSortField,
                            roleBindingsSortDirection
                          ).map((rb: any) => (
                            <tr key={`${rb.namespace}-${rb.name}`} className="hover:bg-gray-50 transition-colors">
                              <td className="px-2 py-1.5 font-medium text-xs truncate max-w-48">{rb.name}</td>
                              <td className="px-2 py-1.5">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                  <Database className="h-2.5 w-2.5 mr-1" />
                                  {rb.namespace}
                                </span>
                              </td>
                              <td className="px-2 py-1.5">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                  {rb.roleRef.kind === 'ClusterRole' && <Crown className="h-2.5 w-2.5 mr-1" />}
                                  {rb.roleRef.name}
                                </span>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="space-y-0.5 max-w-64">
                                  {rb.subjects?.slice(0, 3).map((subject: any, idx: number) => (
                                    <div key={idx} className="text-xs">
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${
                                        subject.kind === 'ServiceAccount' ? 'bg-green-100 text-green-800 border-green-200' :
                                        subject.kind === 'User' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                        'bg-gray-100 text-gray-800 border-gray-200'
                                      }`}>
                                        {subject.kind}: {subject.name}
                                        {subject.namespace && ` (${subject.namespace})`}
                                      </span>
                                    </div>
                                  ))}
                                  {rb.subjects && rb.subjects.length > 3 && (
                                    <div className="text-xs text-gray-500">
                                      +{rb.subjects.length - 3} more
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-xs text-gray-500 font-mono">{formatAge(rb.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      No RoleBindings found
                    </div>
                  )}
                </Card>

                {/* ServiceAccounts */}
                <Card className="p-4">
                  <div className="flex items-center mb-4">
                    <Users className="h-5 w-5 text-green-600 mr-2" />
                    <h3 className="text-lg font-semibold">ServiceAccounts</h3>
                    <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                      {rbacData.serviceAccounts
                        .filter((sa: any) => sa.name.toLowerCase().includes(serviceAccountsSearchTerm.toLowerCase()))
                        .length}
                    </span>
                  </div>
                  
                  {/* ServiceAccounts Search */}
                  <div className="mb-4">
                    <div className="relative max-w-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        placeholder="Search by name..."
                        value={serviceAccountsSearchTerm}
                        onChange={(e) => setServiceAccountsSearchTerm(e.target.value)}
                        className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {serviceAccountsSearchTerm && (
                        <button
                          onClick={() => setServiceAccountsSearchTerm('')}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {rbacData.serviceAccounts && rbacData.serviceAccounts.length > 0 ? (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="min-w-full text-sm text-gray-900">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                          <tr>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (serviceAccountsSortField === 'name') {
                                  setServiceAccountsSortDirection(serviceAccountsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setServiceAccountsSortField('name')
                                  setServiceAccountsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Name
                                {serviceAccountsSortField === 'name' && (
                                  serviceAccountsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (serviceAccountsSortField === 'namespace') {
                                  setServiceAccountsSortDirection(serviceAccountsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setServiceAccountsSortField('namespace')
                                  setServiceAccountsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Namespace
                                {serviceAccountsSortField === 'namespace' && (
                                  serviceAccountsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (serviceAccountsSortField === 'secrets') {
                                  setServiceAccountsSortDirection(serviceAccountsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setServiceAccountsSortField('secrets')
                                  setServiceAccountsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Secrets
                                {serviceAccountsSortField === 'secrets' && (
                                  serviceAccountsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                            <th 
                              className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-100 user-select-none"
                              onClick={() => {
                                if (serviceAccountsSortField === 'age') {
                                  setServiceAccountsSortDirection(serviceAccountsSortDirection === 'asc' ? 'desc' : 'asc')
                                } else {
                                  setServiceAccountsSortField('age')
                                  setServiceAccountsSortDirection('asc')
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                Age
                                {serviceAccountsSortField === 'age' && (
                                  serviceAccountsSortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                )}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {sortServiceAccounts(
                            rbacData.serviceAccounts.filter((sa: any) => 
                              sa.name.toLowerCase().includes(serviceAccountsSearchTerm.toLowerCase())
                            ),
                            serviceAccountsSortField,
                            serviceAccountsSortDirection
                          ).map((sa: any) => (
                            <tr key={`${sa.namespace}-${sa.name}`} className="hover:bg-gray-50 transition-colors">
                              <td className="px-2 py-1.5 font-medium text-xs truncate max-w-48">{sa.name}</td>
                              <td className="px-2 py-1.5">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                  <Database className="h-2.5 w-2.5 mr-1" />
                                  {sa.namespace}
                                </span>
                              </td>
                              <td className="px-2 py-1.5">
                                {sa.secrets && sa.secrets.length > 0 ? (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                    <Key className="h-2.5 w-2.5 mr-1" />
                                    {sa.secrets.length} secret{sa.secrets.length !== 1 ? 's' : ''}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                                    <Minus className="h-2.5 w-2.5 mr-1" />
                                    No secrets
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs text-gray-500 font-mono">{formatAge(sa.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      No ServiceAccounts found
                    </div>
                  )}
                </Card>
              </>
            ) : (
              <Card className="p-6">
                <div className="text-center py-8 text-gray-500">
                  No RBAC data available
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'events' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Recent Events (Last 1 Hour)</h3>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoRefreshEvents}
                    onChange={(e) => setAutoRefreshEvents(e.target.checked)}
                    className="rounded"
                  />
                  Auto-refresh (1s)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoScrollEvents}
                    onChange={(e) => setAutoScrollEvents(e.target.checked)}
                    className="rounded"
                  />
                  Auto-scroll
                </label>
                <Button 
                  onClick={() => fetchEvents(true)}
                  variant="outline"
                  disabled={eventsLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${eventsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>

            {displayedEventTypes.length > 0 && (
              <div className="mb-4 border rounded-lg p-3 bg-gray-50">
                <p className="text-sm font-medium text-gray-700 mb-2">Filter by event type</p>
                <div className="flex flex-wrap gap-3">
                  {displayedEventTypes.map((eventType) => (
                    <label key={eventType} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={selectedEventTypes.includes(eventType)}
                        onChange={(e) => {
                          setSelectedEventTypes((prev) => {
                            if (e.target.checked) {
                              return [...prev, eventType]
                            }
                            return prev.filter((type) => type !== eventType)
                          })
                        }}
                        className="rounded"
                      />
                      <span>{eventType}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            
            {eventsLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                <span>Loading events...</span>
              </div>
            ) : (
              <div ref={eventsContainerRef} className="max-h-96 overflow-y-auto border rounded-lg">
                {events.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No events found in the last 1 hour
                  </div>
                ) : filteredEvents.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No events match the selected filters
                  </div>
                ) : (
                  <div className="space-y-3 p-4">
                    {filteredEvents.map((event, idx) => (
                      <div key={idx} className="border-l-4 border-gray-200 pl-4 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            {event.type === 'Warning' ? (
                              <AlertTriangle className="h-4 w-4 text-yellow-500 mr-2" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                            )}
                            <span className="font-medium text-sm">{event.reason}</span>
                            <span className="text-sm text-gray-500 ml-2">({event.object})</span>
                            {event.namespace && (
                              <span className="text-xs text-blue-600 ml-2 bg-blue-50 px-2 py-1 rounded">
                                {event.namespace}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-500">{formatAge(event.lastTime)}</span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{event.message}</p>
                        {event.count > 1 && (
                          <p className="text-xs text-gray-500 mt-1">Occurred {event.count} times</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {events.length > 0 && (
              <p className="text-sm text-gray-500 mt-4">
                Showing {filteredEvents.length} of {events.length} events from the last 1 hour
              </p>
            )}
          </Card>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-4 w-full max-w-full min-w-0 overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 max-w-full">
              <h3 className="text-lg font-semibold">Container Logs</h3>
              <div className="flex flex-wrap gap-3 items-center max-w-full">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoRefreshLogs}
                    onChange={(e) => setAutoRefreshLogs(e.target.checked)}
                    className="rounded"
                  />
                  Auto-refresh (1s)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoScrollLogs}
                    onChange={(e) => setAutoScrollLogs(e.target.checked)}
                    className="rounded"
                  />
                  Auto-scroll
                </label>
                <div className="flex flex-wrap gap-2 max-w-full">
                <select 
                  className="px-3 py-1 border rounded text-sm w-52 max-w-full min-w-0"
                  value={selectedNamespace}
                  onChange={(e) => handleNamespaceChange(e.target.value)}
                >
                  <option value="">Select Namespace</option>
                  {clusterDetails.namespaces.map((ns) => (
                    <option key={ns.name} value={ns.name}>{ns.name}</option>
                  ))}
                </select>
                <select 
                  className="px-3 py-1 border rounded text-sm w-64 max-w-full min-w-0"
                  value={selectedPod}
                  onChange={(e) => handlePodChange(e.target.value)}
                  disabled={!selectedNamespace}
                >
                  <option value="">Select Pod</option>
                  {namespacePods.map((pod) => (
                    <option key={pod.name} value={pod.name}>
                      {pod.name} ({pod.phase})
                    </option>
                  ))}
                </select>
                <select 
                  className="px-3 py-1 border rounded text-sm w-56 max-w-full min-w-0"
                  value={selectedContainer}
                  onChange={(e) => handleContainerChange(e.target.value)}
                  disabled={!selectedPod || podContainers.length <= 1}
                >
                  <option value="">Select Container</option>
                  {podContainers.map((container) => (
                    <option key={container.name} value={container.name}>
                      {container.name} {container.ready ? '✓' : '✗'}
                    </option>
                  ))}
                </select>
                {(selectedNamespace && selectedPod && selectedContainer) && (
                  <Button 
                    onClick={() => fetchLogs(selectedNamespace, selectedPod, selectedContainer)}
                    variant="outline"
                    className="text-sm shrink-0"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </Button>
                )}
                </div>
              </div>
            </div>
            <Card className="p-4 w-full max-w-full min-w-0 overflow-hidden">
              <div className="w-full max-w-full min-w-0 overflow-hidden bg-gray-50 text-gray-900 border border-gray-200 rounded">
                <div className="h-96 w-full max-w-full min-w-0 overflow-x-auto overflow-y-auto p-4 font-mono text-xs leading-5">
                {logsLoading ? (
                  <div className="text-blue-600 flex items-center">
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    Loading logs...
                  </div>
                ) : logs ? (
                  <>
                    <pre className="m-0 block w-0 min-w-full whitespace-pre pr-4">{logs}</pre>
                    <div ref={logsEndRef} />
                  </>
                ) : selectedNamespace && selectedPod ? (
                  <div className="text-gray-500">
                    {podContainers.length > 1 ? 'Select a container to view logs...' : 'No logs available'}
                  </div>
                ) : (
                  <div className="text-gray-500">
                    Select a namespace and pod to view logs...
                    <div className="text-gray-600 mt-2">💡 Tip: Logs will update automatically when you make selections</div>
                  </div>
                )}
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500">⇆ Tip: use the horizontal scrollbar for long log lines.</p>
            </Card>
          </div>
        )}

        {activeTab === 'helm' && <HelmReleases clusterId={clusterId} hiddenNamespaces={hiddenNamespaces} />}

        {activeTab === 'backups' && <VeleroBackups clusterId={clusterId} />}

        {activeTab === 'talos' && (
          <div className="space-y-6">
            {/* Talos Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-6 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
                <div className="flex items-center">
                  <div className="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                    <Shield className="h-8 w-8 text-purple-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-purple-700">Machine Configs</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {clusterDetails.talosInfo.machineConfigs.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-indigo-50 to-indigo-100 border-indigo-200">
                <div className="flex items-center">
                  <div className="p-3 bg-indigo-500 bg-opacity-20 rounded-xl">
                    <Database className="h-8 w-8 text-indigo-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-indigo-700">ETCD Members</p>
                    <p className="text-2xl font-bold text-indigo-900">
                      {clusterDetails.talosInfo.etcdMembers.length}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-r from-teal-50 to-teal-100 border-teal-200">
                <div className="flex items-center">
                  <div className="p-3 bg-teal-500 bg-opacity-20 rounded-xl">
                    <Activity className="h-8 w-8 text-teal-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-teal-700">System Services</p>
                    <p className="text-2xl font-bold text-teal-900">
                      {clusterDetails.talosInfo.systemServices.length}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Machine Configurations */}
            <div>
              <div className="flex items-center mb-4">
                <Shield className="h-5 w-5 text-purple-600 mr-2" />
                <h3 className="text-xl font-semibold text-gray-900">Machine Configurations</h3>
                <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">
                  {clusterDetails.talosInfo.machineConfigs.length}
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clusterDetails.talosInfo.machineConfigs.map((config) => (
                  <Card key={config.nodeName} className="p-6 border-l-4 border-purple-500 hover:shadow-lg transition-shadow duration-200">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <div className="p-2 bg-purple-100 rounded-lg mr-3">
                          <Server className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{config.nodeName}</h4>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            config.machineType === 'controlplane' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                          }`}>
                            {config.machineType === 'controlplane' ? (
                              <>
                                <Crown className="h-3 w-3 mr-1" />
                                Control Plane
                              </>
                            ) : (
                              <>
                                <Cpu className="h-3 w-3 mr-1" />
                                Worker
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4">
                      <h5 className="font-semibold text-gray-700 mb-3 flex items-center">
                        <Monitor className="h-4 w-4 mr-2" />
                        System Information
                      </h5>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Talos Version:</span>
                          <span className="font-medium font-mono text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                            {config.talosVersion}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Kubernetes:</span>
                          <span className="font-medium font-mono text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                            {config.kubernetesVersion}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Platform:</span>
                          <span className="font-medium">{config.platform}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* ETCD Cluster */}
            <div>
              <div className="flex items-center mb-4">
                <Database className="h-5 w-5 text-indigo-600 mr-2" />
                <h3 className="text-xl font-semibold text-gray-900">ETCD Cluster</h3>
                <span className="ml-2 px-2 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full">
                  {clusterDetails.talosInfo.etcdMembers.length} members
                </span>
              </div>
              
              <Card className="p-6 border-l-4 border-indigo-500">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Member</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Member ID</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Peer URLs</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Client URLs</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Learner Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {clusterDetails.talosInfo.etcdMembers.map((member) => (
                        <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center">
                              <div className="p-2 bg-indigo-100 rounded-lg mr-3">
                                <Database className="h-4 w-4 text-indigo-600" />
                              </div>
                              <span className="text-sm font-medium text-gray-900">{member.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-mono bg-gray-100 text-gray-800 border">
                              {member.id.substring(0, 8)}...
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              {member.peerURLs.map((url, idx) => (
                                <div key={idx} className="inline-flex items-center px-2 py-1 rounded text-xs font-mono bg-blue-50 text-blue-800 border border-blue-200 mr-1">
                                  <Network className="h-3 w-3 mr-1" />
                                  {url}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              {member.clientURLs.map((url, idx) => (
                                <div key={idx} className="inline-flex items-center px-2 py-1 rounded text-xs font-mono bg-green-50 text-green-800 border border-green-200 mr-1">
                                  <Network className="h-3 w-3 mr-1" />
                                  {url}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {member.isLearner ? (
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                                <Clock className="h-3 w-3 mr-1" />
                                Learning
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Active
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* System Services */}
            <div>
              <div className="flex items-center mb-4">
                <Activity className="h-5 w-5 text-teal-600 mr-2" />
                <h3 className="text-xl font-semibold text-gray-900">System Services</h3>
                <span className="ml-2 px-2 py-1 bg-teal-100 text-teal-800 text-xs font-medium rounded-full">
                  {clusterDetails.talosInfo.systemServices.length} services
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clusterDetails.talosInfo.systemServices.map((service) => (
                  <Card key={service.id} className="p-6 border-l-4 border-teal-500 hover:shadow-lg transition-shadow duration-200">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <div className="p-2 bg-teal-100 rounded-lg mr-3">
                          <Activity className="h-5 w-5 text-teal-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{service.id}</h4>
                          <div className="flex items-center space-x-2 mt-1">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(service.state)}`}>
                              {getStatusIcon(service.state)}
                              <span className="ml-1">{service.state}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                      <h5 className="font-semibold text-gray-700 mb-2 flex items-center">
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Health Status
                      </h5>
                      <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        service.health === 'Healthy' ? 'bg-green-100 text-green-800 border border-green-200' :
                        service.health === 'Unhealthy' ? 'bg-red-100 text-red-800 border border-red-200' :
                        'bg-yellow-100 text-yellow-800 border border-yellow-200'
                      }`}>
                        {service.health === 'Healthy' ? (
                          <CheckCircle className="h-3 w-3 mr-1" />
                        ) : service.health === 'Unhealthy' ? (
                          <XCircle className="h-3 w-3 mr-1" />
                        ) : (
                          <AlertTriangle className="h-3 w-3 mr-1" />
                        )}
                        {service.health}
                      </div>
                    </div>

                    {service.events.length > 0 && (
                      <div>
                        <h5 className="font-semibold text-gray-700 mb-3 flex items-center">
                          <Clock className="h-4 w-4 mr-2" />
                          Recent Events
                          <span className="ml-2 px-1.5 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full">
                            {service.events.length}
                          </span>
                        </h5>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {service.events.slice(0, 3).map((event, idx) => (
                            <div key={idx} className="bg-white border rounded-lg p-3">
                              <div className="flex items-start justify-between mb-1">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  event.state === 'Running' ? 'bg-green-100 text-green-800' :
                                  event.state === 'Stopped' ? 'bg-red-100 text-red-800' :
                                  'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {event.state}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">{event.ts}</span>
                              </div>
                              <p className="text-xs text-gray-600 leading-relaxed">{event.msg}</p>
                            </div>
                          ))}
                          {service.events.length > 3 && (
                            <div className="text-center">
                              <span className="text-xs text-gray-500">
                                +{service.events.length - 3} more events
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}

      {/* Storage Pool Details Modal */}
      {showStoragePoolModal && selectedStoragePool && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Storage Pool Details</h2>
                <button
                  onClick={closeStoragePoolModal}
                  className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
                >
                  ×
                </button>
              </div>

              <div className="space-y-6">
                {/* Basic Information */}
                <Card className="p-4">
                  <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-600 font-medium">Name:</span>
                        <span className="font-mono">{selectedStoragePool.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 font-medium">Type:</span>
                        <span>{selectedStoragePool.type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 font-medium">Namespace:</span>
                        <span>{selectedStoragePool.namespace || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 font-medium">Node:</span>
                        <span className="font-mono">{selectedStoragePool.node || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 font-medium">Status:</span>
                        <span className={`px-2 py-1 rounded text-sm ${getPoolStatusColor(selectedStoragePool.status)}`}>
                          {selectedStoragePool.status}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 font-medium">Age:</span>
                        <span>{selectedStoragePool.age}</span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {selectedStoragePool.capacity && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 font-medium">Capacity:</span>
                          <span className="font-mono">{formatStorageSize(selectedStoragePool.capacity)}</span>
                        </div>
                      )}
                      {selectedStoragePool.used && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 font-medium">Used:</span>
                          <span className="font-mono">{formatStorageSize(selectedStoragePool.used)}</span>
                        </div>
                      )}
                      {selectedStoragePool.available && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 font-medium">Available:</span>
                          <span className="font-mono">{formatStorageSize(selectedStoragePool.available)}</span>
                        </div>
                      )}
                      {selectedStoragePool.free && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 font-medium">Free:</span>
                          <span className="font-mono">{formatStorageSize(selectedStoragePool.free)}</span>
                        </div>
                      )}
                      {selectedStoragePool.replicationFactor && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 font-medium">Replication Factor:</span>
                          <span>{selectedStoragePool.replicationFactor}</span>
                        </div>
                      )}
                      {selectedStoragePool.readonly !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 font-medium">Read Only:</span>
                          <span className={selectedStoragePool.readonly ? 'text-yellow-600' : 'text-green-600'}>
                            {selectedStoragePool.readonly ? 'Yes' : 'No'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Disk Information */}
                {selectedStoragePool.disks && selectedStoragePool.disks.length > 0 && (
                  <Card className="p-4">
                    <h3 className="text-lg font-semibold mb-4">Disk Information</h3>
                    <div className="space-y-2">
                      {selectedStoragePool.disks.map((disk, idx) => (
                        <div key={idx} className="flex items-center p-2 bg-gray-50 rounded">
                          <HardDrive className="h-4 w-4 text-gray-600 mr-2" />
                          <span className="font-mono text-sm">{disk}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 text-sm text-gray-600">
                      Total Disks: {selectedStoragePool.disks.length}
                    </div>
                  </Card>
                )}

                {/* Usage Statistics */}
                {(selectedStoragePool.capacity || selectedStoragePool.used || selectedStoragePool.available) && (
                  <Card className="p-4">
                    <h3 className="text-lg font-semibold mb-4">Usage Statistics</h3>
                    <div className="space-y-4">
                      {selectedStoragePool.capacity && selectedStoragePool.used && (() => {
                        const usedBytes = safeParseFloat(selectedStoragePool.used)
                        const capacityBytes = safeParseFloat(selectedStoragePool.capacity)
                        const percentage = capacityBytes > 0 ? (usedBytes / capacityBytes) * 100 : 0
                        const validPercentage = isNaN(percentage) ? 0 : percentage
                        
                        return (
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Storage Usage</span>
                              <span>
                                {formatStorageSize(selectedStoragePool.used)} / {formatStorageSize(selectedStoragePool.capacity)}
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-blue-600 h-2 rounded-full" 
                                style={{ 
                                  width: `${Math.min(100, validPercentage)}%` 
                                }}
                              ></div>
                            </div>
                          </div>
                        )
                      })()}
                      
                      <div className="grid grid-cols-2 gap-4 text-center">
                        {selectedStoragePool.capacity && (
                          <div className="bg-blue-50 p-3 rounded">
                            <div className="text-xl font-bold text-blue-600">{formatStorageSize(selectedStoragePool.capacity)}</div>
                            <div className="text-sm text-blue-800">Total Capacity</div>
                          </div>
                        )}
                        {selectedStoragePool.used && (
                          <div className="bg-orange-50 p-3 rounded">
                            <div className="text-xl font-bold text-orange-600">{formatStorageSize(selectedStoragePool.used)}</div>
                            <div className="text-sm text-orange-800">Used Space</div>
                          </div>
                        )}
                        {selectedStoragePool.available && (
                          <div className="bg-green-50 p-3 rounded">
                            <div className="text-xl font-bold text-green-600">{formatStorageSize(selectedStoragePool.available)}</div>
                            <div className="text-sm text-green-800">Available Space</div>
                          </div>
                        )}
                        {selectedStoragePool.free && (
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="text-xl font-bold text-gray-600">{formatStorageSize(selectedStoragePool.free)}</div>
                            <div className="text-sm text-gray-800">Free Space</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                )}

                {/* Actions */}
                <div className="flex justify-end space-x-3">
                  <Button onClick={closeStoragePoolModal} variant="outline">
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Update Check Progress Modal */}
      {showUpdateCheckModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold flex items-center">
                  <RefreshCw className={`h-5 w-5 mr-2 ${checkingForUpdates ? 'animate-spin' : ''} text-blue-600`} />
                  Checking for Image Updates
                </h2>
                <button
                  onClick={() => !checkingForUpdates && setShowUpdateCheckModal(false)}
                  disabled={checkingForUpdates}
                  className={`text-gray-400 hover:text-gray-600 text-2xl font-bold ${checkingForUpdates ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  ×
                </button>
              </div>
              
              {/* Progress Bar */}
              <div className="mt-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Progress: {updateCheckProgress.checked} / {updateCheckProgress.total}</span>
                  <span>{updateCheckProgress.total > 0 ? Math.round((updateCheckProgress.checked / updateCheckProgress.total) * 100) : 0}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${updateCheckProgress.total > 0 ? (updateCheckProgress.checked / updateCheckProgress.total) * 100 : 0}%` }}
                  ></div>
                </div>
                {checkingForUpdates && updateCheckProgress.current && (
                  <div className="mt-2 text-sm text-gray-600 flex items-center">
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                    Currently checking: <span className="font-mono ml-1 text-blue-600">{updateCheckProgress.current}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-2">
                {updateCheckProgress.results.map((result, idx) => (
                  <div 
                    key={idx}
                    className={`p-3 rounded-lg border transition-all ${
                      result.status === 'checking' ? 'bg-gray-50 border-gray-200' :
                      result.status === 'update-available' ? 'bg-blue-50 border-blue-300' :
                      result.status === 'up-to-date' ? 'bg-green-50 border-green-200' :
                      'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center flex-1 min-w-0">
                        {result.status === 'checking' && (
                          <RefreshCw className="h-4 w-4 text-gray-500 mr-2 animate-spin flex-shrink-0" />
                        )}
                        {result.status === 'update-available' && (
                          <TrendingUp className="h-4 w-4 text-blue-600 mr-2 flex-shrink-0" />
                        )}
                        {result.status === 'up-to-date' && (
                          <CheckCircle className="h-4 w-4 text-green-600 mr-2 flex-shrink-0" />
                        )}
                        {result.status === 'error' && (
                          <XCircle className="h-4 w-4 text-red-600 mr-2 flex-shrink-0" />
                        )}
                        
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm font-medium text-gray-900 truncate" title={result.fullName}>
                            {result.fullName}
                          </div>
                          {result.error && (
                            <div className="text-xs text-red-600 mt-1">
                              {result.error}
                            </div>
                          )}
                          {result.status === 'update-available' && result.newerVersion && (
                            <div className="text-xs text-blue-600 mt-1 flex items-center">
                              <TrendingUp className="h-3 w-3 mr-1" />
                              Newer version available: <span className="font-bold ml-1">{result.newerVersion}</span>
                            </div>
                          )}
                          {result.status !== 'checking' && (
                            <div className="text-xs text-gray-500 mt-1">
                              Checked via: <span className="font-medium">{result.checkedVia === 'nexus' ? 'Nexus' : 'Current registry'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="ml-3 flex-shrink-0">
                        {result.status === 'checking' && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-700">
                            Checking...
                          </span>
                        )}
                        {result.status === 'update-available' && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-blue-500 text-white">
                            {result.newerVersion ? `→ ${result.newerVersion}` : 'UPDATE AVAILABLE'}
                          </span>
                        )}
                        {result.status === 'up-to-date' && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-200 text-green-800">
                            Up to date
                          </span>
                        )}
                        {result.status === 'error' && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-200 text-red-800">
                            Error
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Summary */}
              {!checkingForUpdates && updateCheckProgress.checked === updateCheckProgress.total && updateCheckProgress.total > 0 && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-blue-600">
                        {updateCheckProgress.results.filter(r => r.status === 'update-available').length}
                      </div>
                      <div className="text-xs text-gray-600">Updates Available</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600">
                        {updateCheckProgress.results.filter(r => r.status === 'up-to-date').length}
                      </div>
                      <div className="text-xs text-gray-600">Up to Date</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-red-600">
                        {updateCheckProgress.results.filter(r => r.status === 'error').length}
                      </div>
                      <div className="text-xs text-gray-600">Errors</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <div className="flex justify-end">
                <Button 
                  onClick={() => setShowUpdateCheckModal(false)}
                  disabled={checkingForUpdates}
                  variant="outline"
                >
                  {checkingForUpdates ? 'Checking...' : 'Close'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating AI Assistant */}
      <AIChatbot />
      </div>
    </AppShell>
  )
}