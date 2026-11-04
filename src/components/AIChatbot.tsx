'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MessageCircle, X, Minimize2, Maximize2, Move, Bot, Send, AlertCircle, Wifi, WifiOff } from 'lucide-react'
import { usePathname } from 'next/navigation'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface AIChatbotProps {
  clusterId?: number
}

export default function AIChatbot({ clusterId }: AIChatbotProps) {
  const pathname = usePathname()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isEnabled, setIsEnabled] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMinimized, setIsMinimized] = useState(true)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, startX: 0, startY: 0 })
  const [isAutoPositioning, setIsAutoPositioning] = useState(false) // Track automatic repositioning
  const [currentClusterInfo, setCurrentClusterInfo] = useState<{ id: number, name: string } | null>(null)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatbotRef = useRef<HTMLDivElement>(null)

  // Detect cluster ID from URL
  const detectedClusterId = (() => {
    // If clusterId is explicitly passed, use that
    if (clusterId) return clusterId
    
    // Try to extract from URL pattern /cluster/[id]
    const clusterMatch = pathname.match(/\/cluster\/(\d+)/)
    if (clusterMatch) {
      return parseInt(clusterMatch[1], 10)
    }
    
    return null
  })()

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const checkAIStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/chat')
      if (response.ok) {
        const data = await response.json()
        setIsEnabled(data.enabled)
        setIsConnected(data.connected)
        if (data.enabled && data.connected) {
          const welcomeMessage = detectedClusterId 
            ? `Hi! I'm your Kubernetes assistant. I can see you're working with a specific cluster, so I have access to its configuration, events, and metrics. I can help you with cluster-specific troubleshooting, best practices, and more. What would you like to know?`
            : `Hi! I'm your Kubernetes assistant. I can help you with cluster management, troubleshooting, best practices, and more. What would you like to know?`
          
          setMessages([{
            role: 'assistant',
            content: welcomeMessage,
            timestamp: new Date()
          }])
        }
      }
    } catch (error) {
      console.error('Failed to check AI status:', error)
    }
  }, [detectedClusterId])

  const fetchClusterInfo = useCallback(async (clId: number) => {
    try {
      const response = await fetch(`/api/clusters/${clId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.cluster) {
          setCurrentClusterInfo({
            id: clId,
            name: data.cluster.name
          })
        }
      }
    } catch (error) {
      console.error('Failed to fetch cluster info:', error)
    }
  }, [])

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return

    const userMessage: ChatMessage = {
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputMessage('')
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          clusterId: detectedClusterId, // Use detected cluster ID from URL
          history: messages.slice(-10) // Send last 10 messages for context
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to get response')
      }

      const data = await response.json()
      
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.response,
        timestamp: new Date()
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to send message')
      console.error('Chat error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault() // Prevent default button behavior when dragging
    setIsDragging(true)
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      startX: position.x,
      startY: position.y
    })
  }

  const handleButtonMouseDown = (e: React.MouseEvent) => {
    // For the minimized button, we need to handle both click and drag
    e.preventDefault()
    setIsDragging(true)
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      startX: position.x,
      startY: position.y
    })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    
    const deltaX = e.clientX - dragStart.x
    const deltaY = e.clientY - dragStart.y
    
    // Different boundary constraints based on whether minimized or expanded
    const width = isMinimized ? 64 : 400  // 64px for button, 400px for expanded window
    const height = isMinimized ? 64 : 500 // 64px for button, 500px for expanded window
    
    const newX = Math.max(0, Math.min(window.innerWidth - width, dragStart.startX + deltaX))
    const newY = Math.max(0, Math.min(window.innerHeight - height, dragStart.startY + deltaY))
    
    setPosition({ x: newX, y: newY })
  }, [isDragging, dragStart, isMinimized])

  const ensureVisiblePosition = useCallback(() => {
    if (typeof window === 'undefined') return
    
    // Mark that we're doing automatic positioning - don't update originalPosition
    setIsAutoPositioning(true)
    
    // When opening the chat, ensure it's positioned within the visible area
    const chatWidth = 384  // 96 * 4 = 384px (w-96)
    const chatHeight = 500 // h-[500px]
    const padding = 20     // 20px padding from edges
    
    const maxX = window.innerWidth - chatWidth - padding
    const maxY = window.innerHeight - chatHeight - padding
    
    let newX = position.x
    let newY = position.y
    
    // Ensure horizontal position is visible
    if (newX + chatWidth > window.innerWidth - padding) {
      newX = window.innerWidth - chatWidth - padding
    }
    if (newX < padding) {
      newX = padding
    }
    
    // Ensure vertical position is visible  
    if (newY + chatHeight > window.innerHeight - padding) {
      newY = window.innerHeight - chatHeight - padding
    }
    if (newY < padding) {
      newY = padding
    }
    
    // If position needs adjustment, animate to the new position
    // This is temporary positioning - originalPosition remains unchanged
    if (newX !== position.x || newY !== position.y) {
      setPosition({ x: newX, y: newY })
    }
    
    // Reset the auto positioning flag after a delay
    setTimeout(() => setIsAutoPositioning(false), 300)
  }, [position.x, position.y])

  const returnToBottomRight = useCallback(() => {
    // Always return to bottom-right corner when closing the chat
    if (typeof window !== 'undefined') {
      const buttonWidth = 64  // Width of the minimized button
      const buttonHeight = 64 // Height of the minimized button
      const padding = 20      // Padding from edges
      
      const bottomRightX = window.innerWidth - buttonWidth - padding
      const bottomRightY = window.innerHeight - buttonHeight - padding
      
      setPosition({ x: bottomRightX, y: bottomRightY })
    }
  }, [])

  const handleMouseUp = useCallback((e?: MouseEvent) => {
    if (isDragging && isMinimized) {
      // Check if this was a drag or a click
      const dragDistance = Math.sqrt(
        Math.pow((e?.clientX || 0) - dragStart.x, 2) + 
        Math.pow((e?.clientY || 0) - dragStart.y, 2)
      )
      
      // If the drag distance is small (less than 5px), treat it as a click
      if (dragDistance < 5) {
        setIsMinimized(false)
        // Ensure the chat window will be visible when opened
        setTimeout(ensureVisiblePosition, 0)
      }
    }
    setIsDragging(false)
  }, [isDragging, isMinimized, dragStart, ensureVisiblePosition])

  useEffect(() => {
    checkAIStatus()

    if (detectedClusterId) {
      fetchClusterInfo(detectedClusterId)
    }

    const updatePosition = () => {
      if (typeof window !== 'undefined') {
        if (position.x === 0 && position.y === 0) {
          const buttonWidth = 64
          const buttonHeight = 64
          const padding = 20
          const newX = window.innerWidth - buttonWidth - padding
          const newY = window.innerHeight - buttonHeight - padding
          setPosition({ x: newX, y: newY })
        } else if (!isMinimized) {
          ensureVisiblePosition()
        } else if (isMinimized) {
          returnToBottomRight()
        }
      }
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)

    return () => window.removeEventListener('resize', updatePosition)
  }, [pathname, checkAIStatus, detectedClusterId, fetchClusterInfo, position.x, position.y, isMinimized, ensureVisiblePosition, returnToBottomRight])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (typeof window !== 'undefined' && !isMinimized) {
      setTimeout(ensureVisiblePosition, 100)
    }
  }, [isMinimized, ensureVisiblePosition])

  useEffect(() => {
    if (isDragging) {
      const handleMouseUpWithEvent = (e: MouseEvent) => handleMouseUp(e)
      
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUpWithEvent)
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUpWithEvent)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const formatMessage = (content: string) => {
    const lines = content.split('\n')
    const result: React.ReactNode[] = []
    let inCodeBlock = false
    let codeBlockContent: string[] = []
    let codeBlockLanguage = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      
      // Handle code blocks
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          // Starting code block
          inCodeBlock = true
          codeBlockLanguage = line.replace('```', '').trim()
          codeBlockContent = []
        } else {
          // Ending code block
          inCodeBlock = false
          result.push(
            <div key={`code-${i}`} className="bg-gray-800 text-green-400 p-3 rounded-lg font-mono text-sm my-2 overflow-x-auto">
              <div className="text-gray-400 text-xs mb-2">{codeBlockLanguage || 'code'}</div>
              <pre className="whitespace-pre-wrap">{codeBlockContent.join('\n')}</pre>
            </div>
          )
        }
        continue
      }

      if (inCodeBlock) {
        codeBlockContent.push(line)
        continue
      }

      // Format regular line with markdown
      const formattedLine = formatLineMarkdown(line, i)
      result.push(formattedLine)
    }

    return result
  }

  const formatLineMarkdown = (line: string, index: number) => {
    if (!line.trim()) {
      return <div key={index} className="mb-2" />
    }

    // Handle headers
    if (line.startsWith('###')) {
      return <h3 key={index} className="text-lg font-semibold mt-4 mb-2 text-blue-600">{line.replace('###', '').trim()}</h3>
    }
    if (line.startsWith('##')) {
      return <h2 key={index} className="text-xl font-semibold mt-4 mb-2 text-blue-700">{line.replace('##', '').trim()}</h2>
    }
    if (line.startsWith('#')) {
      return <h1 key={index} className="text-2xl font-bold mt-4 mb-3 text-blue-800">{line.replace('#', '').trim()}</h1>
    }

    // Handle numbered lists
    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/)
    if (numberedMatch) {
      const [, indent, number, content] = numberedMatch
      return (
        <div key={index} className={`mb-1 ${indent ? 'ml-4' : ''}`}>
          <span className="font-semibold text-blue-600">{number}.</span> {formatInlineMarkdown(content)}
        </div>
      )
    }

    // Handle bullet points
    const bulletMatch = line.match(/^(\s*)-\s+(.+)$/)
    if (bulletMatch) {
      const [, indent, content] = bulletMatch
      return (
        <div key={index} className={`mb-1 ${indent ? 'ml-4' : ''}`}>
          <span className="text-blue-500 font-bold">•</span> {formatInlineMarkdown(content)}
        </div>
      )
    }

    // Regular paragraph
    return <div key={index} className="mb-2 leading-relaxed">{formatInlineMarkdown(line)}</div>
  }

  const formatInlineMarkdown = (text: string) => {
    const parts: React.ReactNode[] = []
    let currentText = text
    let partIndex = 0

    // Handle bold text **text**
    currentText = currentText.replace(/\*\*(.*?)\*\*/g, (match, content) => {
      const placeholder = `__BOLD_${partIndex}__`
      parts.push(<strong key={`bold-${partIndex}`} className="font-semibold text-gray-900">{content}</strong>)
      partIndex++
      return placeholder
    })

    // Handle inline code `text`
    currentText = currentText.replace(/`([^`]+)`/g, (match, content) => {
      const placeholder = `__CODE_${partIndex}__`
      parts.push(<code key={`code-${partIndex}`} className="bg-gray-100 px-1 py-0.5 rounded font-mono text-sm text-red-600">{content}</code>)
      partIndex++
      return placeholder
    })

    // Split by placeholders and rebuild
    const segments = currentText.split(/(__(?:BOLD|CODE)_\d+__)/g)
    return segments.map((segment, i) => {
      const boldMatch = segment.match(/__BOLD_(\d+)__/)
      const codeMatch = segment.match(/__CODE_(\d+)__/)
      
      if (boldMatch) {
        return parts.find(p => React.isValidElement(p) && p.key === `bold-${boldMatch[1]}`) || segment
      }
      if (codeMatch) {
        return parts.find(p => React.isValidElement(p) && p.key === `code-${codeMatch[1]}`) || segment
      }
      return segment
    }).filter(Boolean)
  }

  return (
    <div
      ref={chatbotRef}
      className="fixed z-50 transition-all duration-300 ease-in-out"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? 'grabbing' : 'default',
        transform: isDragging ? 'none' : 'translate3d(0,0,0)' // Smooth GPU acceleration when not dragging
      }}
    >
      {/* Minimized Floating Button */}
      {isMinimized && (
        <div className="relative">
          <Button
            onMouseDown={handleButtonMouseDown}
            size="lg"
            className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-110 cursor-grab active:cursor-grabbing"
          >
            <div className="relative">
              <Bot className="w-8 h-8 text-white" />
              {/* Status indicator */}
              <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${
                !isEnabled ? 'bg-gray-400' : 
                !isConnected ? 'bg-red-500' : 
                'bg-green-500'
              }`}></div>
            </div>
          </Button>
          
          {/* Tooltip */}
          <div className="absolute bottom-full right-0 mb-2 opacity-0 hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap">
              {!isEnabled ? 'AI Disabled - Check Settings' : 
               !isConnected ? 'Connection Failed' : 
               detectedClusterId ? `AI Assistant (${currentClusterInfo?.name || 'Cluster Context'})` :
               'AI Assistant Ready'}
            </div>
          </div>
        </div>
      )}

      {/* Expanded Chat Window */}
      {!isMinimized && (
        <Card className="w-96 h-[500px] shadow-2xl border-0 overflow-hidden">
          {/* Header with drag handle */}
          <CardHeader 
            className="pb-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Bot className="w-6 h-6" />
                <div>
                  <CardTitle className="text-lg text-white">AI Assistant</CardTitle>
                  <div className="flex items-center space-x-2 mt-1">
                    {!isEnabled ? (
                      <>
                        <AlertCircle className="w-3 h-3 text-amber-300" />
                        <span className="text-xs text-amber-200">Disabled</span>
                      </>
                    ) : !isConnected ? (
                      <>
                        <WifiOff className="w-3 h-3 text-red-300" />
                        <span className="text-xs text-red-200">Offline</span>
                      </>
                    ) : (
                      <>
                        <Wifi className="w-3 h-3 text-green-300" />
                        <span className="text-xs text-green-200">Online</span>
                        {detectedClusterId && (
                          <span className="text-xs bg-blue-500 bg-opacity-30 px-2 py-0.5 rounded">
                            {currentClusterInfo ? `Cluster: ${currentClusterInfo.name}` : 'Cluster Context'}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="text-white hover:bg-white hover:bg-opacity-20 p-1 h-8 w-8"
                >
                  {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsMinimized(true)
                    setTimeout(returnToBottomRight, 100) // Small delay to ensure state update
                  }}
                  className="text-white hover:bg-white hover:bg-opacity-20 p-1 h-8 w-8"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>

          {/* Content */}
          {(!isEnabled || !isConnected) ? (
            <CardContent className="p-6 h-[400px] flex flex-col justify-center items-center text-center">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
                !isEnabled ? 'bg-amber-100' : 'bg-red-100'
              }`}>
                {!isEnabled ? (
                  <AlertCircle className="w-8 h-8 text-amber-600" />
                ) : (
                  <WifiOff className="w-8 h-8 text-red-600" />
                )}
              </div>
              
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {!isEnabled ? 'AI Assistant Disabled' : 'Connection Failed'}
              </h3>
              
              <p className="text-sm text-gray-600 mb-4">
                {!isEnabled 
                  ? 'Enable the AI chatbot in settings to start getting Kubernetes assistance.'
                  : 'Cannot connect to Ollama server. Check your configuration.'}
              </p>
              
              <Button
                onClick={() => window.open('/settings', '_blank')}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Open Settings
              </Button>
            </CardContent>
          ) : (
            <CardContent className="p-0 h-[400px] flex flex-col">
              {/* Messages Area */}
              <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${
                isExpanded ? 'h-80' : 'h-64'
              }`}>
                {messages.map((message, index) => (
                  <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] p-4 rounded-lg ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-white text-gray-800 rounded-bl-sm shadow-md border border-gray-200'
                      }`}
                    >
                      <div className={`${message.role === 'user' ? 'text-sm' : 'text-sm prose prose-sm max-w-none'}`}>
                        {message.role === 'user' ? message.content : formatMessage(message.content)}
                      </div>
                      <div className={`text-xs mt-1 ${
                        message.role === 'user' ? 'text-blue-200' : 'text-gray-500'
                      }`}>
                        {message.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 p-3 rounded-lg rounded-bl-sm">
                      <div className="flex items-center space-x-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-sm text-gray-600">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Error Display */}
              {error && (
                <div className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                </div>
              )}

              {/* Input Area */}
              <div className="p-4 border-t bg-gray-50">
                <div className="flex space-x-2">
                  <Input
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask about Kubernetes..."
                    disabled={isLoading}
                    className="flex-1 border-gray-200 focus:border-blue-500 focus:ring-blue-500"
                  />
                  <Button 
                    onClick={sendMessage}
                    disabled={isLoading || !inputMessage.trim()}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}