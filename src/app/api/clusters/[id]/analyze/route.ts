import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/database'

interface ClusterData {
  clusterId: number
  clusterName: string
  status: string
  healthyNodes: number
  totalNodes: number
  nodes: Array<{
    name: string
    cpuUsage: number
    memoryUsage: number
    cpuCapacity: number
    memoryCapacity: number
    status: string
    isControlPlane: boolean
  }>
  totalPods?: number
  totalNamespaces?: number
  avgCpuPercent?: number
  avgMemoryPercent?: number
  kubernetesVersion?: string
  talosVersion?: string
  openebsStorage?: {
    totalCapacity: string
    totalUsed: string
    totalAvailable: string
    poolCount: number
  }
  latestBackup?: {
    name: string
    phase: string
    startTimestamp?: string
    completionTimestamp?: string
    errors: number
    warnings: number
  }
}

interface LlmSettings {
  llm_provider: string
  ollama_endpoint: string
  ollama_model: string
  lmstudio_endpoint: string
  lmstudio_model: string
}

async function callOllamaAPI(endpoint: string, model: string, prompt: string): Promise<string> {
  console.log(`Attempting Ollama API call to: ${endpoint}/api/generate with model: ${model}`)
  
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      prompt: `You are a Kubernetes expert specializing in cluster analysis, performance optimization, and operational best practices. Provide detailed, actionable insights for production environments.\n\n${prompt}`,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 2000
      }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`)
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  console.log('Ollama API response received:', data)
  return data.response || 'No response generated'
}

async function callLmStudioAPI(endpoint: string, model: string, prompt: string): Promise<string> {
  console.log(`Attempting LM Studio API call to: ${endpoint}/v1/chat/completions with model: ${model}`)
  
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'You are a Kubernetes expert specializing in cluster analysis, performance optimization, and operational best practices. Provide detailed, actionable insights for production environments.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`LM Studio API error: ${response.status} ${response.statusText} - ${errorText}`)
    throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  console.log('LM Studio API response received:', data)
  return data.choices?.[0]?.message?.content || 'No response generated'
}

function generateIntelligentAnalysis(clusterData: ClusterData): string {
  if (!clusterData || !clusterData.nodes || clusterData.nodes.length === 0) {
    return `# 🚨 Analysis Error
    
Unable to analyze cluster - invalid cluster data received.

Please ensure the cluster is properly configured and accessible.`
  }

  const healthScore = calculateHealthScore(clusterData)
  const performanceInsights = analyzePerformance(clusterData)
  const recommendations = generateRecommendations(clusterData)
  
  return `# 🤖 Intelligent Analysis (Live Data)

## 📊 Overall Health Assessment
**Health Score: ${healthScore}/10**

${getHealthDescription(healthScore)}

## 🔍 Cluster Overview
- **Name:** ${clusterData.clusterName}
- **Status:** ${clusterData.status}
- **Nodes:** ${clusterData.healthyNodes}/${clusterData.totalNodes} healthy
- **Kubernetes Version:** ${clusterData.kubernetesVersion || 'Unknown'}
- **Talos Version:** ${clusterData.talosVersion || 'Unknown'}

## 📈 Performance Analysis

### Resource Utilization
- **Average CPU:** ${clusterData.avgCpuPercent?.toFixed(1) || 'Unknown'}%
- **Average Memory:** ${clusterData.avgMemoryPercent?.toFixed(1) || 'Unknown'}%

