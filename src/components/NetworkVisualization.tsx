'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { RefreshCw, Shield, ZoomIn, ZoomOut, Move, Network, Box, RotateCcw, Globe, Activity, Zap, Eye, EyeOff } from 'lucide-react'

interface NetworkNode {
  id: string
  name: string
  namespace: string
  type: 'pod' | 'service' | 'endpoint'
  x?: number
  y?: number
  fx?: number
  fy?: number
  [key: string]: any
}

interface NetworkConnection {
  id: string
  source: string
  target: string
  type: string
  protocol: string
  ports: number[]
}

interface NetworkTrafficData {
  namespace: string
  pods: NetworkNode[]
  services: NetworkNode[]
  endpoints: NetworkNode[]
  connections: NetworkConnection[]
  networkPolicies: any[]
  availableNamespaces: Array<{ name: string; status: string }>
  statistics: {
    totalPods: number
    totalServices: number
    totalConnections: number
    totalNetworkPolicies: number
    exposedServices: number
  }
}

interface NetworkVisualizationProps {
  clusterId: string
  selectedNamespace?: string
  onNamespaceChange?: (namespace: string) => void
}

export default function NetworkVisualization({ clusterId, selectedNamespace, onNamespaceChange }: NetworkVisualizationProps) {
  const [data, setData] = useState<NetworkTrafficData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [viewMode, setViewMode] = useState<'topology' | 'table'>('topology')
  const [showPods, setShowPods] = useState(true)
  const [showServices, setShowServices] = useState(true)
  const [showConnections, setShowConnections] = useState(true)
  const [showLegend, setShowLegend] = useState(true)
  const [tooltip, setTooltip] = useState<{visible: boolean, x: number, y: number, content: string} | null>(null)
  
  const fetchNetworkData = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const url = selectedNamespace 
        ? `/api/clusters/${clusterId}/network-traffic?namespace=${selectedNamespace}`
        : `/api/clusters/${clusterId}/network-traffic`
      
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to fetch network data')
      }
      
      const networkData = await response.json()
      setData(networkData)
    } catch (err) {
      console.error('Failed to fetch network data:', err)
      setError('Failed to load network traffic data')
    } finally {
      setLoading(false)
    }
  }, [clusterId, selectedNamespace])

  useEffect(() => {
    fetchNetworkData()
  }, [fetchNetworkData])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchNetworkData()
    }, 30000)

    return () => clearInterval(interval)
  }, [fetchNetworkData])

  // Smart auto-fitting layout with better spacing
  useEffect(() => {
    if (!data || !svgRef.current || viewMode !== 'topology') return

    const svg = svgRef.current
    
    // Use a small delay to ensure DOM is ready after refresh
    const layoutTimeout = setTimeout(() => {
      const rect = svg.getBoundingClientRect()
      const width = rect.width > 0 ? rect.width : 800
      const height = rect.height > 0 ? rect.height : 700

      // Combine all nodes
    const allNodes: NetworkNode[] = [
      ...data.pods.map(p => ({ ...p, nodeType: 'pod' })),
      ...data.services.map(s => ({ ...s, nodeType: 'service' }))
    ]

    if (allNodes.length === 0) return

    const services = allNodes.filter(n => n.type === 'service')
    const pods = allNodes.filter(n => n.type === 'pod')

    // Calculate safe spacing to prevent text overlap and avoid legend area
    const minNodeSpacingX = 180 // Horizontal spacing for text width
    const minNodeSpacingY = 80 // Vertical spacing for text height
    const marginX = 80
    const marginY = 80
    const legendReservedHeight = showLegend ? 120 : 40 // Reserve space for legend at bottom
    const effectiveHeight = height - legendReservedHeight
    
    // Services in left column with generous spacing
    const serviceColumnWidth = 250
    const maxServicesPerColumn = Math.floor((effectiveHeight - 2 * marginY) / minNodeSpacingY)
    const serviceColumns = Math.ceil(services.length / maxServicesPerColumn)
    
    services.forEach((service, index) => {
      const col = Math.floor(index / maxServicesPerColumn)
      const row = index % maxServicesPerColumn
      
      service.x = marginX + col * (serviceColumnWidth / serviceColumns) + (serviceColumnWidth / serviceColumns) / 2
      service.y = marginY + row * minNodeSpacingY + minNodeSpacingY / 2
    })

    // Pods in grid layout with safe spacing - avoid legend area
    const podAreaStartX = marginX + serviceColumnWidth + 60
    const podAreaWidth = width - podAreaStartX - marginX - (showLegend ? 200 : 50) // Reserve space for legend
    const podAreaHeight = effectiveHeight - 2 * marginY
    
    if (pods.length > 0) {
      // Calculate grid with guaranteed spacing
      const podCols = Math.max(1, Math.floor(podAreaWidth / minNodeSpacingX))
      const podRows = Math.ceil(pods.length / podCols)
      const actualSpacingX = Math.max(minNodeSpacingX, podAreaWidth / podCols)
      const actualSpacingY = Math.max(minNodeSpacingY, podAreaHeight / podRows)
      
      pods.forEach((pod, index) => {
        const col = index % podCols
        const row = Math.floor(index / podCols)
        
        pod.x = podAreaStartX + col * actualSpacingX + actualSpacingX / 2
        pod.y = marginY + row * actualSpacingY + actualSpacingY / 2
      })
    }

    // Fine-tune positioning to avoid overlaps
    const avoidOverlaps = (nodes: NetworkNode[], minDistance: number) => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const nodeA = nodes[i]
          const nodeB = nodes[j]
          const dx = (nodeB.x || 0) - (nodeA.x || 0)
          const dy = (nodeB.y || 0) - (nodeA.y || 0)
          const distance = Math.sqrt(dx * dx + dy * dy)
          
          if (distance < minDistance && distance > 0) {
            const overlap = minDistance - distance
            const moveDistance = overlap / 2
            const angle = Math.atan2(dy, dx)
            
            nodeA.x = (nodeA.x || 0) - Math.cos(angle) * moveDistance
            nodeA.y = (nodeA.y || 0) - Math.sin(angle) * moveDistance
            nodeB.x = (nodeB.x || 0) + Math.cos(angle) * moveDistance
            nodeB.y = (nodeB.y || 0) + Math.sin(angle) * moveDistance
          }
        }
      }
    }

    // Apply overlap avoidance
    avoidOverlaps(services, 90)
    avoidOverlaps(pods, 85)
    
    // Keep all nodes within bounds
    allNodes.forEach(node => {
      node.x = Math.max(50, Math.min(width - 50, node.x || 0))
      node.y = Math.max(50, Math.min(height - 50, node.y || 0))
    })

    // Update the nodes in data
    data.pods.forEach(pod => {
      const updated = allNodes.find(n => n.id === pod.id)
      if (updated) {
        pod.x = updated.x
        pod.y = updated.y
      }
    })
    
    data.services.forEach(service => {
      const updated = allNodes.find(n => n.id === service.id)
      if (updated) {
        service.x = updated.x
        service.y = updated.y
      }
    })
    
    setData({ ...data })
    }, 50) // Small delay to ensure DOM is ready

    return () => clearTimeout(layoutTimeout)
  }, [data, viewMode, showLegend])

  // Add resize observer to handle window resizing and ensure layout stability
  useEffect(() => {
    if (!svgRef.current || !data || viewMode !== 'topology') return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 100 && height > 100) {
          // Re-trigger layout calculation with new dimensions
          const layoutData = { ...data }
          setData(layoutData)
        }
      }
    })

    resizeObserver.observe(svgRef.current)
    return () => resizeObserver.disconnect()
  }, [data, viewMode])

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin mr-2" />
          <span>Loading network traffic data...</span>
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

  const getNodeColor = (node: NetworkNode) => {
    switch (node.type) {
      case 'pod': 
        if (node.phase === 'Running') return 'url(#podGradientRunning)'
        if (node.phase === 'Pending') return 'url(#podGradientPending)'
        return 'url(#podGradientError)'
      case 'service': 
        if (node.serviceType === 'LoadBalancer') return 'url(#serviceGradientLB)'
        if (node.serviceType === 'NodePort') return 'url(#serviceGradientNP)'
        return 'url(#serviceGradientCluster)'
      default: return '#6b7280'
    }
  }

  const getNodeIcon = (node: NetworkNode) => {
    switch (node.type) {
      case 'pod': 
        if (node.phase === 'Running') return '●'
        if (node.phase === 'Pending') return '◐'
        return '○'
      case 'service': 
        if (node.serviceType === 'LoadBalancer') return '◆'
        if (node.serviceType === 'NodePort') return '◇'
        return '▲'
      default: return '■'
    }
  }

  return (
    <div className="space-y-6">
      {/* Network Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="p-4 bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200">
          <div className="flex items-center">
            <div className="p-2 bg-blue-500 bg-opacity-20 rounded-lg">
              <Box className="h-5 w-5 text-blue-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-blue-600">Pods</p>
              <p className="text-lg font-bold text-blue-900">{data.statistics.totalPods}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
          <div className="flex items-center">
            <div className="p-2 bg-purple-500 bg-opacity-20 rounded-lg">
              <Globe className="h-5 w-5 text-purple-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-purple-600">Services</p>
              <p className="text-lg font-bold text-purple-900">{data.statistics.totalServices}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-r from-green-50 to-green-100 border-green-200">
          <div className="flex items-center">
            <div className="p-2 bg-green-500 bg-opacity-20 rounded-lg">
              <Activity className="h-5 w-5 text-green-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-green-600">Connections</p>
              <p className="text-lg font-bold text-green-900">{data.statistics.totalConnections}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
          <div className="flex items-center">
            <div className="p-2 bg-orange-500 bg-opacity-20 rounded-lg">
              <Shield className="h-5 w-5 text-orange-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-orange-600">Policies</p>
              <p className="text-lg font-bold text-orange-900">{data.statistics.totalNetworkPolicies}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-r from-red-50 to-red-100 border-red-200">
          <div className="flex items-center">
            <div className="p-2 bg-red-500 bg-opacity-20 rounded-lg">
              <Zap className="h-5 w-5 text-red-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-red-600">Exposed</p>
              <p className="text-lg font-bold text-red-900">{data.statistics.exposedServices}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Modern Controls */}
      <Card className="p-4 bg-gradient-to-r from-slate-800 to-slate-900 border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setViewMode(viewMode === 'topology' ? 'table' : 'topology')}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 border border-blue-500 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg"
            >
              {viewMode === 'topology' ? '📊 Table View' : '🌐 Network View'}
            </button>
            
            {viewMode === 'topology' && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setShowPods(!showPods)}
                  className={`flex items-center px-3 py-2 text-xs rounded-lg font-medium transition-all duration-200 ${
                    showPods 
                      ? 'bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg' 
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {showPods ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                  Pods
                </button>
                
                <button
                  onClick={() => setShowServices(!showServices)}
                  className={`flex items-center px-3 py-2 text-xs rounded-lg font-medium transition-all duration-200 ${
                    showServices 
                      ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg' 
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {showServices ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                  Services
                </button>
                
                <button
                  onClick={() => setShowConnections(!showConnections)}
                  className={`flex items-center px-3 py-2 text-xs rounded-lg font-medium transition-all duration-200 ${
                    showConnections 
                      ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-lg' 
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {showConnections ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                  Connections
                </button>
                
                <button
                  onClick={() => setShowLegend(!showLegend)}
                  className={`flex items-center px-3 py-2 text-xs rounded-lg font-medium transition-all duration-200 ${
                    showLegend 
                      ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg' 
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {showLegend ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                  Legend
                </button>
              </div>
            )}
          </div>

          <button
            onClick={fetchNetworkData}
            className="flex items-center px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-indigo-700 border border-indigo-500 rounded-lg hover:from-indigo-700 hover:to-indigo-800 transition-all duration-200 shadow-lg"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
        </div>
      </Card>

      {/* Network Visualization */}
      {viewMode === 'topology' ? (
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Network className="h-5 w-5 mr-2 text-blue-600" />
              Network Topology {selectedNamespace && `- ${selectedNamespace} Namespace`}
            </h3>
            {data && data.pods.length === 0 && data.services.length === 0 && (
              <p className="text-sm text-gray-600 mt-1">
                No pods or services found {selectedNamespace && `in namespace "${selectedNamespace}"`}
              </p>
            )}
          </div>
          
          <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 rounded-xl overflow-hidden border-2 border-indigo-500/30 shadow-2xl" style={{ height: '700px' }}>
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              className="absolute inset-0"
              viewBox="0 0 800 700"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Clean, minimal background */}
              <rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.98)" />

              {/* Render connections */}
              {showConnections && data.connections.map((connection, index) => {
                const sourceNode = [...data.pods, ...data.services].find(n => n.id === connection.source)
                const targetNode = [...data.pods, ...data.services].find(n => n.id === connection.target)
                
                if (!sourceNode || !targetNode) return null
                
                // Calculate arrow position (stop before node edge)
                const dx = (targetNode.x || 0) - (sourceNode.x || 0)
                const dy = (targetNode.y || 0) - (sourceNode.y || 0)
                const length = Math.sqrt(dx * dx + dy * dy)
                const unitX = dx / length
                const unitY = dy / length
                
                // Adjust endpoints to stop at node edges
                const sourceRadius = sourceNode.type === 'service' ? 22 : 20
                const targetRadius = targetNode.type === 'service' ? 22 : 20
                
                const x1 = (sourceNode.x || 0) + unitX * sourceRadius
                const y1 = (sourceNode.y || 0) + unitY * sourceRadius
                const x2 = (targetNode.x || 0) - unitX * targetRadius
                const y2 = (targetNode.y || 0) - unitY * targetRadius
                
                const isServiceToPod = connection.type === 'service-to-pod'
                const isServiceSelectsPod = connection.type === 'service-selects-pod'
                const isPodConnectsService = connection.type === 'pod-connects-service'
                const isPodToPod = connection.type === 'pod-to-pod' || (sourceNode.type === 'pod' && targetNode.type === 'pod')
                
                // Clean, high-contrast colors for better visibility
                const connectionColor = isPodToPod ? '#ff6b6b' : 
                                       isServiceToPod ? '#4dabf7' : 
                                       isServiceSelectsPod ? '#51cf66' : 
                                       isPodConnectsService ? '#ff8cc8' : '#a78bfa'
                const connectionWidth = isPodToPod ? 3 : isPodConnectsService ? 2 : isServiceToPod ? 2 : 2
                const glowColor = isPodToPod ? 'rgba(255, 107, 107, 0.4)' : 
                                 isServiceToPod ? 'rgba(77, 171, 247, 0.3)' : 
                                 isServiceSelectsPod ? 'rgba(81, 207, 102, 0.3)' : 
                                 isPodConnectsService ? 'rgba(255, 140, 200, 0.3)' : 'rgba(167, 139, 250, 0.3)'
                
                // Traffic type label with better distinction
                const trafficType = isPodToPod ? 'P2P' : 
                                   isServiceToPod ? 'SVC' : 
                                   isServiceSelectsPod ? 'SEL' : 
                                   isPodConnectsService ? 'APP' : 'NET'
                const portInfo = connection.ports.length > 0 ? `:${connection.ports[0]}` : ''
                
                return (
                  <g key={connection.id}>
                    {/* Subtle background line */}
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={glowColor}
                      strokeWidth="3"
                      strokeDasharray={connection.type === 'service-selects-pod' ? '8,4' : 'none'}
                      opacity="0.3"
                      filter="url(#glow)"
                    />
                    
                    {/* Main connection line with subtle styling */}
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={connectionColor}
                      strokeWidth={Math.max(connectionWidth - 1, 1)}
                      strokeDasharray={isPodToPod ? '6,3' : isServiceSelectsPod ? '8,4' : 'none'}
                      opacity={isPodToPod ? '0.7' : '0.6'}
                      markerEnd="url(#arrowheadSubtle)"
                    >
                      {isPodToPod && (
                        <animate
                          attributeName="opacity"
                          values="0.5;0.8;0.5"
                          dur="3s"
                          repeatCount="indefinite"
                        />
                      )}
                      {!isPodToPod && connection.type !== 'service-selects-pod' && (
                        <animate
                          attributeName="stroke-dashoffset"
                          values="0;12"
                          dur="1.5s"
                          repeatCount="indefinite"
                        />
                      )}
                    </line>
                    
                    {/* Subtle data flow particles */}
                    {!connection.type.includes('selects') && (
                      <>
                        <circle r={isPodToPod ? "2" : "1.5"} fill={connectionColor} opacity={isPodToPod ? "0.6" : "0.5"}>
                          <animateMotion
                            dur={isPodToPod ? "2s" : "2.5s"}
                            repeatCount="indefinite"
                            path={`M ${x1},${y1} L ${x2},${y2}`}
                          />
                        </circle>
                        <circle r={isPodToPod ? "1.5" : "1"} fill="#ffffff" opacity="0.4">
                          <animateMotion
                            dur={isPodToPod ? "2s" : "2.5s"}
                            begin="1s"
                            repeatCount="indefinite"
                            path={`M ${x1},${y1} L ${x2},${y2}`}
                          />
                        </circle>
                        {/* Extra particles for pod-to-pod to show bidirectional flow */}
                        {isPodToPod && (
                          <>
                            <circle r="2" fill="#fbbf24" opacity="0.8">
                              <animateMotion
                                dur="1.8s"
                                begin="1s"
                                repeatCount="indefinite"
                                path={`M ${x2},${y2} L ${x1},${y1}`}
                              />
                            </circle>
                            <circle r="1" fill="#ffffff" opacity="0.9">
                              <animateMotion
                                dur="1.8s"
                                begin="1.3s"
                                repeatCount="indefinite"
                                path={`M ${x2},${y2} L ${x1},${y1}`}
                              />
                            </circle>
                          </>
                        )}
                      </>
                    )}
                    
                    {/* Enhanced connection info background - bigger for P2P */}
                    <rect
                      x={(x1 + x2) / 2 - (isPodToPod ? 24 : 18)}
                      y={(y1 + y2) / 2 - 12}
                      width={isPodToPod ? "48" : "36"}
                      height="16"
                      rx="8"
                      fill={isPodToPod ? "rgba(245, 158, 11, 0.9)" : "rgba(0, 0, 0, 0.8)"}
                      stroke={connectionColor}
                      strokeWidth={isPodToPod ? "2" : "1"}
                      opacity="0.95"
                    >
                      {isPodToPod && (
                        <animate
                          attributeName="fill"
                          values="rgba(245, 158, 11, 0.9);rgba(251, 191, 36, 0.9);rgba(245, 158, 11, 0.9)"
                          dur="2s"
                          repeatCount="indefinite"
                        />
                      )}
                    </rect>
                    
                    {/* Enhanced connection type label */}
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 6}
                      textAnchor="middle"
                      className={`text-xs font-bold ${isPodToPod ? 'fill-black' : 'fill-white'}`}
                      style={{ textShadow: isPodToPod ? '0 0 2px rgba(255,255,255,0.8)' : '0 0 2px rgba(0,0,0,1)' }}
                    >
                      {trafficType}
                    </text>
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 + 3}
                      textAnchor="middle"
                      className="text-xs font-medium"
                      fill={connectionColor}
                      style={{ textShadow: '0 0 2px rgba(0,0,0,1)' }}
                    >
                      {portInfo || 'TCP'}
                    </text>
                  </g>
                )
              })}
              
              {/* Definitions for gradients, effects, and markers */}
              <defs>
                {/* Gradient definitions for nodes */}
                <radialGradient id="podGradientRunning" cx="30%" cy="30%">
                  <stop offset="0%" stopColor="#34d399" />
                  <stop offset="100%" stopColor="#059669" />
                </radialGradient>
                
                <radialGradient id="podGradientPending" cx="30%" cy="30%">
                  <stop offset="0%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#d97706" />
                </radialGradient>
                
                <radialGradient id="podGradientError" cx="30%" cy="30%">
                  <stop offset="0%" stopColor="#f87171" />
                  <stop offset="100%" stopColor="#dc2626" />
                </radialGradient>
                
                <radialGradient id="serviceGradientLB" cx="30%" cy="30%">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </radialGradient>
                
                <radialGradient id="serviceGradientNP" cx="30%" cy="30%">
                  <stop offset="0%" stopColor="#60a5fa" />
                  <stop offset="100%" stopColor="#2563eb" />
                </radialGradient>
                
                <radialGradient id="serviceGradientCluster" cx="30%" cy="30%">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#0ea5e9" />
                </radialGradient>
                
                {/* Connection gradients */}
                <linearGradient id="connectionGradient0" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
                
                <linearGradient id="connectionGradient1" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
                
                <linearGradient id="connectionGradient2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#a78bfa" />
                </linearGradient>
                
                {/* Glow filter */}
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                  <feMerge> 
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
                
                {/* Node shadow filter */}
                <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="2" dy="2" stdDeviation="3" floodOpacity="0.3"/>
                </filter>
                
                {/* Subtle arrow marker */}
                <marker
                  id="arrowheadSubtle"
                  markerWidth="8"
                  markerHeight="6"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 8 3, 0 6"
                    fill="currentColor"
                    opacity="0.6"
                  />
                </marker>
                
                {/* Glowing arrow marker (backup) */}
                <marker
                  id="arrowheadGlow"
                  markerWidth="12"
                  markerHeight="8"
                  refX="11"
                  refY="4"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 12 4, 0 8"
                    fill="url(#connectionGradient0)"
                    filter="url(#glow)"
                  />
                </marker>
              </defs>
              
              {/* Render services */}
              {showServices && data.services.map((service, index) => {
                const maxNameLength = 14
                const displayName = service.name.length > maxNameLength ? service.name.substring(0, maxNameLength) + '..' : service.name
                const serviceTypeShort = service.serviceType === 'LoadBalancer' ? 'LB' : 
                                       service.serviceType === 'ClusterIP' ? 'CIP' : 
                                       service.serviceType === 'NodePort' ? 'NP' : service.serviceType
                
                return (
                  <g key={service.id} className="cursor-pointer hover:opacity-90 transition-all duration-300">
                    {/* Service glow ring with distinct animation */}
                    <circle
                      cx={service.x || 0}
                      cy={service.y || 0}
                      r="32"
                      fill="none"
                      stroke={service.serviceType === 'LoadBalancer' ? 'rgba(147, 51, 234, 0.4)' : 
                              service.serviceType === 'NodePort' ? 'rgba(59, 130, 246, 0.4)' : 'rgba(16, 185, 129, 0.4)'}
                      strokeWidth="2"
                      opacity="0.6"
                    >
                      <animate
                        attributeName="r"
                        values="30;36;30"
                        dur="3s"
                        repeatCount="indefinite"
                      />
                    </circle>
                    
                    {/* Service circular background for clean look */}
                    <circle
                      cx={service.x || 0}
                      cy={service.y || 0}
                      r="35"
                      fill={service.serviceType === 'ClusterIP' ? 'transparent' : 'rgba(15, 23, 42, 0.95)'}
                      stroke={service.serviceType === 'LoadBalancer' ? 'rgba(147, 51, 234, 0.9)' : 
                              service.serviceType === 'NodePort' ? 'rgba(59, 130, 246, 0.9)' : 'rgba(59, 130, 246, 0.9)'}
                      strokeWidth="3"
                      filter="url(#shadow)"
                    />
                    
                    {/* Service name - clean and simple */}
                    <text
                      x={service.x || 0}
                      y={(service.y || 0) - 5}
                      textAnchor="middle"
                      className="text-sm font-semibold fill-white"
                      style={{ 
                        fontSize: '12px',
                        textShadow: '0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)'
                      }}
                    >
                      {displayName}
                    </text>
                    
                    {/* Service type - smaller and centered */}
                    <text
                      x={service.x || 0}
                      y={(service.y || 0) + 20}
                      textAnchor="middle"
                      className="text-xs font-bold fill-white"
                      style={{ 
                        fontSize: '9px',
                        opacity: '0.8'
                      }}
                    >
                      {serviceTypeShort}
                    </text>
                  </g>
                )
              })}
              
              {/* Render pods */}
              {showPods && data.pods.map((pod, index) => {
                const maxNameLength = 16
                const displayName = pod.name.length > maxNameLength ? pod.name.substring(0, maxNameLength) + '..' : pod.name
                const statusShort = pod.phase === 'Running' ? 'RUN' : 
                                  pod.phase === 'Pending' ? 'PND' : 
                                  pod.phase === 'Failed' ? 'ERR' : pod.phase.substring(0, 3)
                
                return (
                  <g key={pod.id} className="cursor-pointer hover:opacity-90 transition-all duration-300">
                    {/* Subtle pulse for running pods */}
                    {pod.phase === 'Running' && (
                      <circle
                        cx={pod.x || 0}
                        cy={pod.y || 0}
                        r="46"
                        fill="none"
                        stroke="rgba(16, 185, 129, 0.2)"
                        strokeWidth="1"
                        opacity="0.4"
                      >
                        <animate
                          attributeName="r"
                          values="44;48;44"
                          dur="3s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                    
                    {/* Pod rounded rectangle background - distinct from services */}
                    <rect
                      x={(pod.x || 0) - 45}
                      y={(pod.y || 0) - 22}
                      width="90"
                      height="44"
                      rx="12"
                      fill="rgba(15, 23, 42, 0.95)"
                      stroke={pod.phase === 'Running' ? 'rgba(16, 185, 129, 0.9)' : 
                              pod.phase === 'Pending' ? 'rgba(251, 191, 36, 0.9)' : 'rgba(248, 113, 113, 0.9)'}
                      strokeWidth="2"
                      strokeDasharray={pod.phase === 'Pending' ? '4,2' : 'none'}
                      filter="url(#shadow)"
                    />
                    
                    {/* Pod status indicator - circular for distinction from services */}
                    <circle
                      cx={(pod.x || 0) - 30}
                      cy={(pod.y || 0) - 12}
                      r="6"
                      fill={pod.phase === 'Running' ? '#10b981' : pod.phase === 'Pending' ? '#f59e0b' : '#ef4444'}
                      stroke="rgba(255, 255, 255, 0.8)"
                      strokeWidth="2"
                    >
                      {pod.phase === 'Running' && (
                        <animate
                          attributeName="opacity"
                          values="0.6;1;0.6"
                          dur="1.5s"
                          repeatCount="indefinite"
                        />
                      )}
                    </circle>
                    

                    
                    {/* Pod name - clean and simple */}
                    <text
                      x={pod.x || 0}
                      y={(pod.y || 0) + 4}
                      textAnchor="middle"
                      className="text-xs font-semibold fill-white"
                      style={{ 
                        fontSize: '11px',
                        textShadow: '0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)'
                      }}
                    >
                      {displayName}
                    </text>
                    
                    {/* Pod status - minimal indicator */}
                    <circle
                      cx={pod.x || 0}
                      cy={(pod.y || 0) + 18}
                      r="4"
                      fill={pod.phase === 'Running' ? '#10b981' : 
                            pod.phase === 'Pending' ? '#f59e0b' : '#ef4444'}
                      opacity="0.9"
                    />
                  </g>
                )
              })}
            </svg>
            
            {/* Modern Legend - Togglable and positioned to avoid overlaps */}
            {showLegend && (
            <div className="absolute bottom-4 right-4 bg-black/90 backdrop-blur-md p-3 rounded-xl shadow-2xl border border-cyan-500/30 z-50 max-w-xs">
              <h4 className="text-sm font-bold text-cyan-300 mb-2 flex items-center">
                <Network className="h-4 w-4 mr-2 text-cyan-400" />
                Network Map
              </h4>
              <div className="space-y-2 text-xs">
                {/* Node types */}
                                {/* Node types - Clean visual distinction */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-4 h-4 bg-gradient-to-br from-blue-400 to-blue-600 mr-2 rounded-full"></div>
                    <span className="font-medium text-blue-300 text-xs">Services</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-4 h-3 bg-gradient-to-br from-green-400 to-green-600 rounded mr-2"></div>
                    <span className="font-medium text-green-300 text-xs">Pods</span>
                  </div>
                </div>
                
                {/* Shape indicators */}
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Circular shapes</span>
                  <span>Rounded rectangles</span>
                </div>
                
                {/* Visual distinctions */}
                <div className="pt-1 border-t border-gray-600/50">
                  <div className="text-xs text-cyan-300 mb-1 font-semibold">Key Differences:</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-blue-300 font-medium">Services:</div>
                      <div className="text-gray-300">• Circular shape</div>
                      <div className="text-gray-300">• Color-coded</div>
                      <div className="text-gray-300">• Solid borders</div>
                    </div>
                    <div>
                      <div className="text-green-300 font-medium">Pods:</div>
                      <div className="text-gray-300">• Rounded rect</div>
                      <div className="text-gray-300">• Status-based</div>
                      <div className="text-gray-300">• Dashed borders</div>
                    </div>
                  </div>
                </div>
                
                {/* Traffic types - Enhanced for P2P visibility */}
                <div className="pt-1 border-t border-gray-600/50">
                  <div className="text-xs text-cyan-300 mb-1 font-semibold">Traffic Types:</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="w-3 h-1 bg-blue-500 mr-1 rounded"></div>
                        <span className="font-medium text-blue-300">SVC</span>
                      </div>
                      <span className="text-gray-400">Service→Pod</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="w-3 h-1 bg-red-400 mr-1 rounded"></div>
                        <span className="font-bold text-red-300">P2P</span>
                      </div>
                      <span className="text-red-200">Pod↔Pod</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="w-3 h-1 bg-pink-500 mr-1 rounded"></div>
                        <span className="font-medium text-pink-300">APP</span>
                      </div>
                      <span className="text-gray-400">Pod→Service</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="w-3 h-1 bg-green-500 mr-1 rounded border-dashed border border-green-400"></div>
                        <span className="font-medium text-green-300">SEL</span>
                      </div>
                      <span className="text-gray-400">Selection</span>
                    </div>
                  </div>
                </div>
                
                {data.statistics.totalNetworkPolicies > 0 && (
                  <div className="flex items-center pt-1">
                    <Shield className="h-4 w-4 text-red-400 mr-2" />
                    <span className="font-medium text-red-300 text-xs">Policies: {data.statistics.totalNetworkPolicies}</span>
                  </div>
                )}
              </div>
              
              {/* Live metrics */}
              <div className="mt-3 pt-2 border-t border-cyan-500/30">
                <div className="text-xs text-cyan-300 space-y-1">
                  <div className="flex justify-between">
                    <span>Connections:</span>
                    <span className="font-bold text-cyan-200">{data.statistics.totalConnections}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Running:</span>
                    <span className="font-bold text-green-300">{data.pods.filter(p => p.phase === 'Running').length}/{data.pods.length}</span>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>
        </Card>
      ) : (
        /* Table View */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pods Table */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Box className="h-5 w-5 mr-2 text-blue-600" />
              Pods ({data.pods.length})
            </h3>
            
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-gray-900">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Node</th>
                    <th className="px-3 py-2 text-left">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.pods.map((pod) => (
                    <tr key={pod.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{pod.name}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          pod.phase === 'Running' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {pod.phase}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{pod.nodeName || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{pod.podIP || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Services Table */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Globe className="h-5 w-5 mr-2 text-purple-600" />
              Services ({data.services.length})
            </h3>
            
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-gray-900">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Cluster IP</th>
                    <th className="px-3 py-2 text-left">Ports</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.services.map((service) => (
                    <tr key={service.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{service.name}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          service.serviceType === 'LoadBalancer' ? 'bg-purple-100 text-purple-800' : 
                          service.serviceType === 'NodePort' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {service.serviceType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{service.clusterIP || '-'}</td>
                      <td className="px-3 py-2 text-xs">
                        {service.ports?.length > 0 ? 
                          service.ports.map((p: any) => `${p.port}/${p.protocol || 'TCP'}`).join(', ') : 
                          '-'
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Network Policies */}
      {data.networkPolicies.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Shield className="h-5 w-5 mr-2 text-red-600" />
            Network Policies ({data.networkPolicies.length})
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.networkPolicies.map((policy) => (
              <div key={policy.id} className="bg-red-50 p-4 rounded-lg border border-red-200">
                <h4 className="font-medium text-red-900">{policy.name}</h4>
                <p className="text-sm text-red-700 mt-1">
                  Types: {policy.policyTypes.join(', ') || 'All'}
                </p>
                <div className="text-xs text-red-600 mt-2">
                  <div>Ingress Rules: {policy.ingress?.length || 0}</div>
                  <div>Egress Rules: {policy.egress?.length || 0}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}