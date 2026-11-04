'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { RefreshCw, Shield, ZoomIn, ZoomOut, RotateCcw, Network, Box, Target, Timer } from 'lucide-react'

// Layout constants for consistent positioning
const LAYOUT_CONSTANTS = {
  SERVICE_RADIUS: 40,
  POD_WIDTH: 70,
  POD_HEIGHT: 40,
  MIN_NODE_DISTANCE: 120,
  MAX_OPTIMIZATION_ITERATIONS: 50,
  ZOOM_STEP: 0.2,
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 3,
  VIEWPORT_PADDING: 50,
  TEXT_CHAR_WIDTH: 7
} as const

// Type definitions for better type safety
interface Point { x: number; y: number }
interface BoundingBox { x: number; y: number; width: number; height: number }

// Error Boundary Component
class NetworkVisualizationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('NetworkVisualization Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="relative h-96 w-full bg-gray-50 border border-gray-200">
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Shield className="w-12 h-12 mb-4 text-red-400" />
            <h3 className="text-lg font-medium mb-2">Visualization Error</h3>
            <p className="text-sm text-gray-400 mb-4">The network topology encountered an error</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Try Again
            </button>
            {this.state.error && (
              <details className="mt-4 text-xs text-gray-400 max-w-md">
                <summary className="cursor-pointer">Error Details</summary>
                <pre className="mt-2 p-2 bg-gray-100 rounded overflow-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </Card>
      )
    }

    return this.props.children
  }
}

interface NetworkNode {
  id: string
  name: string
  type: 'pod' | 'service' | 'ingress'
  namespace: string
  x: number
  y: number
  labels: Record<string, string>
  phase?: string
  serviceType?: string
  ports?: number[]
  ingressClass?: string
  hosts?: string[]
  isDragging?: boolean
}

interface NetworkConnection {
  id: string
  source: string
  target: string
  type: string
  protocol: string
  ports: number[]
  flowAction?: 'Allow' | 'Drop' | 'Reject' | 'Unknown'
  flowPackets?: number
  flowBytes?: number
  flowLastSeen?: string
}

interface NetworkData {
  pods: NetworkNode[]
  services: NetworkNode[]
  ingresses: NetworkNode[]
  connections: NetworkConnection[]
  statistics: {
    totalConnections: number
    totalNetworkPolicies: number
  }
}

interface NetworkVisualizationProps {
  clusterId: string
  namespace?: string
}

const DEFAULT_USER_PREFERENCES = {
  showConnections: true,
  showPods: true,
  showServices: true,
  showIngresses: true,
  connectionFilter: 'all'
}

type AntreaFlowStatus = 'active' | 'configured' | 'disabled' | 'error'