### Node Status
${clusterData.nodes.map(node => {
  const cpuPercent = node.cpuCapacity > 0 ? (node.cpuUsage / node.cpuCapacity * 100) : 0
  const memoryPercent = node.memoryCapacity > 0 ? (node.memoryUsage / node.memoryCapacity * 100) : 0
  const memoryUsageGB = (node.memoryUsage / 1024 / 1024 / 1024)
  const memoryCapacityGB = (node.memoryCapacity / 1024 / 1024 / 1024)
  
  return `- **${node.name}** (${node.isControlPlane ? 'Control Plane' : 'Worker'})
  - Status: ${node.status} ${node.status === 'Ready' ? '✅' : '❌'}
  - CPU: ${cpuPercent.toFixed(1)}% (${node.cpuUsage}/${node.cpuCapacity} cores)
  - Memory: ${memoryPercent.toFixed(1)}% (${memoryUsageGB.toFixed(1)}GB/${memoryCapacityGB.toFixed(1)}GB)`
}).join('\n')}

${clusterData.openebsStorage ? `## 💾 Storage (OpenEBS)
- **Total Capacity:** ${clusterData.openebsStorage.totalCapacity}
- **Used:** ${clusterData.openebsStorage.totalUsed}
- **Available:** ${clusterData.openebsStorage.totalAvailable}
- **Storage Pools:** ${clusterData.openebsStorage.poolCount}` : ''}

${clusterData.latestBackup ? `## 💾 Backup Status
- **Latest Backup:** ${clusterData.latestBackup.name}
- **Status:** ${clusterData.latestBackup.phase} ${clusterData.latestBackup.phase === 'Completed' ? '✅' : clusterData.latestBackup.phase === 'Failed' ? '❌' : '⏳'}
- **Errors:** ${clusterData.latestBackup.errors}
- **Warnings:** ${clusterData.latestBackup.warnings}
- **Started:** ${clusterData.latestBackup.startTimestamp || 'Unknown'}
- **Completed:** ${clusterData.latestBackup.completionTimestamp || 'N/A'}` : '## 💾 Backup Status\n⚠️ No backup information available'}

## 🎯 Performance Insights
${performanceInsights.join('\n')}

## 💡 Recommendations
${recommendations.join('\n')}

## 🔧 Next Steps
1. Review critical issues identified above
2. Monitor resource usage trends
3. Plan capacity based on current utilization
4. Ensure backup strategy is properly configured
5. Consider implementing monitoring and alerting if not already in place

