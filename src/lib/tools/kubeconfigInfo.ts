import { parse } from 'yaml'
import { describeCertificate, type CertificateInfo } from './x509'

// Metadata of a stored kubeconfig: endpoint, authentication type and the expiry
// of its certificates. Never returns the credentials themselves.

export interface KubeconfigSummary {
  id: number
  name: string
  endpoint: string | null
  context: string | null
  user: string | null
  authType: 'client-certificate' | 'token' | 'exec' | 'auth-provider' | 'basic' | 'unknown'
  clientCertificate: CertificateInfo | null
  certificateAuthority: CertificateInfo | null
  error: string | null
}

function decodeCert(base64?: string): CertificateInfo | null {
  if (!base64) return null
  return describeCertificate(Buffer.from(base64, 'base64'))
}

export function summarizeKubeconfig(cluster: { id: number; name: string; kubeconfig: string }): KubeconfigSummary {
  const base: KubeconfigSummary = {
    id: cluster.id,
    name: cluster.name,
    endpoint: null,
    context: null,
    user: null,
    authType: 'unknown',
    clientCertificate: null,
    certificateAuthority: null,
    error: null,
  }
  try {
    const config = parse(cluster.kubeconfig)
    const contextName = config['current-context'] ?? config.contexts?.[0]?.name
    const context = config.contexts?.find((c: any) => c.name === contextName)?.context
    const clusterEntry = config.clusters?.find((c: any) => c.name === context?.cluster)?.cluster
    const userEntry = config.users?.find((u: any) => u.name === context?.user)?.user ?? {}

    let authType: KubeconfigSummary['authType'] = 'unknown'
    if (userEntry['client-certificate-data'] || userEntry['client-certificate']) authType = 'client-certificate'
    else if (userEntry.token || userEntry.tokenFile) authType = 'token'
    else if (userEntry.exec) authType = 'exec'
    else if (userEntry['auth-provider']) authType = 'auth-provider'
    else if (userEntry.username) authType = 'basic'

    return {
      ...base,
      endpoint: clusterEntry?.server ?? null,
      context: contextName ?? null,
      user: context?.user ?? null,
      authType,
      clientCertificate: decodeCert(userEntry['client-certificate-data']),
      certificateAuthority: decodeCert(clusterEntry?.['certificate-authority-data']),
    }
  } catch (error: any) {
    return { ...base, error: `Could not read kubeconfig: ${error.message}` }
  }
}