const NetworkVisualizationNew = React.memo(function NetworkVisualizationNew({ clusterId, namespace }: NetworkVisualizationProps) {
  const [data, setData] = useState<NetworkData | null>(null)
  const [flowConnections, setFlowConnections] = useState<NetworkConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [antreaFlowStatus, setAntreaFlowStatus] = useState<AntreaFlowStatus>('disabled')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isOptimizing, setIsOptimizing] = useState(false)
  
  // Performance tracking
  const [layoutStats, setLayoutStats] = useState({
    optimizationTime: 0,
    iterationsUsed: 0,
    crossingsEliminated: 0,
    lastOptimized: null as Date | null
  })
  
  // User preferences persistence
  const [userPreferences, setUserPreferences] = useState(DEFAULT_USER_PREFERENCES)
  const [draggedNode, setDraggedNode] = useState<NetworkNode | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  
  // Use preferences for these states
  const [showConnections, setShowConnections] = useState(userPreferences.showConnections)
  const [showServices, setShowServices] = useState(userPreferences.showServices)
  const [showPods, setShowPods] = useState(userPreferences.showPods)
  const [showIngresses, setShowIngresses] = useState<boolean>(userPreferences.showIngresses ?? true)
  const [connectionFilter, setConnectionFilter] = useState(userPreferences.connectionFilter)
  
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load preferences on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`network-prefs-${clusterId}-${namespace}`)
      if (saved) {
        try {
          const prefs = JSON.parse(saved)
          const fullPrefs = { ...DEFAULT_USER_PREFERENCES, ...prefs, showIngresses: prefs.showIngresses ?? true }
          setUserPreferences(fullPrefs)
          setShowConnections(fullPrefs.showConnections)
          setShowServices(fullPrefs.showServices)
          setShowPods(fullPrefs.showPods)
          setShowIngresses(fullPrefs.showIngresses)
          setConnectionFilter(fullPrefs.connectionFilter)
        } catch (error) {
          console.warn('Failed to load preferences:', error)
        }
      }
    }
  }, [clusterId, namespace])

  // Save preferences whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const prefs = { showConnections, showServices, showPods, showIngresses, connectionFilter }
      localStorage.setItem(`network-prefs-${clusterId}-${namespace}`, JSON.stringify(prefs))
      setUserPreferences(prefs)
    }
  }, [showConnections, showServices, showPods, showIngresses, connectionFilter, clusterId, namespace])

  // Save/restore layout positions
  const saveLayout = useCallback(() => {
    if (!data || typeof window === 'undefined') return
    const positions: Record<string, Point> = {}
    
    data.services.forEach(service => {
      positions[service.id] = { x: service.x, y: service.y }
    })
    data.pods.forEach(pod => {
      positions[pod.id] = { x: pod.x, y: pod.y }
    })
    data.ingresses?.forEach(ingress => {
      positions[ingress.id] = { x: ingress.x, y: ingress.y }
    })
    
    localStorage.setItem(`layout-${clusterId}-${namespace}`, JSON.stringify(positions))
  }, [data, clusterId, namespace])

  const restoreLayout = useCallback((nodes: NetworkNode[]) => {
    if (typeof window === 'undefined') return nodes
    
    const saved = localStorage.getItem(`layout-${clusterId}-${namespace}`)
    if (!saved) return nodes
    
    try {
      const positions: Record<string, Point> = JSON.parse(saved)
      return nodes.map(node => ({
        ...node,
        x: positions[node.id]?.x ?? node.x,
        y: positions[node.id]?.y ?? node.y
      }))
    } catch {
      return nodes
    }
  }, [clusterId, namespace])

  // Auto-save layout when nodes are moved
  useEffect(() => {
    if (data && !draggedNode) {
      const timer = setTimeout(() => {
        saveLayout()
      }, 1000) // Save 1 second after dragging stops
      
      return () => clearTimeout(timer)
    }
  }, [data, draggedNode, saveLayout])

  const fetchNetworkData = useCallback(async () => {
    try {
      console.log('NetworkVisualization: Starting fetch for cluster', clusterId, 'namespace', namespace)
      setLoading(true)
      setError(null)
      
      const params = namespace ? `?namespace=${namespace}` : ''
      const response = await fetch(`/api/clusters/${clusterId}/network-traffic${params}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch network data')
      }
      
      const result = await response.json()
      console.log('NetworkVisualization: Received data', result)

      let flowMap = new Map<string, { action: 'Allow' | 'Drop' | 'Reject' | 'Unknown', packets: number, bytes: number, lastSeen?: string }>()
      let flowConnectionsFromApi: NetworkConnection[] = []
      setAntreaFlowStatus('disabled')

      const podIpToId = new Map<string, string>()
      for (const pod of result.pods || []) {
        const podIp = typeof pod?.podIP === 'string' ? pod.podIP.trim() : ''
        if (podIp && typeof pod?.id === 'string') {
          podIpToId.set(podIp, pod.id)
        }
      }

      const resolveNodeId = (rawNodeId: unknown) => {
        const nodeId = String(rawNodeId || '')
        if (!nodeId.startsWith('external-')) {
          return nodeId
        }

        const ipFromNodeId = nodeId.replace(/^external-/, '').replace(/-/g, '.')
        return podIpToId.get(ipFromNodeId) || nodeId
      }

      try {
        const flowQuery = new URLSearchParams(namespace ? { namespace } : {})
        flowQuery.set('window', '24h')
        const flowResponse = await fetch(`/api/clusters/${clusterId}/network-flows?${flowQuery.toString()}`)
        let flowResult: any = null
        try {
          flowResult = await flowResponse.json()
        } catch {
          flowResult = null
        }

        const isConfigured = flowResult?.configured === true
        const flowCount = Array.isArray(flowResult?.flows) ? flowResult.flows.length : 0
        const sourceValue = typeof flowResult?.source === 'string' ? flowResult.source : ''
        const isReceiverSource = sourceValue.startsWith('ipfix://')
        const hasFlowError = Boolean(flowResult?.error)

        if (Array.isArray(flowResult?.flows)) {
          flowConnectionsFromApi = flowResult.flows.map((flow: any, index: number) => {
            const resolvedSourceId = resolveNodeId(flow?.sourceId)
            const resolvedTargetId = resolveNodeId(flow?.targetId)
            const sourceType = resolvedSourceId.startsWith('service-') ? 'service' : 'pod'
            const targetType = resolvedTargetId.startsWith('service-') ? 'service' : 'pod'
            const flowPorts = Array.from(new Set(
              [
                flow?.sourcePort,
                flow?.sourceTransportPort
              ]
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0 && value <= 65535)
                .map((value) => Math.trunc(value))
            ))

            let inferredType = 'pod-to-pod'
            if (sourceType === 'pod' && targetType === 'service') inferredType = 'pod-connects-service'
            else if (sourceType === 'service' && targetType === 'pod') inferredType = 'service-selects-pod'
            else if (sourceType === 'service' && targetType === 'service') inferredType = 'service-to-pod'

            return {
              id: `flow-${index}-${resolvedSourceId}-${resolvedTargetId}`,
              source: resolvedSourceId,
              target: resolvedTargetId,
              type: inferredType,
              protocol: 'ipfix',
              ports: flowPorts,
              flowAction: (flow.action || 'Unknown') as 'Allow' | 'Drop' | 'Reject' | 'Unknown',
              flowPackets: Number(flow.packets || 0),
              flowBytes: Number(flow.bytes || 0),
              flowLastSeen: flow.lastSeen
            }
          })

          flowMap = new Map(
            flowResult.flows.map((flow: any) => [
              `${resolveNodeId(flow.sourceId)}->${resolveNodeId(flow.targetId)}`,
              {
                action: flow.action || 'Unknown',
                packets: Number(flow.packets || 0),
                bytes: Number(flow.bytes || 0),
                lastSeen: flow.lastSeen
              }
            ])
          )
        }

        if (isConfigured) {
          const shouldMarkActive = flowResponse.ok && !hasFlowError
          setAntreaFlowStatus(shouldMarkActive ? 'active' : 'configured')
        } else if (!flowResponse.ok) {
          setAntreaFlowStatus('configured')
        } else {
          setAntreaFlowStatus('disabled')
        }
      } catch (flowError) {
        console.warn('NetworkVisualization: Antrea flow overlay unavailable', flowError)
        setAntreaFlowStatus('configured')
      }

      const enrichedConnections = (result.connections || []).map((connection: NetworkConnection) => {
        const key = `${connection.source}->${connection.target}`
        const flow = flowMap.get(key)
        if (!flow) {
          return connection
        }

        return {
          ...connection,
          flowAction: flow.action,
          flowPackets: flow.packets,
          flowBytes: flow.bytes,
          flowLastSeen: flow.lastSeen
        }
      })
      
      // Initialize positions with hierarchical layout to prevent line crossings
      const width = 1200
      const height = 800
      const centerX = width / 2
      const centerY = height / 2
      
      // Build connection relationship map for smart positioning
      const connectionMap = new Map()
      const podToServiceMap = new Map() // Track which pods connect to which services
      const serviceToPodMap = new Map() // Track which services connect to which pods
      
      result.connections.forEach((conn: any) => {
        if (!connectionMap.has(conn.source)) connectionMap.set(conn.source, [])
        if (!connectionMap.has(conn.target)) connectionMap.set(conn.target, [])
        connectionMap.get(conn.source).push(conn.target)
        
        // Build pod-service relationship maps for positioning
        const sourceNode = [...result.services, ...result.pods].find((n: any) => n.id === conn.source)
        const targetNode = [...result.services, ...result.pods].find((n: any) => n.id === conn.target)
        
        if (sourceNode && targetNode) {
          if (sourceNode.type === 'pod' && targetNode.type === 'service') {
            if (!podToServiceMap.has(conn.source)) podToServiceMap.set(conn.source, [])
            podToServiceMap.get(conn.source).push(conn.target)
          }
          if (sourceNode.type === 'service' && targetNode.type === 'pod') {
            if (!serviceToPodMap.has(conn.source)) serviceToPodMap.set(conn.source, [])
            serviceToPodMap.get(conn.source).push(conn.target)
          }
        }
      })
      
      // Separate services by type for layered layout
      const loadBalancerServices = result.services.filter((s: any) => s.serviceType === 'LoadBalancer')
      const nodePortServices = result.services.filter((s: any) => s.serviceType === 'NodePort') 
      const clusterIPServices = result.services.filter((s: any) => s.serviceType === 'ClusterIP')
      
      // Simple service positioning with good spacing
      const calculateServiceX = (service: any, serviceIndex: number, totalServices: number, serviceType: string) => {
        // Simple spacing based on service index
        return centerX + (serviceIndex - (totalServices - 1) / 2) * 220
      }
      
      // Layer 0: Ingresses at the very top (external entry point)
      const ingresses = (result.ingresses || []).map((ingress: any, index: number) => ({
        ...ingress,
        x: centerX + (index - ((result.ingresses?.length || 1) - 1) / 2) * 250,
        y: 40
      }))

      // Layer 1: LoadBalancer services at top
      const lbServices = loadBalancerServices.map((service: any, index: number) => ({
        ...service,
        x: calculateServiceX(service, index, loadBalancerServices.length, 'LoadBalancer'),
        y: 120
      }))
      
      // Layer 2: NodePort services in upper middle  
      const npServices = nodePortServices.map((service: any, index: number) => ({
        ...service,
        x: calculateServiceX(service, index, nodePortServices.length, 'NodePort'),
        y: 240
      }))
      
      // Layer 3: ClusterIP services in center
      const cipServices = clusterIPServices.map((service: any, index: number) => ({
        ...service,
        x: calculateServiceX(service, index, clusterIPServices.length, 'ClusterIP'),
        y: 360
      }))
      
      const services = [...lbServices, ...npServices, ...cipServices]
      
      // Smart pod positioning based on service connections 
      const podPositions = new Map()
      
      // Position pods based on their connected services
      result.pods.forEach((pod: any) => {
        const connectedServices = podToServiceMap.get(pod.id) || []
        
        if (connectedServices.length > 0) {
          // Find the services this pod connects to
          const serviceNodes = services.filter(s => connectedServices.includes(s.id))
          if (serviceNodes.length > 0) {
            // Position pod based on average X of connected services
            const avgServiceX = serviceNodes.reduce((sum, s) => sum + s.x, 0) / serviceNodes.length
            const avgServiceY = serviceNodes.reduce((sum, s) => sum + s.y, 0) / serviceNodes.length
            
            podPositions.set(pod.id, {
              x: avgServiceX,
              y: avgServiceY + 150, // Position pods below their services
              hasConnections: true
            })
          }
        }
      })
      
      // Group pods by their positioning strategy
      const connectedPods: any[] = []
      const isolatedPods: any[] = []
      
      result.pods.forEach((pod: any) => {
        if (podPositions.has(pod.id)) {
          connectedPods.push(pod)
        } else {
          isolatedPods.push(pod)
        }
      })
      
      // Intelligent pod positioning to minimize crossings from the start
      const connectedPodsPositioned = connectedPods.map((pod: any, index: number) => {
        const position = podPositions.get(pod.id)
        
        // Group pods by their connected service for better organization
        const connectedServices = podToServiceMap.get(pod.id) || []
        const primaryService = services.find(s => connectedServices.includes(s.id))
        
        if (primaryService) {
          // Find other pods connected to the same service
          const sameSerivcePods = connectedPods.filter((otherPod: any) => {
            const otherServices = podToServiceMap.get(otherPod.id) || []
            return otherServices.includes(primaryService.id)
          })
          
          const podIndexInGroup = sameSerivcePods.findIndex(p => p.id === pod.id)
          const groupSize = sameSerivcePods.length
          
          // Arrange pods in an arc below their service to prevent line crossings
          const arcRadius = Math.max(100, groupSize * 40)
          const angleStep = groupSize > 1 ? Math.PI / (groupSize + 1) : 0
          const startAngle = Math.PI / 2 - (angleStep * (groupSize - 1)) / 2
          const podAngle = startAngle + angleStep * podIndexInGroup
          
          const arcX = primaryService.x + Math.cos(podAngle) * arcRadius
          const arcY = primaryService.y + Math.abs(Math.sin(podAngle)) * arcRadius + 120
          
          return {
            ...pod,
            x: Math.max(120, Math.min(1080, arcX)),
            y: Math.max(450, Math.min(650, arcY))
          }
        } else {
          // Fallback to original positioning
          const offsetX = (index % 3 - 1) * 100 // Increased spacing
          const offsetY = Math.floor(index / 3) * 120 // More vertical spacing
          
          return {
            ...pod,
            x: Math.max(120, Math.min(1080, position.x + offsetX)),
            y: Math.max(450, Math.min(650, position.y + offsetY))
          }
        }
      })
      
      // Position isolated pods (no service connections) at the bottom
      const isolatedPodsPositioned = isolatedPods.map((pod: any, index: number) => ({
        ...pod,
        x: centerX + (index - (isolatedPods.length - 1) / 2) * 150, // Increased spacing
        y: 650  // Moved lower for bigger nodes
      }))
      
      const pods = [...connectedPodsPositioned, ...isolatedPodsPositioned]
      
      // Simplified positioning to avoid complex algorithms causing issues
      console.log('NetworkVisualization: Applying simple positioning to', services.length + pods.length, 'nodes')
      
      // Simple bounds checking for services
      services.forEach((service, index) => {
        service.x = Math.max(100, Math.min(1100, service.x))
        service.y = Math.max(80, Math.min(400, service.y))
      })
      
      // Simple bounds checking for pods
      pods.forEach((pod, index) => {
        pod.x = Math.max(100, Math.min(1100, pod.x))
        pod.y = Math.max(450, Math.min(700, pod.y))
      })
      
      // Prevent nodes from being placed on top of connection lines
      const avoidLineCollisions = () => {
        const allNodes = [...services, ...pods, ...ingresses]
        const connections = result.connections
        
        // Check each node for line intersections and adjust position if needed
        allNodes.forEach((node, nodeIndex) => {
          let moved = true
          let attempts = 0
          const maxAttempts = 20
          
          while (moved && attempts < maxAttempts) {
            moved = false
            attempts++
            
            // Check if this node intersects with any connection line
            for (const connection of connections) {
              const sourceNode = allNodes.find(n => n.id === connection.source)
              const targetNode = allNodes.find(n => n.id === connection.target)
              
              if (!sourceNode || !targetNode || sourceNode.id === node.id || targetNode.id === node.id) {
                continue // Skip if nodes not found or node is part of this connection
              }
              
              // Check if node intersects with the line between source and target
              if (nodeIntersectsLine(node, sourceNode, targetNode)) {
                // Move node away from the line
                const moveVector = getMoveVectorAwayFromLine(node, sourceNode, targetNode)
                node.x = Math.max(100, Math.min(1100, node.x + moveVector.x))
                node.y = Math.max(70, Math.min(730, node.y + moveVector.y))
                moved = true
                break // Check again with new position
              }
            }
          }
        })
      }
      
      // Helper function to check if a node intersects with a line
      const nodeIntersectsLine = (node: any, lineStart: any, lineEnd: any) => {
        const nodeRadius = node.type === 'service' ? 40 : 35 // Service circle radius or pod half-width
        
        // Calculate distance from node center to line
        const A = lineEnd.y - lineStart.y
        const B = lineStart.x - lineEnd.x
        const C = lineEnd.x * lineStart.y - lineStart.x * lineEnd.y
        
        const distance = Math.abs(A * node.x + B * node.y + C) / Math.sqrt(A * A + B * B)
        
        // Check if node is close enough to the line to intersect
        if (distance > nodeRadius + 10) return false // 10px buffer
        
        // Check if the closest point on the line is within the line segment
        const lineLength = Math.sqrt((lineEnd.x - lineStart.x) ** 2 + (lineEnd.y - lineStart.y) ** 2)
        if (lineLength === 0) return false
        
        const t = Math.max(0, Math.min(1, 
          ((node.x - lineStart.x) * (lineEnd.x - lineStart.x) + (node.y - lineStart.y) * (lineEnd.y - lineStart.y)) / (lineLength * lineLength)
        ))
        
        const closestX = lineStart.x + t * (lineEnd.x - lineStart.x)
        const closestY = lineStart.y + t * (lineEnd.y - lineStart.y)
        
        const distToClosest = Math.sqrt((node.x - closestX) ** 2 + (node.y - closestY) ** 2)
        return distToClosest < nodeRadius + 10
      }
      
      // Helper function to get movement vector away from a line
      const getMoveVectorAwayFromLine = (node: any, lineStart: any, lineEnd: any) => {
        // Calculate perpendicular vector to the line
        const lineVecX = lineEnd.x - lineStart.x
        const lineVecY = lineEnd.y - lineStart.y
        const lineLength = Math.sqrt(lineVecX * lineVecX + lineVecY * lineVecY)
        
        if (lineLength === 0) return { x: 20, y: 0 }
        
        // Get perpendicular vector (rotated 90 degrees)
        const perpX = -lineVecY / lineLength
        const perpY = lineVecX / lineLength
        
        // Calculate which side of the line the node is on
        const cross = (node.x - lineStart.x) * lineVecY - (node.y - lineStart.y) * lineVecX
        const side = cross > 0 ? 1 : -1
        
        // Move 60 pixels away from the line
        const moveDistance = 60
        return {
          x: perpX * side * moveDistance,
          y: perpY * side * moveDistance
        }
      }
      
      // Apply line collision avoidance
      avoidLineCollisions()
      
      // Advanced layout optimization to prevent line crossings and text overlaps
      const preventCrossingsAndOverlaps = () => {
        const startTime = performance.now()
        const allNodes = [...services, ...pods, ...ingresses]
        const connections = result.connections
        
        // Iterative improvement approach
        let improved = true
        let iterations = 0
        const maxIterations = 50
        
        while (improved && iterations < maxIterations) {
          improved = false
          iterations++
          
          // 1. Check and fix line crossings
          for (let i = 0; i < connections.length; i++) {
            for (let j = i + 1; j < connections.length; j++) {
              if (connectionsCross(connections[i], connections[j], allNodes)) {
                // Try to move one of the involved nodes to reduce crossing
                const node = findBestNodeToMove(connections[i], connections[j], allNodes)
                if (node && moveNodeToReduceCrossing(node, connections[i], connections[j], allNodes)) {
                  improved = true
                }
              }
            }
          }
          
          // 2. Check and fix text overlaps
          for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
              if (textsOverlap(allNodes[i], allNodes[j])) {
                if (separateOverlappingTexts(allNodes[i], allNodes[j])) {
                  improved = true
                }
              }
            }
          }
        }
        
        const endTime = performance.now()
        const optimizationTime = endTime - startTime
        
        // Update performance stats
        setLayoutStats(prev => ({
          ...prev,
          optimizationTime: Math.round(optimizationTime),
          iterationsUsed: iterations,
          crossingsEliminated: iterations > 0 ? Math.max(0, prev.crossingsEliminated + iterations - 1) : 0,
          lastOptimized: new Date()
        }))
        
        setIsOptimizing(false)
        console.log(`Layout optimization completed in ${iterations} iterations (${optimizationTime.toFixed(1)}ms)`)
      }
      
      // Helper function to check if two connections cross
      const connectionsCross = (conn1: any, conn2: any, nodes: any[]) => {
        const n1a = nodes.find(n => n.id === conn1.source)
        const n1b = nodes.find(n => n.id === conn1.target)
        const n2a = nodes.find(n => n.id === conn2.source)
        const n2b = nodes.find(n => n.id === conn2.target)
        
        if (!n1a || !n1b || !n2a || !n2b) return false
        
        // Check if the two line segments intersect
        return lineSegmentsIntersect(n1a.x, n1a.y, n1b.x, n1b.y, n2a.x, n2a.y, n2b.x, n2b.y)
      }
      
      // Helper function to check line segment intersection
      const lineSegmentsIntersect = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if (Math.abs(denom) < 0.001) return false // Parallel lines
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom
        
        return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99 // Small margin to avoid endpoint intersections
      }
      
      // Helper function to find best node to move to reduce crossing
      const findBestNodeToMove = (conn1: any, conn2: any, nodes: any[]) => {
        const candidates = [
          nodes.find(n => n.id === conn1.source),
          nodes.find(n => n.id === conn1.target),
          nodes.find(n => n.id === conn2.source),
          nodes.find(n => n.id === conn2.target)
        ].filter(n => n && n.type === 'pod') // Prefer to move pods over services
        
        return candidates[0] || nodes.find(n => n.id === conn1.source) || nodes.find(n => n.id === conn2.source)
      }
      
      // Helper function to move node to reduce crossing
      const moveNodeToReduceCrossing = (node: any, conn1: any, conn2: any, allNodes: any[]) => {
        const originalX = node.x
        const originalY = node.y
        
        // Try several positions around the original position
        const attempts = [
          { x: originalX + 80, y: originalY },
          { x: originalX - 80, y: originalY },
          { x: originalX, y: originalY + 80 },
          { x: originalX, y: originalY - 80 },
          { x: originalX + 60, y: originalY + 60 },
          { x: originalX - 60, y: originalY - 60 }
        ]
        
        for (const attempt of attempts) {
          node.x = Math.max(100, Math.min(1100, attempt.x))
          node.y = Math.max(70, Math.min(730, attempt.y))
          
          // Check if this position reduces crossings and doesn't create overlaps
          if (!connectionsCross(conn1, conn2, allNodes) && !hasNodeOverlap(node, allNodes)) {
            return true // Successfully moved
          }
        }
        
        // Restore original position if no good position found
        node.x = originalX
        node.y = originalY
        return false
      }
      
      // Helper function to check if node texts overlap
      const textsOverlap = (node1: any, node2: any) => {
        // Calculate text bounding boxes (approximate)
        const textHeight = 20
        const text1Width = (node1.name?.length || 0) * 8 // Approximate character width
        const text2Width = (node2.name?.length || 0) * 8
        
        const node1TextY = node1.y + (node1.type === 'service' ? 60 : 50)
        const node2TextY = node2.y + (node2.type === 'service' ? 60 : 50)
        
        // Check if text areas overlap
        const horizontalOverlap = Math.abs(node1.x - node2.x) < (text1Width + text2Width) / 2 + 20
        const verticalOverlap = Math.abs(node1TextY - node2TextY) < textHeight + 10
        
        return horizontalOverlap && verticalOverlap
      }
      
      // Helper function to separate overlapping texts
      const separateOverlappingTexts = (node1: any, node2: any) => {
        const minSeparation = Math.max((node1.name?.length || 0), (node2.name?.length || 0)) * 8 + 40
        const currentDistance = Math.abs(node1.x - node2.x)
        
        if (currentDistance < minSeparation) {
          const moveDistance = (minSeparation - currentDistance) / 2 + 20
          
          if (node1.x < node2.x) {
            node1.x = Math.max(100, node1.x - moveDistance)
            node2.x = Math.min(1100, node2.x + moveDistance)
          } else {
            node1.x = Math.min(1100, node1.x + moveDistance)
            node2.x = Math.max(100, node2.x - moveDistance)
          }
          return true
        }
        return false
      }
      
      // Helper function to check node overlaps
      const hasNodeOverlap = (node: any, allNodes: any[]) => {
        return allNodes.some(other => {
          if (other.id === node.id) return false
          const distance = Math.sqrt((node.x - other.x) ** 2 + (node.y - other.y) ** 2)
          return distance < 120 // Minimum safe distance
        })
      }
      
      // Apply advanced optimization
      preventCrossingsAndOverlaps()
      
      // Auto-scale and center the visualization to optimize space usage
      const optimizeLayout = () => {
        const startTime = performance.now()
        setIsOptimizing(true)
        
        const allNodes = [...services, ...pods, ...ingresses]
        if (allNodes.length === 0) {
          setIsOptimizing(false)
          return
        }
        
        // Calculate current bounding box of all nodes
        const minX = Math.min(...allNodes.map(n => n.x)) - 60 // Account for node size
        const maxX = Math.max(...allNodes.map(n => n.x)) + 60
        const minY = Math.min(...allNodes.map(n => n.y)) - 60
        const maxY = Math.max(...allNodes.map(n => n.y)) + 60
        
        const contentWidth = maxX - minX
        const contentHeight = maxY - minY
        
        // Calculate optimal scale to fit content with some padding
        const viewportWidth = width * 0.9  // Use 90% of available width
        const viewportHeight = height * 0.85 // Use 85% of available height
        
        const scaleX = viewportWidth / contentWidth
        const scaleY = viewportHeight / contentHeight
        const optimalScale = Math.min(scaleX, scaleY, 2.0) // Cap at 2x max zoom
        
        // Calculate center offset to center the content
        const contentCenterX = (minX + maxX) / 2
        const contentCenterY = (minY + maxY) / 2
        const viewportCenterX = width / 2
        const viewportCenterY = height / 2
        
        // Apply scaling and centering to all nodes
        allNodes.forEach(node => {
          // Scale relative to content center
          const relX = (node.x - contentCenterX) * optimalScale
          const relY = (node.y - contentCenterY) * optimalScale
          
          // Position relative to viewport center
          node.x = viewportCenterX + relX
          node.y = viewportCenterY + relY
        })
        
        console.log(`Optimized layout: scale=${optimalScale.toFixed(2)}, content=${contentWidth}x${contentHeight}, nodes=${allNodes.length}`)
      }
      
      // Apply layout optimization
      optimizeLayout()
      
      console.log('NetworkVisualization: Setting data with', services.length, 'services and', pods.length, 'pods')
      
      // Calculate optimal initial zoom based on content density
      const calculateOptimalZoom = () => {
        const totalNodes = services.length + pods.length
        
        if (totalNodes <= 5) {
          return 1.4 // Zoom in for sparse networks
        } else if (totalNodes <= 15) {
          return 1.2 // Slight zoom for medium networks
        } else if (totalNodes <= 30) {
          return 1.0 // Standard zoom for larger networks
        } else {
          return 0.8 // Zoom out for very dense networks
        }
      }
      
      const optimalZoom = calculateOptimalZoom()
      
      // Restore saved layout positions if available
      const restoredServices = restoreLayout(services)
      const restoredPods = restoreLayout(pods)
      const restoredIngresses = restoreLayout(ingresses)
      
      setData({
        ...result,
        connections: enrichedConnections,
        services: restoredServices,
        pods: restoredPods,
        ingresses: restoredIngresses
      })
      setFlowConnections(flowConnectionsFromApi)
      
      // Ensure everything is in view on initial load
      setTimeout(() => {
        const allNodes = [...restoredServices, ...restoredPods, ...restoredIngresses]
        if (allNodes.length === 0) {
          setZoom(1)
          setPan({ x: 0, y: 0 })
          return
        }
        
        // Calculate bounding box of all content
        const minX = Math.min(...allNodes.map(n => n.x)) - 60
        const maxX = Math.max(...allNodes.map(n => n.x)) + 60
        const minY = Math.min(...allNodes.map(n => n.y)) - 60
        const maxY = Math.max(...allNodes.map(n => n.y)) + 60
        
        const contentWidth = maxX - minX
        const contentHeight = maxY - minY
        
        // Calculate zoom to fit everything with comfortable padding
        const viewportWidth = 1200 * 0.85   // Use 85% of viewport for better padding
        const viewportHeight = 800 * 0.8    // Use 80% of viewport height
        
        const scaleX = viewportWidth / contentWidth
        const scaleY = viewportHeight / contentHeight
        const fitZoom = Math.min(scaleX, scaleY, 2.5) // Cap at 2.5x max
        
        // Calculate pan to center all content
        const contentCenterX = (minX + maxX) / 2
        const contentCenterY = (minY + maxY) / 2
        const viewportCenterX = 1200 / 2
        const viewportCenterY = 800 / 2
        
        const centerPanX = (viewportCenterX - contentCenterX) * fitZoom
        const centerPanY = (viewportCenterY - contentCenterY) * fitZoom
        
        console.log(`Initial fit: zoom=${fitZoom.toFixed(2)}, pan=(${centerPanX.toFixed(0)}, ${centerPanY.toFixed(0)})`)
        
        setZoom(fitZoom)
        setPan({ x: centerPanX, y: centerPanY })
      }, 150) // Slightly longer timeout to ensure DOM is ready
    } catch (err) {
      console.error('NetworkVisualization: Error fetching network data:', err)
      setFlowConnections([])
      setError('Failed to load network data')
    } finally {
      setLoading(false)
    }
  }, [clusterId, namespace, restoreLayout])

  // Handle zoom
  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.3, 4))
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.3, 0.2))
  const handleResetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  const handleFitToScreen = useCallback(() => {
    if (!data) return
    
    const allNodes = [...data.services, ...data.pods]
    if (allNodes.length === 0) {
      // Reset to default view if no nodes
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }
    
    // Calculate bounding box with proper node size consideration
    const nodeBuffer = 70 // Account for largest node size + margin
    const minX = Math.min(...allNodes.map(n => n.x)) - nodeBuffer
    const maxX = Math.max(...allNodes.map(n => n.x)) + nodeBuffer
    const minY = Math.min(...allNodes.map(n => n.y)) - nodeBuffer  
    const maxY = Math.max(...allNodes.map(n => n.y)) + nodeBuffer
    
    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    
    // Prevent division by zero or very small content
    if (contentWidth < 50 || contentHeight < 50) {
      setZoom(1.2)
      setPan({ x: 0, y: 0 })
      return
    }
    
    // Calculate optimal zoom with generous padding
    const viewportWidth = 1200 * 0.85   // Use 85% of viewport width
    const viewportHeight = 800 * 0.8    // Use 80% of viewport height
    
    const scaleX = viewportWidth / contentWidth
    const scaleY = viewportHeight / contentHeight
    const optimalZoom = Math.min(scaleX, scaleY, 2.5) // Cap at 2.5x for readability
    
    // Calculate pan to perfectly center content
    const contentCenterX = (minX + maxX) / 2
    const contentCenterY = (minY + maxY) / 2
    const viewportCenterX = 1200 / 2
    const viewportCenterY = 800 / 2
    
    // Apply zoom scaling to pan calculation
    const panX = (viewportCenterX - contentCenterX) * optimalZoom
    const panY = (viewportCenterY - contentCenterY) * optimalZoom
    
    console.log(`Fit to screen: ${allNodes.length} nodes, zoom=${optimalZoom.toFixed(2)}, content=${contentWidth.toFixed(0)}x${contentHeight.toFixed(0)}`)
    
    setZoom(optimalZoom)
    setPan({ x: panX, y: panY })
  }, [data])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return
      }

      switch (e.key) {
        case 'r':
          e.preventDefault()
          fetchNetworkData()
          break
        case 'f':
          e.preventDefault()
          handleFitToScreen()
          break
        case ' ':
          e.preventDefault()
          setShowConnections((prev: boolean) => !prev)
          break
        case 'p':
          e.preventDefault()
          setShowPods((prev: boolean) => !prev)
          break
        case 's':
          e.preventDefault()
          setShowServices((prev: boolean) => !prev)
          break
        case 'i':
          e.preventDefault()
          setShowIngresses((prev: boolean) => !prev)
          break
        case '1':
          e.preventDefault()
          setZoom(1)
          setPan({ x: 0, y: 0 })
          break
        case '+':
        case '=':
          e.preventDefault()
          setZoom(prev => Math.min(LAYOUT_CONSTANTS.MAX_ZOOM, prev + LAYOUT_CONSTANTS.ZOOM_STEP))
          break
        case '-':
          e.preventDefault()
          setZoom(prev => Math.max(LAYOUT_CONSTANTS.MIN_ZOOM, prev - LAYOUT_CONSTANTS.ZOOM_STEP))
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [fetchNetworkData, handleFitToScreen])

  useEffect(() => {
    fetchNetworkData()
  }, [fetchNetworkData])

  useEffect(() => {
    if ((data && data.services.length > 0) || (data && data.pods.length > 0)) {
      const timer = setTimeout(() => {
        handleFitToScreen()
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [data, handleFitToScreen])

  // Handle mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.2, Math.min(4, prev * delta)))
  }, [])

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent, node: NetworkNode) => {
    e.preventDefault()
    e.stopPropagation()
    
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    
    const svgX = (e.clientX - rect.left - pan.x) / zoom
    const svgY = (e.clientY - rect.top - pan.y) / zoom
    
    setDraggedNode(node)
    setDragOffset({
      x: svgX - node.x,
      y: svgY - node.y
    })
  }, [zoom, pan])

  // Handle drag move
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggedNode || !svgRef.current || !data) return
      
      const rect = svgRef.current.getBoundingClientRect()
      const svgX = (e.clientX - rect.left - pan.x) / zoom
      const svgY = (e.clientY - rect.top - pan.y) / zoom
      
      let newX = Math.max(70, Math.min(1130, svgX - dragOffset.x))
      let newY = Math.max(70, Math.min(730, svgY - dragOffset.y))
      
      // Prevent node overlap by checking distance to other nodes
      const allNodes = [...(data?.pods || []), ...(data?.services || [])].filter(n => n.id !== draggedNode.id)
      const minDistance = 140 // Minimum distance between bigger nodes
      
      for (const node of allNodes) {
        const distance = Math.sqrt((newX - node.x) ** 2 + (newY - node.y) ** 2)
        if (distance < minDistance) {
          // Push the node away from overlapping position
          const angle = Math.atan2(newY - node.y, newX - node.x)
          newX = node.x + Math.cos(angle) * minDistance
          newY = node.y + Math.sin(angle) * minDistance
          
          // Ensure still within bounds
          newX = Math.max(70, Math.min(1130, newX))
          newY = Math.max(70, Math.min(730, newY))
        }
      }
      
      // Prevent placing node on top of connection lines
      if (data?.connections) {
        const testNode = { ...draggedNode, x: newX, y: newY }
        let lineCollision = false
        
        for (const connection of data.connections) {
          const sourceNode = allNodes.find(n => n.id === connection.source)
          const targetNode = allNodes.find(n => n.id === connection.target)
          
          if (!sourceNode || !targetNode || sourceNode.id === draggedNode.id || targetNode.id === draggedNode.id) {
            continue
          }
          
          // Check if new position would intersect with this line (using same logic as above)
          const nodeRadius = testNode.type === 'service' ? 40 : 35
          const A = targetNode.y - sourceNode.y
          const B = sourceNode.x - targetNode.x
          const C = targetNode.x * sourceNode.y - sourceNode.x * targetNode.y
          const distance = Math.abs(A * testNode.x + B * testNode.y + C) / Math.sqrt(A * A + B * B)
          
          if (distance < nodeRadius + 15) {
            const lineLength = Math.sqrt((targetNode.x - sourceNode.x) ** 2 + (targetNode.y - sourceNode.y) ** 2)
            if (lineLength > 0) {
              const t = Math.max(0, Math.min(1, 
                ((testNode.x - sourceNode.x) * (targetNode.x - sourceNode.x) + (testNode.y - sourceNode.y) * (targetNode.y - sourceNode.y)) / (lineLength * lineLength)
              ))
              
              const closestX = sourceNode.x + t * (targetNode.x - sourceNode.x)
              const closestY = sourceNode.y + t * (targetNode.y - sourceNode.y)
              const distToClosest = Math.sqrt((testNode.x - closestX) ** 2 + (testNode.y - closestY) ** 2)
              
              if (distToClosest < nodeRadius + 15) {
                // Move node away from line
                const lineVecX = targetNode.x - sourceNode.x
                const lineVecY = targetNode.y - sourceNode.y
                const perpX = -lineVecY / lineLength
                const perpY = lineVecX / lineLength
                const cross = (testNode.x - sourceNode.x) * lineVecY - (testNode.y - sourceNode.y) * lineVecX
                const side = cross > 0 ? 1 : -1
                
                newX = Math.max(70, Math.min(1130, newX + perpX * side * 50))
                newY = Math.max(70, Math.min(730, newY + perpY * side * 50))
                break
              }
            }
          }
        }
      }
      
      setData(prevData => {
        if (!prevData) return prevData
        
        return {
          ...prevData,
          pods: prevData.pods.map(pod => 
            pod.id === draggedNode.id ? { ...pod, x: newX, y: newY } : pod
          ),
          services: prevData.services.map(service => 
            service.id === draggedNode.id ? { ...service, x: newX, y: newY } : service
          )
        }
      })
    }

    const handleMouseUp = () => {
      setDraggedNode(null)
      setDragOffset({ x: 0, y: 0 })
    }

    if (draggedNode) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggedNode, dragOffset, zoom, pan, data])

  // Pan handling
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (draggedNode) return
    
    const startX = e.clientX - pan.x
    const startY = e.clientY - pan.y
    
    const handlePanMove = (moveEvent: MouseEvent) => {
      setPan({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY
      })
    }
    
    const handlePanEnd = () => {
      document.removeEventListener('mousemove', handlePanMove)
      document.removeEventListener('mouseup', handlePanEnd)
    }
    
    document.addEventListener('mousemove', handlePanMove)
    document.addEventListener('mouseup', handlePanEnd)
  }, [pan, draggedNode])

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin mr-2" />
          <span>Loading network topology...</span>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8 text-red-500">
          <Shield className="h-6 w-6 mr-2" />
          <span>{error}</span>
        </div>
      </Card>
    )
  }

  if (!data) return null

  const flowOnlyMode = antreaFlowStatus === 'active'
  const knownNodeIds = new Set<string>([
    ...data.pods.map((pod) => pod.id),
    ...data.services.map((service) => service.id),
    ...(data.ingresses || []).map((ingress) => ingress.id)
  ])
  const knownServiceIds = new Set<string>(data.services.map((service) => service.id))
  const knownNamespaces = Array.from(
    new Set<string>([
      ...data.pods.map((pod) => pod.namespace),
      ...data.services.map((service) => service.namespace),
      ...(data.ingresses || []).map((ingress) => ingress.namespace)
    ])
  ).sort((a, b) => b.length - a.length)

  const flowOnlyConnections = flowConnections.length > 0
    ? flowConnections
    : data.connections.filter((connection) =>
        connection.flowAction !== undefined ||
        connection.flowPackets !== undefined ||
        connection.flowBytes !== undefined ||
        connection.flowLastSeen !== undefined
      )

  const remapStalePodFlowNodeId = (nodeId: string) => {
    if (knownNodeIds.has(nodeId) || !nodeId.startsWith('pod-')) {
      return nodeId
    }

    const matchedNamespace = knownNamespaces.find((namespaceName) =>
      nodeId.startsWith(`pod-${namespaceName}-`)
    )
    if (!matchedNamespace) {
      return nodeId
    }

    const podName = nodeId.slice(`pod-${matchedNamespace}-`.length)
    if (!podName) {
      return nodeId
    }

    const podNameSegments = podName.split('-').filter(Boolean)
    if (podNameSegments.length < 2) {
      return nodeId
    }

    const candidateServiceNames = new Set<string>()

    if (podNameSegments.length > 2) {
      candidateServiceNames.add(podNameSegments.slice(0, -2).join('-'))
    }

    candidateServiceNames.add(podNameSegments.slice(0, -1).join('-'))

    if (/^\d+$/.test(podNameSegments[podNameSegments.length - 1])) {
      candidateServiceNames.add(podNameSegments.slice(0, -1).join('-'))
    }

    for (const serviceName of candidateServiceNames) {
      const candidateServiceId = `service-${matchedNamespace}-${serviceName}`
      if (knownServiceIds.has(candidateServiceId)) {
        return candidateServiceId
      }
    }

    return nodeId
  }

  const normalizedFlowOnlyConnections = flowOnlyConnections.map((connection) => {
    const remappedSource = remapStalePodFlowNodeId(connection.source)
    const remappedTarget = remapStalePodFlowNodeId(connection.target)

    if (remappedSource === connection.source && remappedTarget === connection.target) {
      return connection
    }

    let remappedType = connection.type
    if (remappedSource.startsWith('service-') && remappedTarget.startsWith('service-')) {
      remappedType = 'service-to-pod'
    } else if (remappedSource.startsWith('service-')) {
      remappedType = 'service-selects-pod'
    } else if (remappedTarget.startsWith('service-')) {
      remappedType = 'pod-connects-service'
    } else {
      remappedType = 'pod-to-pod'
    }

    return {
      ...connection,
      source: remappedSource,
      target: remappedTarget,
      type: remappedType
    }
  })

  const flowExternalLinkedNodeIds = flowOnlyMode
    ? (() => {
        const nodeIds = new Set<string>()

        for (const connection of normalizedFlowOnlyConnections) {
          const sourceIsExternal = connection.source.startsWith('external-')
          const targetIsExternal = connection.target.startsWith('external-')
          if (!sourceIsExternal && !targetIsExternal) {
            continue
          }

          if (!sourceIsExternal && knownNodeIds.has(connection.source)) {
            nodeIds.add(connection.source)
          }
          if (!targetIsExternal && knownNodeIds.has(connection.target)) {
            nodeIds.add(connection.target)
          }
        }

        return nodeIds
      })()
    : new Set<string>()

  const flowModeConnections = flowOnlyMode
    ? normalizedFlowOnlyConnections.filter((connection) => {
        if (connection.source.startsWith('external-') || connection.target.startsWith('external-')) {
          return false
        }

        return knownNodeIds.has(connection.source) && knownNodeIds.has(connection.target)
      })
    : flowOnlyConnections

  const aggregatedFlowConnections = flowOnlyMode
    ? (() => {
        const byEdge = new Map<string, NetworkConnection>()

        for (const connection of flowModeConnections) {
          const key = `${connection.source}->${connection.target}`
          const existing = byEdge.get(key)

          if (!existing) {
            byEdge.set(key, {
              ...connection,
              id: key,
              flowPackets: Number(connection.flowPackets || 0),
              flowBytes: Number(connection.flowBytes || 0)
            })
            continue
          }

          const mergedAction =
            existing.flowAction === 'Drop' || connection.flowAction === 'Drop'
              ? 'Drop'
              : existing.flowAction === 'Reject' || connection.flowAction === 'Reject'
                ? 'Reject'
                : existing.flowAction === 'Allow' || connection.flowAction === 'Allow'
                  ? 'Allow'
                  : 'Unknown'

          byEdge.set(key, {
            ...existing,
            flowAction: mergedAction,
            ports: Array.from(new Set([...(existing.ports || []), ...(connection.ports || [])])),
            flowPackets: Number(existing.flowPackets || 0) + Number(connection.flowPackets || 0),
            flowBytes: Number(existing.flowBytes || 0) + Number(connection.flowBytes || 0),
            flowLastSeen: connection.flowLastSeen || existing.flowLastSeen
          })
        }

        return Array.from(byEdge.values())
      })()
    : flowModeConnections

  const baseVisibleConnections = flowOnlyMode
    ? (() => {
        const edgeMap = new Map<string, NetworkConnection>()

        for (const connection of aggregatedFlowConnections) {
          edgeMap.set(`${connection.source}->${connection.target}`, connection)
        }

        const contextualConnectionTypes = new Set([
          'pod-connects-service',
          'service-selects-pod',
          'service-to-pod'
        ])

        const contextualNodeIds = new Set<string>()
        for (const connection of aggregatedFlowConnections) {
          contextualNodeIds.add(connection.source)
          contextualNodeIds.add(connection.target)
        }
        for (const nodeId of flowExternalLinkedNodeIds) {
          contextualNodeIds.add(nodeId)
        }

        for (let depth = 0; depth < 2; depth += 1) {
          for (const connection of data.connections) {
            if (!contextualConnectionTypes.has(connection.type)) {
              continue
            }

            if (connection.source.startsWith('external-') || connection.target.startsWith('external-')) {
              continue
            }

            if (!knownNodeIds.has(connection.source) || !knownNodeIds.has(connection.target)) {
              continue
            }

            if (contextualNodeIds.has(connection.source) || contextualNodeIds.has(connection.target)) {
              contextualNodeIds.add(connection.source)
              contextualNodeIds.add(connection.target)
            }
          }
        }

        for (const connection of data.connections) {
          if (!contextualConnectionTypes.has(connection.type)) {
            continue
          }

          if (connection.source.startsWith('external-') || connection.target.startsWith('external-')) {
            continue
          }

          if (!contextualNodeIds.has(connection.source) || !contextualNodeIds.has(connection.target)) {
            continue
          }

          const key = `${connection.source}->${connection.target}`
          if (!edgeMap.has(key)) {
            edgeMap.set(key, connection)
          }
        }

        return Array.from(edgeMap.values())
      })()
    : data.connections

  const nodeNamespaceById = new Map<string, string>([
    ...data.pods.map((pod) => [pod.id, pod.namespace]),
    ...data.services.map((service) => [service.id, service.namespace]),
    ...(data.ingresses || []).map((ingress) => [ingress.id, ingress.namespace])
  ])

  const sanitizeNamespaceId = (value: string) => value.replace(/[^a-zA-Z0-9-]/g, '-')
  const toNamespaceNodeId = (value: string) => `namespace-node-${sanitizeNamespaceId(value)}`

  const namespaceCollapsed = flowOnlyMode && Boolean(namespace)
    ? (() => {
        const edgeMap = new Map<string, NetworkConnection>()
        const namespaceAnchors = new Map<string, Set<string>>()

        const addEdge = (connection: NetworkConnection) => {
          const key = `${connection.source}->${connection.target}`
          const existing = edgeMap.get(key)
          if (!existing) {
            edgeMap.set(key, {
              ...connection,
              id: key,
              ports: Array.from(new Set(connection.ports || [])),
              flowPackets: Number(connection.flowPackets || 0),
              flowBytes: Number(connection.flowBytes || 0)
            })
            return
          }

          const mergedAction =
            existing.flowAction === 'Drop' || connection.flowAction === 'Drop'
              ? 'Drop'
              : existing.flowAction === 'Reject' || connection.flowAction === 'Reject'
                ? 'Reject'
                : existing.flowAction === 'Allow' || connection.flowAction === 'Allow'
                  ? 'Allow'
                  : 'Unknown'

          edgeMap.set(key, {
            ...existing,
            flowAction: mergedAction,
            ports: Array.from(new Set([...(existing.ports || []), ...(connection.ports || [])])),
            flowPackets: Number(existing.flowPackets || 0) + Number(connection.flowPackets || 0),
            flowBytes: Number(existing.flowBytes || 0) + Number(connection.flowBytes || 0),
            flowLastSeen: connection.flowLastSeen || existing.flowLastSeen
          })
        }

        for (const connection of baseVisibleConnections) {
          const sourceNamespace = nodeNamespaceById.get(connection.source)
          const targetNamespace = nodeNamespaceById.get(connection.target)

          if (!sourceNamespace || !targetNamespace) {
            addEdge(connection)
            continue
          }

          const sourceIsSelectedNamespace = sourceNamespace === namespace
          const targetIsSelectedNamespace = targetNamespace === namespace

          if (!sourceIsSelectedNamespace && !targetIsSelectedNamespace) {
            continue
          }

          let remappedSource = connection.source
          let remappedTarget = connection.target

          if (!sourceIsSelectedNamespace) {
            remappedSource = toNamespaceNodeId(sourceNamespace)
            if (!namespaceAnchors.has(sourceNamespace)) {
              namespaceAnchors.set(sourceNamespace, new Set())
            }
            namespaceAnchors.get(sourceNamespace)?.add(connection.target)
          }

          if (!targetIsSelectedNamespace) {
            remappedTarget = toNamespaceNodeId(targetNamespace)
            if (!namespaceAnchors.has(targetNamespace)) {
              namespaceAnchors.set(targetNamespace, new Set())
            }
            namespaceAnchors.get(targetNamespace)?.add(connection.source)
          }

          if (remappedSource === remappedTarget) {
            continue
          }

          addEdge({
            ...connection,
            source: remappedSource,
            target: remappedTarget
          })
        }

        return {
          connections: Array.from(edgeMap.values()),
          namespaceAnchors
        }
      })()
    : {
        connections: baseVisibleConnections,
        namespaceAnchors: new Map<string, Set<string>>()
      }

  const visibleConnections = namespaceCollapsed.connections

  const visibleNodeIds = new Set<string>()
  visibleConnections.forEach((connection) => {
    visibleNodeIds.add(connection.source)
    visibleNodeIds.add(connection.target)
  })
  for (const nodeId of flowExternalLinkedNodeIds) {
    visibleNodeIds.add(nodeId)
  }

  const visiblePods = flowOnlyMode
    ? data.pods.filter((pod) => visibleNodeIds.has(pod.id))
    : data.pods

  const visibleServices = flowOnlyMode
    ? data.services.filter((service) => visibleNodeIds.has(service.id))
    : data.services

  const namespaceNodes: NetworkNode[] = flowOnlyMode && namespace
    ? Array.from(namespaceCollapsed.namespaceAnchors.entries()).map(([namespaceName, anchorIds], index) => {
        const anchors = Array.from(anchorIds)
          .map((anchorId) => [
            ...data.pods,
            ...data.services,
            ...(data.ingresses || [])
          ].find((node) => node.id === anchorId))
          .filter((node): node is NetworkNode => Boolean(node))

        const averageX = anchors.length > 0
          ? anchors.reduce((sum, node) => sum + node.x, 0) / anchors.length
          : 600
        const averageY = anchors.length > 0
          ? anchors.reduce((sum, node) => sum + node.y, 0) / anchors.length
          : 300

        const direction = index % 2 === 0 ? -1 : 1

        return {
          id: toNamespaceNodeId(namespaceName),
          name: namespaceName,
          type: 'service',
          namespace: namespaceName,
          x: Math.max(80, Math.min(1120, averageX + direction * 220)),
          y: Math.max(80, Math.min(700, averageY - 40 + Math.floor(index / 2) * 40)),
          labels: { source: 'namespace-aggregate' },
          serviceType: 'Namespace'
        }
      })
    : []

  const visibleServicesWithNamespace = flowOnlyMode
    ? [...visibleServices, ...namespaceNodes]
    : visibleServices

  const visibleIngresses = flowOnlyMode
    ? (data.ingresses || []).filter((ingress) => visibleNodeIds.has(ingress.id))
    : (data.ingresses || [])

  const connectionLabelPositions = (() => {
    const nodeById = new Map<string, NetworkNode>([
      ...visiblePods.map((node) => [node.id, node]),
      ...visibleServicesWithNamespace.map((node) => [node.id, node]),
      ...visibleIngresses.map((node) => [node.id, node])
    ])

    const positions = new Map<string, { x: number; y: number }>()
    const placed: Array<{ x: number; y: number }> = []
    const minDistance = 26

    for (const connection of visibleConnections) {
      const sourceNode = nodeById.get(connection.source)
      const targetNode = nodeById.get(connection.target)
      if (!sourceNode || !targetNode) {
        continue
      }

      const baseX = (sourceNode.x + targetNode.x) / 2
      const baseY = (sourceNode.y + targetNode.y) / 2 - 10

      let x = baseX
      let y = baseY
      let attempts = 0

      while (attempts < 14) {
        const overlapping = placed.some((label) => {
          const dx = label.x - x
          const dy = label.y - y
          return Math.sqrt(dx * dx + dy * dy) < minDistance
        })

        if (!overlapping) {
          break
        }

        attempts += 1
        const horizontalJitter = attempts % 2 === 0 ? 12 : -12
        x = baseX + horizontalJitter
        y = baseY - attempts * 12
      }

      positions.set(connection.id, { x, y })
      placed.push({ x, y })
    }

    return positions
  })()

  const getNodeColor = (node: NetworkNode) => {
    if (node.type === 'service') {
      switch (node.serviceType) {
        case 'LoadBalancer': return '#8b5cf6'
        case 'NodePort': return '#3b82f6' 
        case 'ClusterIP': return '#06b6d4'
        case 'Namespace': return '#f59e0b'
        default: return '#06b6d4'
      }
    } else {
      switch (node.phase) {
        case 'Running': return '#10b981'
        case 'Pending': return '#f59e0b'
        default: return '#ef4444'
      }
    }
  }

  const getConnectionColor = (connection: NetworkConnection) => {
    if (connection.flowAction === 'Drop') return '#dc2626'
    if (connection.flowAction === 'Reject') return '#f59e0b'
    if (connection.flowAction === 'Allow') return '#16a34a'

    switch (connection.type) {
      case 'pod-to-pod': return '#ef4444'
      case 'pod-connects-service': return '#ec4899'
      case 'service-selects-pod': return '#10b981'
      case 'service-to-pod': return '#3b82f6'
      default: return '#6b7280'
    }
  }

  const getAntreaFlowStatusUi = () => {
    switch (antreaFlowStatus) {
      case 'active':
        return { label: 'Antrea Flow: Active', className: 'bg-green-100 text-green-800 border-green-300' }
      case 'configured':
        return { label: 'Antrea Flow: Configured (no data)', className: 'bg-amber-100 text-amber-800 border-amber-300' }
      case 'error':
        return { label: 'Antrea Flow: Error', className: 'bg-red-100 text-red-800 border-red-300' }
      default:
        return { label: 'Antrea Flow: Not configured', className: 'bg-gray-100 text-gray-700 border-gray-300' }
    }
  }

  const antreaFlowStatusUi = getAntreaFlowStatusUi()

  return (
    <>
      <div id="network-description" className="sr-only">
        Interactive network topology visualization showing Kubernetes pods and services. 
        Use keyboard shortcuts: R to refresh, F to fit to screen, Space to toggle connections, 
        P to toggle pods, S to toggle services, I to toggle ingresses, + and - to zoom, 1 to reset view.
        You can also drag nodes to reposition them.
      </div>
      
      <Card className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      {/* Zoom Controls */}
            {/* Zoom Controls */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
        <div className="bg-white/90 backdrop-blur rounded-xl shadow-lg p-2 flex gap-1 border border-gray-200">
          <button
            onClick={handleZoomIn}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4 text-gray-600" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4 text-gray-600" />
          </button>
          <button
            onClick={handleResetView}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Reset View"
          >
            <RotateCcw className="h-4 w-4 text-gray-600" />
          </button>
          <button
            onClick={handleFitToScreen}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Fit to Screen"
          >
            <Box className="h-4 w-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* View Controls */}
      <div className="absolute top-4 right-4 z-20">
        <div className="bg-white/90 backdrop-blur rounded-xl shadow-lg p-4 space-y-3 border border-gray-200">
          <h4 className="font-semibold text-sm text-gray-700">Show</h4>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPods}
                onChange={(e) => setShowPods(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Box className="h-4 w-4 text-green-600" />
              <span className="text-sm text-gray-700">Pods ({visiblePods.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showServices}
                onChange={(e) => setShowServices(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Network className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-gray-700">Services ({visibleServicesWithNamespace.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showIngresses}
                onChange={(e) => setShowIngresses(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Shield className="h-4 w-4 text-purple-600" />
              <span className="text-sm text-gray-700">Ingresses ({visibleIngresses.length})</span>
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showConnections}
                  onChange={(e) => setShowConnections(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Connections ({visibleConnections.length})</span>
              </label>
              {showConnections && (
                <div className="ml-6 space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="connectionFilter"
                      value="important"
                      checked={connectionFilter === 'important'}
                      onChange={(e) => setConnectionFilter(e.target.value)}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-600">Key connections only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="connectionFilter"
                      value="all"
                      checked={connectionFilter === 'all'}
                      onChange={(e) => setConnectionFilter(e.target.value)}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-600">All connections</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 z-20">
        <div className="bg-white/90 backdrop-blur rounded-xl shadow-lg p-4 max-w-xs border border-gray-200">
          <h4 className="font-semibold text-sm flex items-center gap-2 text-gray-700 mb-3">
            <Network className="h-4 w-4" />
            Namespace Network Topology
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${antreaFlowStatusUi.className}`}>
              {antreaFlowStatusUi.label}
            </span>
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-2 bg-red-500 rounded-full"></div>
              <span className="text-gray-600">Pod ↔ Pod</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-2 bg-pink-500 rounded-full"></div>
              <span className="text-gray-600">Pod → Service</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-2 bg-green-500 rounded-full"></div>
              <span className="text-gray-600">Service → Pod</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-2 bg-blue-500 rounded-full"></div>
              <span className="text-gray-600">Service Connection</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-2 bg-green-600 rounded-full"></div>
              <span className="text-gray-600">Antrea Allow</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-2 bg-red-600 rounded-full"></div>
              <span className="text-gray-600">Antrea Drop</span>
            </div>
          </div>
          <div className="pt-3 border-t mt-3 text-xs text-gray-500 space-y-1">
            <p>💡 Drag nodes to move them</p>
            <p>🔍 Scroll to zoom in/out</p>
            <p>✋ Click & drag to pan view</p>
          </div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div
        ref={containerRef}
        className="w-full h-[700px] cursor-grab active:cursor-grabbing select-none"
        style={{ cursor: draggedNode ? 'grabbing' : 'grab' }}
        onMouseDown={handlePanStart}
        onWheel={handleWheel}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="absolute inset-0"
          viewBox="0 0 1200 800"
          role="img"
          aria-label={`Network topology for ${namespace || 'cluster'} namespace showing ${visiblePods.length || 0} pods and ${visibleServicesWithNamespace.length || 0} services`}
          aria-describedby="network-description"
        >
          <defs>
            {/* Arrow markers for different connection types */}
            <marker
              id="arrow-red"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#ef4444" />
            </marker>
            <marker
              id="arrow-pink"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#ec4899" />
            </marker>
            <marker
              id="arrow-green"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#10b981" />
            </marker>
            <marker
              id="arrow-blue"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
            </marker>
            
            {/* Drop shadow filter */}
            <filter id="drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="2" dy="2" stdDeviation="3" floodOpacity="0.2"/>
            </filter>
          </defs>
          
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Grid background */}
            <defs>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#f1f5f9" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="1200" height="800" fill="url(#grid)" />
            
            {/* Connections */}
            {showConnections && visibleConnections
              .filter(connection => {
                if (connectionFilter === 'important') {
                  // Only show the most important connection types
                  return connection.type === 'pod-connects-service' || 
                         connection.type === 'service-selects-pod' ||
                         (connection.type === 'pod-to-pod' && connection.ports.includes(5432))
                }
                return true // Show all if filter is 'all'
              })
              .map((connection) => {
              const sourceNode = [...visiblePods, ...visibleServicesWithNamespace].find(n => n.id === connection.source)
              const targetNode = [...visiblePods, ...visibleServicesWithNamespace].find(n => n.id === connection.target)
              
              if (!sourceNode || !targetNode) return null
              
              const connectionColor = getConnectionColor(connection)
              const markerType = connection.flowAction === 'Drop' ? 'arrow-red' :
                                connection.flowAction === 'Reject' ? 'arrow-pink' :
                                connection.flowAction === 'Allow' ? 'arrow-green' :
                                connection.type === 'pod-to-pod' ? 'arrow-red' : 
                                connection.type === 'pod-connects-service' ? 'arrow-pink' :
                                connection.type === 'service-selects-pod' ? 'arrow-green' : 'arrow-blue'
              const strokeWidth = connection.flowPackets && connection.flowPackets > 0
                ? Math.min(6, 2 + Math.log10(connection.flowPackets + 1))
                : 2.5
              
              // Smart connection routing to prevent crossings
              const dx = targetNode.x - sourceNode.x
              const dy = targetNode.y - sourceNode.y
              const distance = Math.sqrt(dx * dx + dy * dy)
              
              // Offset start and end points to node edges
              const sourceRadius = sourceNode.type === 'service' ? 40 : 35
              const targetRadius = targetNode.type === 'service' ? 40 : 35
              
              const offsetX = (dx / distance) * sourceRadius
              const offsetY = (dy / distance) * sourceRadius
              const targetOffsetX = (dx / distance) * targetRadius
              const targetOffsetY = (dy / distance) * targetRadius
              
              const x1 = sourceNode.x + offsetX
              const y1 = sourceNode.y + offsetY
              const x2 = targetNode.x - targetOffsetX
              const y2 = targetNode.y - targetOffsetY
              
              // Simple straight line connections
              const midX = (x1 + x2) / 2
              const midY = (y1 + y2) / 2
              const displayPorts = Array.from(new Set((connection.ports || [])
                .map((port) => Number(port))
                .filter((port) => Number.isFinite(port) && port > 0 && port <= 65535)
                .map((port) => Math.trunc(port))))
              const portLabel = displayPorts.slice(0, 3).join(',')
              const actionLabel = connection.flowAction && connection.flowAction !== 'Unknown'
                ? `${connection.flowAction} `
                : ''
              const shouldShowFlowLabel = connection.type !== 'pod-to-pod'
              const flowLabel = shouldShowFlowLabel && portLabel ? `${actionLabel}${portLabel}` : ''
              const labelPosition = connectionLabelPositions.get(connection.id)
              
              return (
                <g key={connection.id}>
                  {/* Straight line connection */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={connectionColor}
                    strokeWidth={strokeWidth}
                    opacity={0.8}
                    markerEnd={`url(#${markerType})`}
                    className="transition-opacity hover:opacity-100"
                  />
                  
                  {/* Port label */}
                  {flowLabel && (
                    <text
                      x={labelPosition?.x ?? midX}
                      y={labelPosition?.y ?? (midY - 10)}
                      textAnchor="middle"
                      className="text-xs font-medium"
                      fill="#6b7280"
                      fontSize="10"
                      stroke="#ffffff"
                      strokeWidth="2.5"
                      paintOrder="stroke"
                    >
                      {flowLabel}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Ingresses */}
            {showIngresses && visibleIngresses.map((ingress) => (
              <g
                key={ingress.id}
                className="cursor-move hover:scale-105 transition-transform"
                onMouseDown={(e) => handleMouseDown(e, ingress)}
                style={{ transformOrigin: `${ingress.x}px ${ingress.y}px` }}
              >
                {/* Ingress diamond/rhombus shape */}
                <polygon
                  points={`${ingress.x},${ingress.y-25} ${ingress.x+35},${ingress.y} ${ingress.x},${ingress.y+25} ${ingress.x-35},${ingress.y}`}
                  fill="#8b5cf6"
                  stroke="#7c3aed"
                  strokeWidth={3}
                  className="drop-shadow-md"
                />
                
                {/* Ingress icon */}
                <text
                  x={ingress.x}
                  y={ingress.y + 3}
                  textAnchor="middle"
                  className="text-sm font-bold fill-white pointer-events-none"
                  fontSize="11"
                >
                  🌐
                </text>
                
                {/* Ingress name */}
                <text
                  x={ingress.x}
                  y={ingress.y + 45}
                  textAnchor="middle"
                  className="text-sm font-semibold fill-gray-700 pointer-events-none"
                  fontSize="13"
                >
                  {ingress.name}
                </text>
                
                {/* Ingress class indicator */}
                {ingress.ingressClass && (
                  <text
                    x={ingress.x}
                    y={ingress.y + 60}
                    textAnchor="middle"
                    className="text-xs fill-purple-600 pointer-events-none"
                    fontSize="10"
                  >
                    {ingress.ingressClass}
                  </text>
                )}
                
                {/* Host indicators */}
                {ingress.hosts && ingress.hosts.length > 0 && (
                  <text
                    x={ingress.x}
                    y={ingress.y - 35}
                    textAnchor="middle"
                    className="text-xs fill-purple-700 pointer-events-none"
                    fontSize="9"
                  >
                    {ingress.hosts[0]}{ingress.hosts.length > 1 ? ` +${ingress.hosts.length - 1}` : ''}
                  </text>
                )}
              </g>
            ))}

            {/* Services */}
            {showServices && visibleServicesWithNamespace.map((service) => (
              <g
                key={service.id}
                className="cursor-move hover:scale-105 transition-transform"
                onMouseDown={(e) => handleMouseDown(e, service)}
                style={{ transformOrigin: `${service.x}px ${service.y}px` }}
              >
                {/* Service circle */}
                <circle
                  cx={service.x}
                  cy={service.y}
                  r={40}
                  fill={getNodeColor(service)}
                  stroke="white"
                  strokeWidth={3}
                  filter="url(#drop-shadow)"
                  className="transition-colors"
                />
                
                {/* Service icon */}
                <text
                  x={service.x}
                  y={service.y + 5}
                  textAnchor="middle"
                  className="text-sm font-bold fill-white pointer-events-none"
                  fontSize="12"
                >
                  {service.serviceType === 'Namespace' ? 'NS' : 'SVC'}
                </text>
                
                {/* Service name */}
                <text
                  x={service.x}
                  y={service.y + 60}
                  textAnchor="middle"
                  className="text-sm font-semibold fill-gray-700 pointer-events-none"
                  fontSize="13"
                >
                  {service.name}
                </text>
                
                {/* Service type badge */}
                <text
                  x={service.x}
                  y={service.y + 75}
                  textAnchor="middle"
                  className="text-xs fill-gray-500 pointer-events-none"
                  fontSize="10"
                >
                  {service.serviceType}
                </text>
              </g>
            ))}

            {/* Pods */}
            {showPods && visiblePods.map((pod) => (
              <g
                key={pod.id}
                className="cursor-move hover:scale-105 transition-transform"
                onMouseDown={(e) => handleMouseDown(e, pod)}
                style={{ transformOrigin: `${pod.x}px ${pod.y}px` }}
              >
                {/* Pod rectangle */}
                <rect
                  x={pod.x - 35}
                  y={pod.y - 20}
                  width={70}
                  height={40}
                  rx={10}
                  fill={getNodeColor(pod)}
                  stroke="white"
                  strokeWidth={3}
                  filter="url(#drop-shadow)"
                  className="transition-colors"
                />
                
                {/* Pod icon */}
                <text
                  x={pod.x}
                  y={pod.y + 4}
                  textAnchor="middle"
                  className="text-sm font-bold fill-white pointer-events-none"
                  fontSize="11"
                >
                  POD
                </text>
                
                {/* Pod name */}
                <text
                  x={pod.x}
                  y={pod.y + 50}
                  textAnchor="middle"
                  className="text-sm font-semibold fill-gray-700 pointer-events-none"
                  fontSize="13"
                >
                  {pod.name}
                </text>
                
                {/* Pod status indicator */}
                <circle
                  cx={pod.x + 25}
                  cy={pod.y - 15}
                  r={5}
                  fill={pod.phase === 'Running' ? '#10b981' : pod.phase === 'Pending' ? '#f59e0b' : '#ef4444'}
                  stroke="white"
                  strokeWidth={2}
                />
              </g>
            ))}
          </g>
        </svg>
      </div>

      {/* Mini-map for large topologies */}
      {data && (visiblePods.length + visibleServicesWithNamespace.length + visibleIngresses.length) > 20 && (
        <div className="absolute top-4 right-4 z-20">
          <div className="w-32 h-24 bg-white/95 backdrop-blur border border-gray-300 rounded-lg shadow-lg p-2">
            <div className="text-xs text-gray-500 mb-1">Overview</div>
            <svg width="120" height="60" className="border border-gray-200 rounded">
              {/* Mini services */}
              {showServices && visibleServicesWithNamespace.map((service) => (
                <circle
                  key={`mini-service-${service.id}`}
                  cx={(service.x / 12)}
                  cy={(service.y / 12)}
                  r="2"
                  fill="#3b82f6"
                  opacity={0.7}
                />
              ))}
              
              {/* Mini ingresses */}
              {showIngresses && visibleIngresses.map((ingress) => (
                <polygon
                  key={`mini-ingress-${ingress.id}`}
                  points={`${ingress.x / 12},${(ingress.y / 12) - 2} ${(ingress.x / 12) + 2},${ingress.y / 12} ${ingress.x / 12},${(ingress.y / 12) + 2} ${(ingress.x / 12) - 2},${ingress.y / 12}`}
                  fill="#8b5cf6"
                  opacity={0.7}
                />
              ))}

              {/* Mini pods */}
              {showPods && visiblePods.map((pod) => (
                <rect
                  key={`mini-pod-${pod.id}`}
                  x={(pod.x / 12) - 2}
                  y={(pod.y / 12) - 1}
                  width="4"
                  height="2"
                  fill="#10b981"
                  opacity={0.7}
                />
              ))}
              
              {/* Viewport indicator */}
              <rect
                x={Math.max(0, -pan.x / (12 * zoom))}
                y={Math.max(0, -pan.y / (12 * zoom))}
                width={Math.min(120, 120 / zoom)}
                height={Math.min(60, 60 / zoom)}
                fill="none"
                stroke="#ef4444"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Enhanced Status Bar with Performance Metrics */}
      <div className="absolute bottom-4 left-4 z-20">
        <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg px-3 py-2 text-sm text-gray-600 border border-gray-200">
          <div className="flex items-center gap-4 mb-1">
            <span className="flex items-center gap-1">
              <Target className="w-3 h-3" />
              Zoom: {Math.round(zoom * 100)}%
            </span>
            <span className="flex items-center gap-1">
              <Network className="w-3 h-3" />
              Nodes: {(showPods ? visiblePods.length : 0) + (showServices ? visibleServicesWithNamespace.length : 0) + (showIngresses ? visibleIngresses.length : 0)}
            </span>
            <span className="flex items-center gap-1">
              <Box className="w-3 h-3" />
              Connections: {showConnections ? 
                (connectionFilter === 'important' ? 
                  data.connections.filter(c => 
                    c.type === 'pod-connects-service' || 
                    c.type === 'service-selects-pod' ||
                    (c.type === 'pod-to-pod' && c.ports.includes(5432))
                  ).length : 
                  data.connections.length
                ) : 0}
            </span>
            {isOptimizing && (
              <span className="flex items-center gap-1 text-blue-600">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Optimizing...
              </span>
            )}
          </div>
          
          {/* Performance metrics */}
          {layoutStats.lastOptimized && (
            <div className="flex items-center gap-4 text-xs text-gray-500 border-t border-gray-200 pt-1">
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {layoutStats.optimizationTime}ms
              </span>
              <span>Iterations: {layoutStats.iterationsUsed}</span>
              <span>Crossings fixed: {layoutStats.crossingsEliminated}</span>
              <span>Last: {layoutStats.lastOptimized.toLocaleTimeString()}</span>
            </div>
          )}
          
          {/* Keyboard shortcuts hint */}
          <div className="text-xs text-gray-400 mt-1 border-t border-gray-200 pt-1">
            Keys: R-refresh F-fit Space-connections P-pods S-services I-ingresses +-zoom 1-reset
          </div>
        </div>
      </div>
    </Card>
    </>
  )
})

export default NetworkVisualizationNew