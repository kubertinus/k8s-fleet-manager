'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MessageCircle, AlertTriangle, Users, Server, Shield, Sparkles, Network, Package, History } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'

interface User {
  id: number
  username: string
  email: string
  role: string
  created_at: string
}

interface Cluster {
  id: number
  name: string
  endpoint: string
  description: string
  is_active: boolean
}

interface Setting {
  key: string
  value: string
  description: string
}

export default function SettingsPage() {
  const [users, setUsers] = useState<User[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()

  // User form state
  const [showUserForm, setShowUserForm] = useState(false)
  const [userForm, setUserForm] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user'
  })

  // Cluster form state
  const [showClusterForm, setShowClusterForm] = useState(false)
  const [clusterForm, setClusterForm] = useState({
    kubeconfig: '',
    talosconfig: ''
  })

  // Cluster edit state
  const [editingCluster, setEditingCluster] = useState<number | null>(null)
  const [clusterEditForm, setClusterEditForm] = useState({
    name: '',
    description: ''
  })

  // Keycloak settings state
  const [keycloakSettings, setKeycloakSettings] = useState({
    keycloak_enabled: 'false',
    keycloak_server_url: '',
    keycloak_realm: '',
    keycloak_client_id: '',
    keycloak_client_secret: '',
    keycloak_scope: 'openid profile email',
    keycloak_admin_group: '',
    keycloak_access_group: '',
    keycloak_allow_insecure_tls: 'false',
    app_hostname: ''
  })

  // Ollama AI settings state
  const [ollamaSettings, setOllamaSettings] = useState({
    ollama_enabled: 'false',
    ollama_server_url: 'http://localhost:11434',
    ollama_model: 'llama3.2',
    ollama_temperature: '0.7',
    ollama_max_tokens: '4096'
  })

  // Antrea flow settings state
  const [antreaSettings, setAntreaSettings] = useState({
    antrea_flow_api_url: '',
    antrea_flow_api_token: ''
  })

  // Nexus image update settings state
  const [nexusSettings, setNexusSettings] = useState({
    nexus_server_url: '',
    nexus_allow_insecure_tls: 'false',
    nexus_username: '',
    nexus_password: ''
  })

  // Health history settings state
  const [historySettings, setHistorySettings] = useState({
    history_interval_minutes: '5',
    history_retention_days: '30'
  })

  // AI Prompt settings state
  const [aiPromptSettings, setAiPromptSettings] = useState({
    ai_system_prompt: '',
    ai_cluster_context_prompt: '',
    ai_dashboard_context_prompt: '',
    ai_cluster_redirect_prompt: ''
  })

  const fetchData = useCallback(async () => {
    try {
      // Fetch users, clusters, and settings
      const [usersResponse, clustersResponse, settingsResponse] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/clusters'),
        fetch('/api/settings')
      ])

      if (usersResponse.status === 401 || clustersResponse.status === 401 || settingsResponse.status === 401) {
        router.push('/login')
        return
      }

      // Check for forbidden access (non-admin users)
      if (usersResponse.status === 403) {
        setError('Access denied. Admin privileges required.')
        router.push('/dashboard')
        return
      }

      const usersData = await usersResponse.json()
      const clustersData = await clustersResponse.json()
      const settingsData = await settingsResponse.json()

      if (usersData.users) setUsers(usersData.users)
      if (clustersData.clusters) setClusters(clustersData.clusters)
      
      if (settingsData.settings) {
        setSettings(settingsData.settings)
        
        // Update authentication settings state
        const authSettingsObj: any = {}
        const ollamaSettingsObj: any = {}
        const antreaSettingsObj: any = {}
        const nexusSettingsObj: any = {}
        const aiPromptSettingsObj: any = {}
        const historySettingsObj: any = {}
        settingsData.settings.forEach((setting: Setting) => {
          if (setting.key.startsWith('keycloak_') || setting.key === 'app_hostname') {
            authSettingsObj[setting.key] = setting.value
          }
          if (setting.key.startsWith('ollama_')) {
            ollamaSettingsObj[setting.key] = setting.value
          }
          if (setting.key.startsWith('antrea_')) {
            antreaSettingsObj[setting.key] = setting.value
          }
          if (setting.key.startsWith('nexus_')) {
            nexusSettingsObj[setting.key] = setting.value
          }
          if (setting.key.startsWith('history_')) {
            historySettingsObj[setting.key] = setting.value
          }
          if (setting.key.startsWith('ai_')) {
            aiPromptSettingsObj[setting.key] = setting.value
          }
        })
        setKeycloakSettings(prev => ({ ...prev, ...authSettingsObj }))
        setOllamaSettings(prev => ({ ...prev, ...ollamaSettingsObj }))
        setAntreaSettings(prev => ({ ...prev, ...antreaSettingsObj }))
        setNexusSettings(prev => ({ ...prev, ...nexusSettingsObj }))
        setAiPromptSettings(prev => ({ ...prev, ...aiPromptSettingsObj }))
        setHistorySettings(prev => ({ ...prev, ...historySettingsObj }))
      }
    } catch (error) {
      setError('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])


  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm)
      })

      if (response.ok) {
        setUserForm({ username: '', email: '', password: '', role: 'user' })
        setShowUserForm(false)
        fetchData()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create user')
      }
    } catch (error) {
      setError('Network error')
    }
  }

  const handleCreateCluster = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clusterForm)
      })

      if (response.ok) {
        setClusterForm({ kubeconfig: '', talosconfig: '' })
        setShowClusterForm(false)
        fetchData()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create cluster')
      }
    } catch (error) {
      setError('Network error')
    }
  }

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('Are you sure you want to delete this user?')) return
    
    try {
      const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' })
      if (response.ok) {
        setError('')
        fetchData()
        alert('User deleted successfully')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to delete user')
      }
    } catch (error) {
      setError('Network error: Failed to delete user')
    }
  }

  const handleDeleteCluster = async (clusterId: number) => {
    if (!confirm('Are you sure you want to delete this cluster? This will also remove all associated monitoring data.')) return
    
    try {
      const response = await fetch(`/api/clusters/${clusterId}`, { method: 'DELETE' })
      if (response.ok) {
        fetchData()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to delete cluster')
      }
    } catch (error) {
      setError('Failed to delete cluster')
    }
  }

  const startEditCluster = (cluster: Cluster) => {
    setEditingCluster(cluster.id)
    setClusterEditForm({
      name: cluster.name,
      description: cluster.description || ''
    })
  }

  const cancelEditCluster = () => {
    setEditingCluster(null)
    setClusterEditForm({ name: '', description: '' })
  }

  const handleUpdateCluster = async (clusterId: number) => {
    try {
      const response = await fetch(`/api/clusters/${clusterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clusterEditForm)
      })
      
      if (response.ok) {
        fetchData()
        setEditingCluster(null)
        setClusterEditForm({ name: '', description: '' })
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update cluster')
      }
    } catch (error) {
      setError('Failed to update cluster')
    }
  }

  const handleUpdateKeycloakSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const settingsArray = Object.entries(keycloakSettings).map(([key, value]) => ({
        key,
        value
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsArray })
      })

      if (response.ok) {
        setError('')
        alert('Keycloak settings updated successfully')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update settings')
      }
    } catch (error) {
      setError('Failed to update settings')
    }
  }

  const handleUpdateOllamaSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const settingsArray = Object.entries(ollamaSettings).map(([key, value]) => ({
        key,
        value
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsArray })
      })

      if (response.ok) {
        setError('')
        alert('Ollama AI settings updated successfully')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update settings')
      }
    } catch (error) {
      setError('Failed to update settings')
    }
  }

  const handleUpdateAiPromptSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const settingsArray = Object.entries(aiPromptSettings).map(([key, value]) => ({
        key,
        value
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsArray })
      })

      if (response.ok) {
        setError('')
        alert('AI Prompt settings updated successfully')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update settings')
      }
    } catch (error) {
      setError('Failed to update settings')
    }
  }

  const handleUpdateAntreaSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const settingsArray = Object.entries(antreaSettings).map(([key, value]) => ({
        key,
        value
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsArray })
      })

      if (response.ok) {
        setError('')
        alert('Antrea flow settings updated successfully')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update settings')
      }
    } catch (error) {
      setError('Failed to update settings')
    }
  }

  const handleUpdateNexusSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const settingsArray = Object.entries(nexusSettings).map(([key, value]) => ({
        key,
        value
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsArray })
      })

      if (response.ok) {
        setError('')
        alert('Nexus settings updated successfully')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update settings')
      }
    } catch (error) {
      setError('Failed to update settings')
    }
  }

  const handleUpdateHistorySettings = async (e: React.FormEvent) => {
    e.preventDefault()
    const interval = Number(historySettings.history_interval_minutes)
    const retention = Number(historySettings.history_retention_days)
    if (!Number.isInteger(interval) || interval < 1 || interval > 60 || !Number.isInteger(retention) || retention < 1 || retention > 365) {
      setError('Sample interval must be 1–60 minutes and retention 1–365 days')
      return
    }
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: Object.entries(historySettings).map(([key, value]) => ({ key, value })) })
      })
      if (response.ok) {
        setError('')
        alert('History settings updated successfully')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update settings')
      }
    } catch (error) {
      setError('Failed to update settings')
    }
  }

  if (loading) {
    return (
      <AppShell title="Settings">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-orange-500"></div>
            <p className="mt-4 text-sm text-slate-400">Loading settings...</p>
          </div>
        </div>
      </AppShell>
    )
  }

  const settingsSections = [
    { id: 'users-settings', label: 'User Management', icon: Users },
    { id: 'cluster-settings', label: 'Cluster Management', icon: Server },
    { id: 'auth-settings', label: 'Authentication', icon: Shield },
    { id: 'ollama-settings', label: 'AI Chatbot', icon: Sparkles },
    { id: 'ai-prompts-settings', label: 'AI Prompts', icon: MessageCircle },
    { id: 'antrea-settings', label: 'Antrea Flow', icon: Network },
    { id: 'nexus-settings', label: 'Nexus Updates', icon: Package },
    { id: 'history-settings', label: 'Health History', icon: History }
  ]

  return (
    <AppShell
      title="Settings"
      subtitle={`${users.length} users · ${clusters.length} clusters · ${settings.length} configs`}
    >
      <div className="theme-compat">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <p className="text-red-700 text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
          <aside className="hidden lg:block">
            <Card className="border-slate-200 shadow-sm sticky top-24">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Settings Menu</CardTitle>
                <CardDescription>Jump directly to a section</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {settingsSections.map((section) => {
                  const Icon = section.icon
                  return (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                    >
                      <Icon className="h-4 w-4" />
                      <span>{section.label}</span>
                    </a>
                  )
                })}
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-8">

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Users Management */}
          <div className="space-y-6">
            <Card id="users-settings" className="scroll-mt-24 border-slate-200 shadow-sm">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>Manage system users and their roles</CardDescription>
                  </div>
                  <Button onClick={() => setShowUserForm(!showUserForm)}>
                    {showUserForm ? 'Cancel' : 'Add User'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {showUserForm && (
                  <form onSubmit={handleCreateUser} className="space-y-4 mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">Username</label>
                        <Input
                          value={userForm.username}
                          onChange={(e) => setUserForm({...userForm, username: e.target.value})}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Email</label>
                        <Input
                          type="email"
                          value={userForm.email}
                          onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Password</label>
                        <Input
                          type="password"
                          value={userForm.password}
                          onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Role</label>
                        <select 
                          className="w-full h-10 px-3 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          value={userForm.role}
                          onChange={(e) => setUserForm({...userForm, role: e.target.value})}
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </div>
                    <Button type="submit">Create User</Button>
                  </form>
                )}

                <div className="space-y-3">
                  {users.map((user) => (
                    <div key={user.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
                      <div>
                        <div className="font-medium">{user.username}</div>
                        <div className="text-sm text-slate-600">{user.email}</div>
                        <div className="text-xs text-slate-500">
                          Role: {user.role} • Created: {new Date(user.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteUser(user.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Clusters Management */}
          <div className="space-y-6">
            <Card id="cluster-settings" className="scroll-mt-24 border-slate-200 shadow-sm">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Cluster Management</CardTitle>
                    <CardDescription>Configure Kubernetes clusters to monitor</CardDescription>
                  </div>
                  <Button onClick={() => setShowClusterForm(!showClusterForm)}>
                    {showClusterForm ? 'Cancel' : 'Add Cluster'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {showClusterForm && (
                  <form onSubmit={handleCreateCluster} className="space-y-4 mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium mb-1">Kubeconfig</label>
                      <textarea
                        className="w-full h-48 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                        value={clusterForm.kubeconfig}
                        onChange={(e) => setClusterForm({...clusterForm, kubeconfig: e.target.value})}
                        placeholder="Paste your kubeconfig YAML here..."
                        required
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Cluster name, endpoint, and description will be automatically extracted from the kubeconfig
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Talosconfig (Optional)</label>
                      <textarea
                        className="w-full h-32 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                        value={clusterForm.talosconfig}
                        onChange={(e) => setClusterForm({...clusterForm, talosconfig: e.target.value})}
                        placeholder="Paste your talosconfig YAML here (optional, for accurate Talos version detection)..."
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Talosconfig is used to get the actual Talos version from the cluster
                      </p>
                    </div>
                    <Button type="submit">Add Cluster</Button>
                  </form>
                )}

                <div className="space-y-3">
                  {clusters.map((cluster) => (
                    <div key={cluster.id} className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
                      {editingCluster === cluster.id ? (
                        // Edit form
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                              Cluster Name
                            </label>
                            <Input
                              type="text"
                              value={clusterEditForm.name}
                              onChange={(e) => setClusterEditForm({...clusterEditForm, name: e.target.value})}
                              placeholder="Enter cluster name"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                              Description
                            </label>
                            <Input
                              type="text"
                              value={clusterEditForm.description}
                              onChange={(e) => setClusterEditForm({...clusterEditForm, description: e.target.value})}
                              placeholder="Enter cluster description (optional)"
                            />
                          </div>
                          <div className="text-sm text-slate-600">
                            Endpoint: {cluster.endpoint}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              size="sm"
                              onClick={() => handleUpdateCluster(cluster.id)}
                            >
                              Save
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={cancelEditCluster}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        // Display mode
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-medium">{cluster.name}</div>
                            <div className="text-sm text-slate-600">{cluster.endpoint}</div>
                            {cluster.description && (
                              <div className="text-sm text-slate-500">{cluster.description}</div>
                            )}
                            <div className="flex items-center mt-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                cluster.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {cluster.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEditCluster(cluster)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteCluster(cluster.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Authentication Settings */}
        <div id="auth-settings" className="scroll-mt-24">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-slate-700" />
                Authentication Settings
              </CardTitle>
              <CardDescription>Configure authentication methods and access control</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateKeycloakSettings} className="space-y-6">
                {/* Authentication Method Selection */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-900">Authentication Methods</h4>
                  
                  <div className="space-y-3">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={keycloakSettings.keycloak_enabled === 'true'}
                        onChange={(e) => setKeycloakSettings({
                          ...keycloakSettings,
                          keycloak_enabled: e.target.checked ? 'true' : 'false'
                        })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Enable Keycloak Authentication</span>
                    </label>
                  </div>
                </div>

                {/* Keycloak Configuration */}
                {keycloakSettings.keycloak_enabled === 'true' && (
                  <div className="space-y-4 border-t pt-6">
                    <h4 className="text-sm font-medium text-gray-900">Keycloak Configuration</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Keycloak Server URL
                        </label>
                        <Input
                          type="url"
                          value={keycloakSettings.keycloak_server_url}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            keycloak_server_url: e.target.value
                          })}
                          placeholder="https://auth.example.com"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Realm
                        </label>
                        <Input
                          type="text"
                          value={keycloakSettings.keycloak_realm}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            keycloak_realm: e.target.value
                          })}
                          placeholder="k8s-fleet-manager"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Application Hostname
                        </label>
                        <Input
                          type="url"
                          value={keycloakSettings.app_hostname}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            app_hostname: e.target.value
                          })}
                          placeholder="https://k8s-fleet-manager.example.com"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          The full URL where this application is accessible (used for Keycloak callbacks)
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Client ID
                        </label>
                        <Input
                          type="text"
                          value={keycloakSettings.keycloak_client_id}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            keycloak_client_id: e.target.value
                          })}
                          placeholder="k8s-fleet-manager-app"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Client Secret
                        </label>
                        <Input
                          type="password"
                          value={keycloakSettings.keycloak_client_secret}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            keycloak_client_secret: e.target.value
                          })}
                          placeholder="Enter client secret"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          OAuth Scopes
                        </label>
                        <Input
                          type="text"
                          value={keycloakSettings.keycloak_scope}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            keycloak_scope: e.target.value
                          })}
                          placeholder="openid profile email"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Space-separated list of OAuth scopes to request
                        </p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Admin Group Name
                        </label>
                        <Input
                          type="text"
                          value={keycloakSettings.keycloak_admin_group}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            keycloak_admin_group: e.target.value
                          })}
                          placeholder="k8s-fleet-manager-admins"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Keycloak group name that grants admin access. Members of this group will automatically get admin permissions.
                        </p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Access Group Name
                        </label>
                        <Input
                          type="text"
                          value={keycloakSettings.keycloak_access_group}
                          onChange={(e) => setKeycloakSettings({
                            ...keycloakSettings,
                            keycloak_access_group: e.target.value
                          })}
                          placeholder="k8s-fleet-manager-users"
                          disabled={keycloakSettings.keycloak_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Keycloak group name required for access. Only users in this group can log into K8s Fleet Manager. Leave empty to allow all authenticated users.
                        </p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <input
                            type="checkbox"
                            checked={keycloakSettings.keycloak_allow_insecure_tls === 'true'}
                            onChange={(e) => setKeycloakSettings({
                              ...keycloakSettings,
                              keycloak_allow_insecure_tls: e.target.checked ? 'true' : 'false'
                            })}
                            disabled={keycloakSettings.keycloak_enabled !== 'true'}
                          />
                          Allow insecure TLS for Keycloak
                        </label>
                        <p className="text-xs text-gray-500 mt-1">
                          Emergency option: the token exchange then accepts any certificate. Prefer trusting your CA with NODE_EXTRA_CA_CERTS (see DEPLOYMENT.md).
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-4">
                  <Button type="submit">Save Authentication Settings</Button>
                  {keycloakSettings.keycloak_enabled === 'true' && (
                    <div className="text-sm text-gray-600">
                      Login URL: <code className="bg-gray-100 px-2 py-1 rounded">/api/auth/keycloak/login</code>
                    </div>
                  )}
                </div>

                {keycloakSettings.keycloak_enabled === 'true' && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h4 className="text-sm font-medium text-blue-900 mb-2">Setup Instructions:</h4>
                    <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                      <li>Create a new client in your Keycloak realm</li>
                      <li>Set the client protocol to &quot;openid-connect&quot;</li>
                      <li>Add redirect URI: <code className="bg-blue-100 px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/auth/keycloak/callback</code></li>
                      <li>Enable &quot;Client authentication&quot; and copy the client secret</li>
                      <li>Configure the scopes and user attributes as needed</li>
                    </ol>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Ollama AI Configuration */}
          <Card id="ollama-settings" className="scroll-mt-24 border-slate-200 shadow-sm mt-6">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-slate-700" />
                <span>AI Chatbot Configuration</span>
              </CardTitle>
              <CardDescription>
                Configure Ollama integration for AI-powered Kubernetes assistance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateOllamaSettings} className="space-y-6">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="ollama_enabled"
                    checked={ollamaSettings.ollama_enabled === 'true'}
                    onChange={(e) => setOllamaSettings({
                      ...ollamaSettings,
                      ollama_enabled: e.target.checked ? 'true' : 'false'
                    })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="ollama_enabled" className="text-sm font-medium text-gray-700">
                    Enable AI Chatbot
                  </label>
                </div>

                {ollamaSettings.ollama_enabled === 'true' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Ollama Server URL
                        </label>
                        <Input
                          type="url"
                          value={ollamaSettings.ollama_server_url}
                          onChange={(e) => setOllamaSettings({
                            ...ollamaSettings,
                            ollama_server_url: e.target.value
                          })}
                          placeholder="http://localhost:11434"
                          disabled={ollamaSettings.ollama_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          URL of your Ollama server instance. HTTPS URLs with self-signed certificates are supported.
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Model Name
                        </label>
                        <Input
                          type="text"
                          value={ollamaSettings.ollama_model}
                          onChange={(e) => setOllamaSettings({
                            ...ollamaSettings,
                            ollama_model: e.target.value
                          })}
                          placeholder="llama3.2"
                          disabled={ollamaSettings.ollama_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Name of the Ollama model to use
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Temperature
                        </label>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          value={ollamaSettings.ollama_temperature}
                          onChange={(e) => setOllamaSettings({
                            ...ollamaSettings,
                            ollama_temperature: e.target.value
                          })}
                          placeholder="0.7"
                          disabled={ollamaSettings.ollama_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Response creativity (0.0-1.0)
                        </p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Max Tokens
                        </label>
                        <Input
                          type="number"
                          min="1"
                          max="8192"
                          value={ollamaSettings.ollama_max_tokens}
                          onChange={(e) => setOllamaSettings({
                            ...ollamaSettings,
                            ollama_max_tokens: e.target.value
                          })}
                          placeholder="4096"
                          disabled={ollamaSettings.ollama_enabled !== 'true'}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Maximum length of AI responses
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-4">
                  <Button type="submit">Save AI Settings</Button>
                </div>

                {ollamaSettings.ollama_enabled === 'true' && (
                  <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
                    <h4 className="text-sm font-medium text-green-900 mb-2">Setup Instructions:</h4>
                    <ol className="text-sm text-green-800 space-y-1 list-decimal list-inside">
                      <li>Install Ollama on your server or local machine</li>
                      <li>Pull the desired model: <code className="bg-green-100 px-1 rounded">ollama pull {ollamaSettings.ollama_model}</code></li>
                      <li>Start the Ollama server: <code className="bg-green-100 px-1 rounded">ollama serve</code></li>
                      <li>Ensure the server URL is accessible from this application</li>
                      <li>HTTPS servers with self-signed certificates are automatically supported</li>
                      <li>The chatbot will appear on the dashboard once properly configured</li>
                    </ol>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* AI Prompts Configuration */}
          <Card id="ai-prompts-settings" className="scroll-mt-24 mb-6 border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-purple-600" />
                AI Prompts Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateAiPromptSettings} className="space-y-6">
                <div className="space-y-4">
                  <div className="text-sm text-gray-600 mb-4">
                    Customize the AI assistant&apos;s behavior by modifying the system prompts. These prompts define how the AI responds in different contexts.
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      System Prompt (Base Behavior)
                    </label>
                    <textarea
                      value={aiPromptSettings.ai_system_prompt}
                      onChange={(e) => setAiPromptSettings({
                        ...aiPromptSettings,
                        ai_system_prompt: e.target.value
                      })}
                      placeholder="Base system prompt that defines the AI's expertise and behavior..."
                      className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
                      disabled={ollamaSettings.ollama_enabled !== 'true'}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Defines the AI&apos;s core expertise and general behavior across all contexts
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Cluster Context Prompt
                    </label>
                    <textarea
                      value={aiPromptSettings.ai_cluster_context_prompt}
                      onChange={(e) => setAiPromptSettings({
                        ...aiPromptSettings,
                        ai_cluster_context_prompt: e.target.value
                      })}
                      placeholder="Additional prompt when cluster data is available..."
                      className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
                      disabled={ollamaSettings.ollama_enabled !== 'true'}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Used when the AI has access to live cluster data (on cluster details pages)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Dashboard Context Prompt
                    </label>
                    <textarea
                      value={aiPromptSettings.ai_dashboard_context_prompt}
                      onChange={(e) => setAiPromptSettings({
                        ...aiPromptSettings,
                        ai_dashboard_context_prompt: e.target.value
                      })}
                      placeholder="Prompt when user is on dashboard without cluster context..."
                      className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
                      disabled={ollamaSettings.ollama_enabled !== 'true'}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Used when the AI is on the dashboard without specific cluster data
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Cluster Redirect Message
                    </label>
                    <textarea
                      value={aiPromptSettings.ai_cluster_redirect_prompt}
                      onChange={(e) => setAiPromptSettings({
                        ...aiPromptSettings,
                        ai_cluster_redirect_prompt: e.target.value
                      })}
                      placeholder="Message shown when redirecting users to cluster details..."
                      className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
                      disabled={ollamaSettings.ollama_enabled !== 'true'}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Message displayed when users ask cluster-specific questions on the dashboard
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button 
                    type="submit"
                    disabled={ollamaSettings.ollama_enabled !== 'true'}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    Update AI Prompts
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      // Reset to default prompts
                      setAiPromptSettings({
                        ai_system_prompt: 'You are a helpful Kubernetes expert assistant. You have deep knowledge of Kubernetes concepts, troubleshooting, best practices, and operations. You can help with:\n\n- Kubernetes cluster management and troubleshooting\n- Pod, Service, Deployment, and other resource management\n- YAML configuration and best practices\n- Security and RBAC configurations\n- Monitoring and observability\n- Performance optimization\n- Networking and ingress\n- Storage and persistent volumes\n- CI/CD and GitOps practices\n- Talos Linux specific configurations and maintenance\n\nPlease provide accurate, helpful, and actionable advice. Keep responses concise but thorough. Use markdown formatting for code examples and structured information.',
                        ai_cluster_context_prompt: 'You currently have direct access to live cluster data including:\n- Real-time node status and resource usage\n- Pod health and deployment status\n- Cluster events and logs\n- Storage and networking configurations\n- Backup status (Velero)\n- Talos system information\n\nUse this live data to provide specific, actionable advice for the current cluster state. When discussing specific issues, always refer to the actual cluster context and data provided.',
                        ai_dashboard_context_prompt: 'You are currently on the dashboard without access to specific cluster data. For cluster-specific questions requiring live data, diagnostics, or troubleshooting, users should navigate to the individual cluster details page where you can access real-time cluster information.\n\nFocus on providing general Kubernetes knowledge, best practices, and conceptual guidance. For cluster-specific diagnostics, recommend users visit the cluster details page.',
                        ai_cluster_redirect_prompt: 'I see you\'re asking about cluster-specific information! For the best assistance with cluster details, please navigate to the specific cluster page where I\'ll have access to real-time data.\n\nFrom the cluster details page, I can provide:\n• Real-time node and pod status\n• Live resource usage and metrics\n• Recent events and error analysis\n• Deployment and service health checks\n• Backup status and storage information\n• Specific troubleshooting for that cluster\n\nFor general Kubernetes questions without cluster context, I\'m happy to help here on the dashboard!'
                      })
                    }}
                    disabled={ollamaSettings.ollama_enabled !== 'true'}
                  >
                    Reset to Defaults
                  </Button>
                </div>

                {ollamaSettings.ollama_enabled !== 'true' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-amber-800">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="font-medium">AI Assistant Disabled</span>
                    </div>
                    <p className="text-amber-700 mt-1 text-sm">
                      Enable the AI Assistant above to configure prompts
                    </p>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Antrea Flow Configuration */}
          <Card id="antrea-settings" className="scroll-mt-24 border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Network className="h-5 w-5 text-slate-700" />
                <span>Antrea Flow Configuration</span>
              </CardTitle>
              <CardDescription>
                Configure external Antrea flow API to show real Allow/Drop traffic in network topology
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateAntreaSettings} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Antrea Flow API URL
                    </label>
                    <Input
                      type="url"
                      value={antreaSettings.antrea_flow_api_url}
                      onChange={(e) => setAntreaSettings({
                        ...antreaSettings,
                        antrea_flow_api_url: e.target.value
                      })}
                      placeholder="https://flow-aggregator.example/api/flows?cluster={clusterId}"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Supports <code className="bg-gray-100 px-1 rounded">{'{clusterId}'}</code> placeholder. Namespace and window query params are added automatically.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Antrea Flow API Token (Optional)
                    </label>
                    <Input
                      type="password"
                      value={antreaSettings.antrea_flow_api_token}
                      onChange={(e) => setAntreaSettings({
                        ...antreaSettings,
                        antrea_flow_api_token: e.target.value
                      })}
                      placeholder="Bearer token"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      If set, K8s Fleet Manager sends this as an Authorization Bearer token to the flow API.
                    </p>
                  </div>
                </div>

                <Button type="submit" className="w-full">
                  Save Antrea Flow Settings
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card id="nexus-settings" className="scroll-mt-24 border-slate-200 shadow-sm mt-6">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Package className="h-5 w-5 text-slate-700" />
                <span>Nexus Image Update Source</span>
              </CardTitle>
              <CardDescription>
                Optional Nexus server for image update checks. When set, the “Check for Updates” button uses Nexus first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateNexusSettings} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nexus Server URL
                  </label>
                  <Input
                    type="url"
                    value={nexusSettings.nexus_server_url}
                    onChange={(e) => setNexusSettings({
                      ...nexusSettings,
                      nexus_server_url: e.target.value
                    })}
                    placeholder="https://nexus.example.com/repository/docker-proxy"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leave empty to use default public registry checks.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nexus Username
                    </label>
                    <Input
                      type="text"
                      value={nexusSettings.nexus_username}
                      onChange={(e) => setNexusSettings({
                        ...nexusSettings,
                        nexus_username: e.target.value
                      })}
                      placeholder="nexus-user"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nexus Password
                    </label>
                    <Input
                      type="password"
                      value={nexusSettings.nexus_password}
                      onChange={(e) => setNexusSettings({
                        ...nexusSettings,
                        nexus_password: e.target.value
                      })}
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={nexusSettings.nexus_allow_insecure_tls === 'true'}
                      onChange={(e) => setNexusSettings({
                        ...nexusSettings,
                        nexus_allow_insecure_tls: e.target.checked ? 'true' : 'false'
                      })}
                    />
                    Allow insecure TLS for Nexus
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    Use only for self-signed or untrusted Nexus certificates.
                  </p>
                </div>

                <Button type="submit" className="w-full">
                  Save Nexus Settings
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card id="history-settings" className="scroll-mt-24 border-slate-200 shadow-sm mt-6">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <History className="h-5 w-5 text-slate-700" />
                <span>Health History</span>
              </CardTitle>
              <CardDescription>
                A health sample of every cluster is stored in the background for availability and trends on the cluster page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateHistorySettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sample interval (minutes)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={historySettings.history_interval_minutes}
                      onChange={(e) => setHistorySettings({
                        ...historySettings,
                        history_interval_minutes: e.target.value
                      })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Keep history (days)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={historySettings.history_retention_days}
                      onChange={(e) => setHistorySettings({
                        ...historySettings,
                        history_retention_days: e.target.value
                      })}
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full">
                  Save History Settings
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}