---
*Analysis generated using live cluster data on ${new Date().toLocaleString()}*`
}

function calculateHealthScore(clusterData: ClusterData): number {
  let score = 10
  
  // Node health
  const nodeHealthRatio = clusterData.healthyNodes / clusterData.totalNodes
  if (nodeHealthRatio < 1) {
    score -= (1 - nodeHealthRatio) * 3
  }
  
  // Resource utilization
  if (clusterData.avgCpuPercent && clusterData.avgCpuPercent > 80) {
    score -= 2
  } else if (clusterData.avgCpuPercent && clusterData.avgCpuPercent > 90) {
    score -= 3
  }
  
  if (clusterData.avgMemoryPercent && clusterData.avgMemoryPercent > 80) {
    score -= 2
  } else if (clusterData.avgMemoryPercent && clusterData.avgMemoryPercent > 90) {
    score -= 3
  }
  
  // Backup status
  if (clusterData.latestBackup) {
    if (clusterData.latestBackup.phase === 'Failed') {
      score -= 2
    } else if (clusterData.latestBackup.errors > 0) {
      score -= 1
    }
  } else {
    score -= 1 // No backup configured
  }
  
  return Math.max(1, Math.round(score))
}

function getHealthDescription(score: number): string {
  if (score >= 9) return "🟢 **Excellent** - Cluster is performing optimally with no critical issues."
  if (score >= 7) return "🟡 **Good** - Cluster is stable with minor areas for improvement."
  if (score >= 5) return "🟠 **Fair** - Some issues detected that should be addressed soon."
  if (score >= 3) return "🔴 **Poor** - Multiple issues requiring immediate attention."
  return "🚨 **Critical** - Cluster has serious problems that need urgent resolution."
}

function analyzePerformance(clusterData: ClusterData): string[] {
  const insights: string[] = []
  
  // CPU analysis
  if (clusterData.avgCpuPercent !== undefined) {
    if (clusterData.avgCpuPercent > 90) {
      insights.push(`🚨 **Critical CPU Usage**: Average CPU at ${clusterData.avgCpuPercent.toFixed(1)}% - immediate scaling required`)
    } else if (clusterData.avgCpuPercent > 80) {
      insights.push(`⚠️ **High CPU Usage**: Average CPU at ${clusterData.avgCpuPercent.toFixed(1)}% - consider scaling soon`)
    } else if (clusterData.avgCpuPercent < 20) {
      insights.push(`💡 **Low CPU Usage**: Average CPU at ${clusterData.avgCpuPercent.toFixed(1)}% - potential for cost optimization`)
    } else {
      insights.push(`✅ **Healthy CPU Usage**: Average CPU at ${clusterData.avgCpuPercent.toFixed(1)}% - within optimal range`)
    }
  }
  
  // Memory analysis
  if (clusterData.avgMemoryPercent !== undefined) {
    if (clusterData.avgMemoryPercent > 90) {
      insights.push(`🚨 **Critical Memory Usage**: Average memory at ${clusterData.avgMemoryPercent.toFixed(1)}% - risk of OOM kills`)
    } else if (clusterData.avgMemoryPercent > 80) {
      insights.push(`⚠️ **High Memory Usage**: Average memory at ${clusterData.avgMemoryPercent.toFixed(1)}% - monitor for memory leaks`)
    } else if (clusterData.avgMemoryPercent < 30) {
      insights.push(`💡 **Low Memory Usage**: Average memory at ${clusterData.avgMemoryPercent.toFixed(1)}% - consider downsizing`)
    } else {
      insights.push(`✅ **Healthy Memory Usage**: Average memory at ${clusterData.avgMemoryPercent.toFixed(1)}% - well balanced`)
    }
  }
  
  // Node analysis
  clusterData.nodes.forEach(node => {
    const cpuPercent = node.cpuCapacity > 0 ? (node.cpuUsage / node.cpuCapacity * 100) : 0
    const memoryPercent = node.memoryCapacity > 0 ? (node.memoryUsage / node.memoryCapacity * 100) : 0
    
    if (node.status !== 'Ready') {
      insights.push(`🚨 **Node Issue**: ${node.name} is ${node.status} - requires immediate attention`)
    } else if (cpuPercent > 95 || memoryPercent > 95) {
      insights.push(`⚠️ **Node Overload**: ${node.name} has high resource usage (CPU: ${cpuPercent.toFixed(1)}%, Memory: ${memoryPercent.toFixed(1)}%)`)
    }
  })
  
  if (insights.length === 0) {
    insights.push("✅ All performance metrics are within acceptable ranges")
  }
  
  return insights
}

function generateRecommendations(clusterData: ClusterData): string[] {
  const suggestions: string[] = []
  
  // Scaling recommendations
  if (clusterData.avgCpuPercent && clusterData.avgCpuPercent > 80) {
    suggestions.push(`📈 **Scale Up**: Add more nodes or increase CPU limits to handle high CPU usage`)
  }
  
  if (clusterData.avgMemoryPercent && clusterData.avgMemoryPercent > 80) {
    suggestions.push(`🧠 **Memory Scaling**: Increase memory allocation or add memory-optimized nodes`)
  }
  
  // High availability
  const controlPlaneNodes = clusterData.nodes.filter(n => n.isControlPlane).length
  if (controlPlaneNodes < 3) {
    suggestions.push(`🏗️ **High Availability**: Consider adding more control plane nodes for better resilience (current: ${controlPlaneNodes})`)
  }
  
  // Backup recommendations
  if (!clusterData.latestBackup) {
    suggestions.push(`💾 **Backup Setup**: Implement automated backup solution (e.g., Velero) for disaster recovery`)
  } else if (clusterData.latestBackup.phase === 'Failed') {
    suggestions.push(`🚨 **Backup Failure**: Investigate and fix backup failures immediately`)
  } else if (clusterData.latestBackup.errors > 0) {
    suggestions.push(`⚠️ **Backup Warnings**: Review backup errors (${clusterData.latestBackup.errors}) and warnings (${clusterData.latestBackup.warnings})`)
  }
  
  // Resource optimization
  if (clusterData.avgCpuPercent && clusterData.avgMemoryPercent && 
      clusterData.avgCpuPercent < 30 && clusterData.avgMemoryPercent < 30) {
    suggestions.push(`💰 **Cost Optimization**: Consider downsizing cluster or using smaller instance types`)
  }
  
  // General best practices
  suggestions.push(`🔄 **Regular Updates**: Keep Kubernetes and Talos versions up to date`)
  suggestions.push(`📊 **Monitoring**: Implement comprehensive monitoring with Prometheus and Grafana`)
  suggestions.push(`⚡ **Resource Optimization**: Review pod resource requests and limits for optimal scheduling`)
  suggestions.push(`🎯 **Autoscaling**: Consider implementing Horizontal Pod Autoscaler (HPA) for dynamic scaling`)
  suggestions.push(`🗄️ **Storage Management**: Monitor storage usage and implement cleanup policies for logs and unused resources`)
  suggestions.push(`🔐 **Security**: Regularly rotate certificates and update RBAC policies`)
  suggestions.push(`🛡️ **Security Policies**: Implement network policies and pod security standards`)

  return suggestions
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clusterId = parseInt(params.id)
    
    // Get cluster data
    const clusterResponse = await fetch(`${request.nextUrl.origin}/api/clusters/${clusterId}/details`, {
      headers: {
        'Cookie': request.headers.get('Cookie') || ''
      }
    })
    
    if (!clusterResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch cluster data' },
        { status: 500 }
      )
    }
    
    const clusterData: ClusterData = await clusterResponse.json()

    // Validate cluster data
    if (!clusterData || !clusterData.nodes || clusterData.nodes.length === 0) {
      return NextResponse.json({
        clusterId,
        clusterName: clusterData?.clusterName || 'Unknown',
        analysis: generateIntelligentAnalysis(clusterData),
        timestamp: new Date().toISOString(),
        isDemo: true,
        error: 'Invalid cluster data - showing basic analysis'
      })
    }

    // Get LLM settings (straight from the database; /api/settings is admin-only)
    const settingsResult = await query(
      "SELECT key, value FROM settings WHERE key LIKE 'llm\\_%' OR key LIKE 'ollama\\_%' OR key LIKE 'lmstudio\\_%'"
    )

    let llmSettings: LlmSettings = {
      llm_provider: 'ollama',
      ollama_endpoint: 'https://your-ollama-server.com',
      ollama_model: 'llama3.1:8b',
      lmstudio_endpoint: 'http://localhost:1234',
      lmstudio_model: 'local-model'
    }

    settingsResult.rows.forEach((setting: any) => {
      (llmSettings as any)[setting.key] = setting.value
    })
    
    // Prepare the analysis prompt
    const analysisPrompt = `
