'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AnalysisResult {
  clusterId: number
  clusterName: string
  analysis: string
  timestamp: string
  isDemo?: boolean
  error?: string
}

interface ClusterAnalysisModalProps {
  clusterId: number
  clusterName: string
  isOpen: boolean
  onClose: () => void
}

export default function ClusterAnalysisModal({ 
  clusterId, 
  clusterName, 
  isOpen, 
  onClose 
}: ClusterAnalysisModalProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const analyzeCluster = async () => {
    setLoading(true)
    setError('')
    setAnalysis(null)
    
    try {
      const response = await fetch(`/api/clusters/${clusterId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to analyze cluster')
      }

      const result = await response.json()
      setAnalysis(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    } finally {
      setLoading(false)
    }
  }

  const formatAnalysis = (text: string) => {
    // Convert markdown-style formatting to HTML
    const sections = text.split(/\*\*([^*]+)\*\*/g)
    return sections.map((section, index) => {
      if (index % 2 === 1) {
        // This is a header
        return `<h3 class="text-lg font-semibold text-blue-600 mt-4 mb-2">${section}</h3>`
      } else {
        // This is content
        return section
          .split('\n')
          .map(line => {
            line = line.trim()
            if (line.startsWith('- ')) {
              return `<li class="ml-4 mb-1">${line.substring(2)}</li>`
            } else if (line.length > 0) {
              return `<p class="mb-2">${line}</p>`
            }
            return ''
          })
          .join('')
      }
    }).join('')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">🤖 AI Cluster Analysis</h2>
              <p className="text-gray-600">{clusterName}</p>
            </div>
            <Button onClick={onClose} variant="outline" size="sm">
              ✕ Close
            </Button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {!analysis && !loading && !error && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🧠</div>
              <h3 className="text-xl font-semibold mb-2">Ready to Analyze</h3>
              <p className="text-gray-600 mb-6">
                Get AI-powered insights about your cluster&apos;s health, performance, and optimization opportunities.
              </p>
              <Button 
                onClick={analyzeCluster}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
              >
                🚀 Start AI Analysis
              </Button>
            </div>
          )}

          {loading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h3 className="text-xl font-semibold mb-2">Analyzing Cluster...</h3>
              <p className="text-gray-600">
                AI is examining your cluster&apos;s health, performance, and configuration.
                This may take 30-60 seconds.
              </p>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4 text-red-500">⚠️</div>
              <h3 className="text-xl font-semibold mb-2 text-red-600">Analysis Failed</h3>
              <p className="text-gray-600 mb-6">{error}</p>
              <Button 
                onClick={analyzeCluster}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
              >
                🔄 Retry Analysis
              </Button>
            </div>
          )}

          {analysis && (
            <div>
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {analysis.isDemo ? '🤖 Intelligent Analysis (Live Data)' : '✅ AI Analysis Complete'}
                  </CardTitle>
                  <CardDescription>
                    Generated on {new Date(analysis.timestamp).toLocaleString()}
                    {analysis.isDemo && (
                      <span className="block text-blue-600 font-medium mt-1">
                        � Analysis based on live cluster data - Configure LLM in Settings for AI insights
                      </span>
                    )}
                    {analysis.error && (
                      <span className="block text-orange-600 text-sm mt-1">
                        ⚠️ {analysis.error}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
              </Card>

              <div className="prose max-w-none">
                <div 
                  className="text-gray-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ 
                    __html: formatAnalysis(analysis.analysis) 
                  }}
                />
              </div>

              <div className="mt-6 pt-4 border-t">
                <Button 
                  onClick={analyzeCluster}
                  variant="outline"
                  className="mr-3"
                >
                  🔄 Analyze Again
                </Button>
                <Button 
                  onClick={() => {
                    const blob = new Blob([
                      `AI Cluster Analysis - ${clusterName}\n` +
                      `Generated: ${new Date(analysis.timestamp).toLocaleString()}\n\n` +
                      analysis.analysis
                    ], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `cluster-analysis-${clusterName}-${new Date().toISOString().split('T')[0]}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  variant="outline"
                >
                  💾 Download Report
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}