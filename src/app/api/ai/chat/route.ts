import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { initializeDatabase, query } from '@/lib/database'
import { KubernetesClient } from '@/lib/kubernetes'
import https from 'https'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
}

interface OllamaResponse {
  model: string
  created_at: string
  response: string
  done: boolean
}

// Create a custom fetch function that ignores SSL errors for HTTPS Ollama servers
const createFetchWithSSLIgnore = () => {
  // Create HTTPS agent that ignores certificate errors
  const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // Ignore SSL certificate errors
  })

  return (url: string, options: RequestInit = {}) => {
    // If it's an HTTPS URL, add the custom agent
    if (url.startsWith('https://')) {
      return fetch(url, {
        ...options,
        // @ts-ignore - TypeScript doesn't know about the agent property in browser fetch
        agent: httpsAgent
      })
    }
    
    // For HTTP URLs, use regular fetch
    return fetch(url, options)
  }
}

const secureFetch = createFetchWithSSLIgnore()

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const token = request.cookies.get('auth-token')?.value
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await initializeDatabase()

    // Get Ollama settings
    const settingsResult = await query('SELECT key, value FROM settings WHERE key LIKE $1', ['ollama_%'])
    const settings = settingsResult.rows.reduce((acc: any, row: any) => {
      acc[row.key] = row.value
      return acc
    }, {})

    // Check if Ollama is enabled
    if (settings.ollama_enabled !== 'true') {
      return NextResponse.json(
        { error: 'AI chatbot is not enabled. Please enable it in settings.' },
        { status: 400 }
      )
    }

    const { message, clusterId, history = [] } = await request.json()

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    // If user is on dashboard (no clusterId) but asking about specific clusters, suggest going to cluster page
    if (!clusterId) {
      const clusterKeywords = [
        'cluster', 'node', 'pod', 'deployment', 'service', 'ingress', 'namespace',
        'pvc', 'persistent volume', 'storage', 'backup', 'velero', 'talos',
        'restart', 'scale', 'logs', 'events', 'errors', 'failing', 'down',
        'status', 'health', 'resources', 'cpu', 'memory', 'disk'
      ]
      
      const messageText = message.toLowerCase()
      const hasClusterKeywords = clusterKeywords.some(keyword => messageText.includes(keyword))
      
      // Additional patterns that suggest cluster-specific questions
      const clusterPatterns = [
        /my cluster/i,
        /the cluster/i,
        /this cluster/i,
        /cluster\s+\w+/i,
        /what.*happening/i,
        /why.*not working/i,
        /check.*status/i,
        /analyze.*cluster/i
      ]
      
      const hasClusterPattern = clusterPatterns.some(pattern => pattern.test(message))
      
      if (hasClusterKeywords || hasClusterPattern) {
        // Get list of available clusters to suggest
        const clustersResult = await query('SELECT id, name FROM clusters ORDER BY name')
        const clusters = clustersResult.rows
        
        let suggestion = settings.ai_cluster_redirect_prompt || "I see you're asking about cluster-specific information! For the best assistance with cluster details, please navigate to the specific cluster page where I'll have access to real-time data."
        
        if (clusters.length > 0) {
          suggestion += `\n\n**Available Clusters:**\n`
          
          clusters.forEach(cluster => {
            suggestion += `• **${cluster.name}** - Go to cluster details to get live status, logs, and specific troubleshooting\n`
          })
        } else {
          suggestion += `\n\nPlease add your cluster configurations first, then navigate to the cluster details page where I can access real-time cluster data and provide specific troubleshooting assistance.`
        }
        
        return NextResponse.json({
          response: suggestion,
          timestamp: new Date().toISOString()
        })
      }
    }

    // Get cluster context if clusterId is provided
    let clusterContext = ''
    if (clusterId) {
      try {
        const clusterResult = await query('SELECT name, endpoint, description FROM clusters WHERE id = $1', [clusterId])
        if (clusterResult.rows.length > 0) {
          const cluster = clusterResult.rows[0]
          clusterContext = `\n\nYou are helping with Kubernetes cluster "${cluster.name}" (endpoint: ${cluster.endpoint}).`
          
          // Get cluster information
          const clusterData = await query('SELECT kubeconfig, talosconfig FROM clusters WHERE id = $1 AND is_active = true', [clusterId])
          if (clusterData.rows.length > 0) {
            const clusterConfig = clusterData.rows[0]
            const k8sClient = new KubernetesClient(clusterConfig.kubeconfig, clusterConfig.talosconfig)
            try {
              // Get cluster health which includes node information
              const health = await k8sClient.getClusterHealth()
              
              clusterContext += `\n\nCluster Context:
- Cluster Status: ${health.status}
- Total Nodes: ${health.totalNodes || 0}
- Healthy Nodes: ${health.healthyNodes || 0}
- Total Pods: ${health.totalPods || 0}
- Total Namespaces: ${health.totalNamespaces || 0}`

              if (health.kubernetesVersion) {
                clusterContext += `\n- Kubernetes Version: ${health.kubernetesVersion}`
              }

              if (health.talosVersion) {
                clusterContext += `\n- Talos Version: ${health.talosVersion}`
              }

              if (health.cni) {
                clusterContext += `\n- CNI: ${health.cni}`
              }

              if (health.storageDrivers && health.storageDrivers.length > 0) {
                clusterContext += `\n- Storage: ${health.storageDrivers.join(', ')}`
              }

              if (health.ingressControllers && health.ingressControllers.length > 0) {
                clusterContext += `\n- Ingress: ${health.ingressControllers.join(', ')}`
              }

              if (health.nodes && health.nodes.length > 0) {
                const nodeInfo = health.nodes.slice(0, 3).map(node => {
                  const cpuPercent = node.cpuCapacity > 0 ? ((node.cpuUsage / node.cpuCapacity) * 100).toFixed(1) : 'N/A'
                  const memPercent = node.memoryCapacity > 0 ? ((node.memoryUsage / node.memoryCapacity) * 100).toFixed(1) : 'N/A'
                  return `${node.name}: CPU ${cpuPercent}%, Memory ${memPercent}% (${node.status})`
                })
                clusterContext += `\n- Node Status (first 3): ${nodeInfo.join(', ')}`
              }

              // Add recent backup information if available
              if (health.latestBackup) {
                clusterContext += `\n- Latest Backup: ${health.latestBackup.name} - ${health.latestBackup.phase}`
                if (health.latestBackup.errors > 0) {
                  clusterContext += ` (${health.latestBackup.errors} errors)`
                }
              }

            } catch (k8sError) {
              console.error('Error getting cluster context:', k8sError)
              clusterContext += '\n\n(Note: Unable to retrieve live cluster data at this time)'
            }
          }
        }
      } catch (error) {
        console.error('Error getting cluster info:', error)
      }
    }

    // Build conversation context using database prompts
    const basePrompt = settings.ai_system_prompt || 'You are a helpful Kubernetes expert assistant with deep knowledge of Kubernetes concepts, troubleshooting, and best practices.'
    
    const contextPrompt = clusterId 
      ? (settings.ai_cluster_context_prompt || 'You have access to live cluster data for specific troubleshooting.')
      : (settings.ai_dashboard_context_prompt || 'You are on the dashboard without specific cluster context.')

    const systemPrompt = `${basePrompt}

${contextPrompt}${clusterContext}`

    // Prepare conversation for Ollama
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10), // Limit history to last 10 messages
      { role: 'user', content: message }
    ]

    // Call Ollama API with SSL error handling
    const ollamaUrl = settings.ollama_server_url || 'http://localhost:11434'
    const ollamaResponse = await secureFetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.ollama_model || 'llama3.2',
        messages: conversation,
        stream: false,
        options: {
          temperature: parseFloat(settings.ollama_temperature || '0.7'),
          num_predict: parseInt(settings.ollama_max_tokens || '4096')
        }
      })
    })

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text()
      console.error('Ollama API error:', errorText)
      return NextResponse.json(
        { error: 'Failed to get AI response. Please check your Ollama configuration.' },
        { status: 500 }
      )
    }

    const aiResponse = await ollamaResponse.json()
    
    return NextResponse.json({
      success: true,
      response: aiResponse.message?.content || aiResponse.response || 'No response generated',
      model: settings.ollama_model,
      clusterId: clusterId || null
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Optional: GET endpoint to check AI status
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await initializeDatabase()

    const settingsResult = await query('SELECT key, value FROM settings WHERE key LIKE $1', ['ollama_%'])
    const settings = settingsResult.rows.reduce((acc: any, row: any) => {
      acc[row.key] = row.value
      return acc
    }, {})

    const isEnabled = settings.ollama_enabled === 'true'
    
    // Test Ollama connection if enabled
    let isConnected = false
    if (isEnabled) {
      try {
        const ollamaUrl = settings.ollama_server_url || 'http://localhost:11434'
        const testResponse = await secureFetch(`${ollamaUrl}/api/tags`, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        })
        isConnected = testResponse.ok
      } catch (error) {
        isConnected = false
      }
    }

    return NextResponse.json({
      enabled: isEnabled,
      connected: isConnected,
      model: settings.ollama_model || 'llama3.2',
      server_url: settings.ollama_server_url || 'http://localhost:11434'
    })

  } catch (error) {
    console.error('AI status check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}