You are a Kubernetes expert analyzing cluster health and performance. Please provide a comprehensive analysis of this Talos-based Kubernetes cluster:

**Cluster Information:**
- Name: ${clusterData.clusterName}
- Status: ${clusterData.status}
- Kubernetes Version: ${clusterData.kubernetesVersion || 'Unknown'}
- Talos Version: ${clusterData.talosVersion || 'Unknown'}
- Nodes: ${clusterData.healthyNodes}/${clusterData.totalNodes} healthy
- Total Pods: ${clusterData.totalPods || 'Unknown'}
- Total Namespaces: ${clusterData.totalNamespaces || 'Unknown'}

**Resource Usage:**
- Average CPU: ${clusterData.avgCpuPercent?.toFixed(1) || 'Unknown'}%
- Average Memory: ${clusterData.avgMemoryPercent?.toFixed(1) || 'Unknown'}%

**Node Details:**
${clusterData.nodes.map(node => `
- ${node.name} (${node.isControlPlane ? 'Control Plane' : 'Worker'}):
  - Status: ${node.status}
  - CPU: ${node.cpuCapacity > 0 ? (node.cpuUsage / node.cpuCapacity * 100).toFixed(1) : 'Unknown'}% (${node.cpuUsage}/${node.cpuCapacity} cores)
  - Memory: ${node.memoryCapacity > 0 ? (node.memoryUsage / node.memoryCapacity * 100).toFixed(1) : 'Unknown'}% (${(node.memoryUsage / 1024 / 1024 / 1024).toFixed(1)}GB/${(node.memoryCapacity / 1024 / 1024 / 1024).toFixed(1)}GB)`).join('')}

