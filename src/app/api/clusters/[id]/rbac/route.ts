import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { query } from '@/lib/database'
import * as k8s from '@kubernetes/client-node'

const getResponseBody = (response: any) => response?.body ?? response ?? {}
const getItems = (response: any) => {
  const body = getResponseBody(response)
  return Array.isArray(body.items) ? body.items : []
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const token = request.cookies.get('auth-token')?.value
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await params
    const clusterId = parseInt(resolvedParams.id)
    if (isNaN(clusterId)) {
      return NextResponse.json({ error: 'Invalid cluster ID' }, { status: 400 })
    }

    // Get cluster from database
    const clusterResult = await query(
      'SELECT * FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    )
    
    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }
    
    const cluster = clusterResult.rows[0]
    
    // Initialize Kubernetes client
    const kc = new k8s.KubeConfig()
    kc.loadFromString(cluster.kubeconfig)
    
    const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api)
    const coreApi = kc.makeApiClient(k8s.CoreV1Api)

    // Fetch ClusterRoleBindings
    const clusterRoleBindingsResponse = await rbacApi.listClusterRoleBinding()
    const clusterRoleBindings = getItems(clusterRoleBindingsResponse).map((crb: any) => ({
      name: crb.metadata?.name || 'Unknown',
      roleRef: {
        kind: crb.roleRef?.kind || 'Unknown',
        name: crb.roleRef?.name || 'Unknown',
        apiGroup: crb.roleRef?.apiGroup || ''
      },
      subjects: crb.subjects?.map((subject: any) => ({
        kind: subject.kind,
        name: subject.name,
        namespace: subject.namespace,
        apiGroup: subject.apiGroup
      })) || [],
      createdAt: crb.metadata?.creationTimestamp || new Date().toISOString()
    }))

    // Fetch RoleBindings from all namespaces
    const roleBindingsResponse = await rbacApi.listRoleBindingForAllNamespaces()
    const roleBindings = getItems(roleBindingsResponse).map((rb: any) => ({
      name: rb.metadata?.name || 'Unknown',
      namespace: rb.metadata?.namespace || 'default',
      roleRef: {
        kind: rb.roleRef?.kind || 'Unknown',
        name: rb.roleRef?.name || 'Unknown',
        apiGroup: rb.roleRef?.apiGroup || ''
      },
      subjects: rb.subjects?.map((subject: any) => ({
        kind: subject.kind,
        name: subject.name,
        namespace: subject.namespace,
        apiGroup: subject.apiGroup
      })) || [],
      createdAt: rb.metadata?.creationTimestamp || new Date().toISOString()
    }))

    // Fetch ServiceAccounts from all namespaces
    const serviceAccountsResponse = await coreApi.listServiceAccountForAllNamespaces()
    const serviceAccounts = getItems(serviceAccountsResponse).map((sa: any) => ({
      name: sa.metadata?.name || 'Unknown',
      namespace: sa.metadata?.namespace || 'default',
      secrets: sa.secrets?.map((secret: any) => ({
        name: secret.name,
        namespace: secret.namespace
      })) || [],
      createdAt: sa.metadata?.creationTimestamp || new Date().toISOString()
    }))

    // Fetch ClusterRoles and Roles for permission details
    const clusterRolesResponse = await rbacApi.listClusterRole()
    const clusterRoles: { [key: string]: any } = {}
    getItems(clusterRolesResponse).forEach((cr: any) => {
      if (cr.metadata?.name) {
        clusterRoles[cr.metadata.name] = {
          name: cr.metadata.name,
          rules: cr.rules || []
        }
      }
    })

    const rolesResponse = await rbacApi.listRoleForAllNamespaces()
    const roles: { [key: string]: any } = {}
    getItems(rolesResponse).forEach((role: any) => {
      if (role.metadata?.name && role.metadata?.namespace) {
        const key = `${role.metadata.namespace}/${role.metadata.name}`
        roles[key] = {
          name: role.metadata.name,
          namespace: role.metadata.namespace,
          rules: role.rules || []
        }
      }
    })

    return NextResponse.json({
      clusterRoleBindings,
      roleBindings,
      serviceAccounts,
      clusterRoles,
      roles,
      summary: {
        totalClusterRoleBindings: clusterRoleBindings.length,
        totalRoleBindings: roleBindings.length,
        totalServiceAccounts: serviceAccounts.length,
        totalClusterRoles: Object.keys(clusterRoles).length,
        totalRoles: Object.keys(roles).length
      }
    })

  } catch (error: any) {
    console.error('Error fetching RBAC data:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch RBAC data',
        details: error.message 
      },
      { status: 500 }
    )
  }
}