${clusterData.openebsStorage ? `**Storage (OpenEBS):**
- Total Capacity: ${clusterData.openebsStorage.totalCapacity}
- Used: ${clusterData.openebsStorage.totalUsed}
- Available: ${clusterData.openebsStorage.totalAvailable}
- Pool Count: ${clusterData.openebsStorage.poolCount}` : ''}

${clusterData.latestBackup ? `**Latest Backup:**
- Name: ${clusterData.latestBackup.name}
- Phase: ${clusterData.latestBackup.phase}
- Errors: ${clusterData.latestBackup.errors}
- Warnings: ${clusterData.latestBackup.warnings}
- Started: ${clusterData.latestBackup.startTimestamp || 'Unknown'}
- Completed: ${clusterData.latestBackup.completionTimestamp || 'Unknown'}` : '**Backup Status:** No backup information available'}

Please provide:
1. **Overall Health Assessment** - Rate the cluster health (1-10) and explain
2. **Critical Issues** - Any immediate problems requiring attention
3. **Performance Analysis** - Resource utilization insights and bottlenecks
4. **Security & Best Practices** - Recommendations for improvement
5. **Scaling Recommendations** - When to add/remove resources
6. **Maintenance Suggestions** - Proactive maintenance tasks

Keep the analysis practical and actionable for DevOps teams managing production Kubernetes clusters.
`

    // Call the configured LLM
    let analysis: string

    try {
      console.log('LLM Settings:', llmSettings)
      
      if (llmSettings.llm_provider === 'ollama') {
        console.log('Calling Ollama API:', llmSettings.ollama_endpoint, llmSettings.ollama_model)
        analysis = await callOllamaAPI(llmSettings.ollama_endpoint, llmSettings.ollama_model, analysisPrompt)
      } else if (llmSettings.llm_provider === 'lmstudio') {
        console.log('Calling LM Studio API:', llmSettings.lmstudio_endpoint, llmSettings.lmstudio_model)
        analysis = await callLmStudioAPI(llmSettings.lmstudio_endpoint, llmSettings.lmstudio_model, analysisPrompt)
      } else {
        throw new Error(`Invalid LLM provider configured: ${llmSettings.llm_provider}`)
      }
      
      // Check if we got a valid response
      if (!analysis || analysis.trim() === '' || analysis === 'No response generated') {
        throw new Error('LLM returned empty or invalid response')
      }
      
      console.log('LLM Analysis completed successfully')
    } catch (error) {
      console.error('LLM API error details:', error)
      
      // If LLM fails, provide intelligent analysis using actual cluster data
      analysis = generateIntelligentAnalysis(clusterData)
      
      return NextResponse.json({
        clusterId,
        clusterName: clusterData.clusterName,
        analysis,
        timestamp: new Date().toISOString(),
        isDemo: true,
        error: `LLM unavailable (${error instanceof Error ? error.message : 'Unknown error'}), showing intelligent analysis based on live data`
      })
    }

    return NextResponse.json({
      clusterId,
      clusterName: clusterData.clusterName,
      analysis,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Cluster analysis error:', error)
    return NextResponse.json(
      { error: 'Internal server error during cluster analysis' },
      { status: 500 }
    )
  }
}