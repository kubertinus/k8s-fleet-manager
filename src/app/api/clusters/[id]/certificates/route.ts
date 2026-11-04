import { NextRequest, NextResponse } from 'next/server'
import { KubernetesClient } from '@/lib/kubernetes'
import { query } from '@/lib/database'

const isPostgresTlsSecretCertificate = (cert: any): boolean => {
  const secretName = (cert?.name || '').toLowerCase()
  const certField = (cert?.certField || '').toLowerCase()
  const isCnpgSecret = secretName.startsWith('cnpg') || secretName.startsWith('cnpg-')
  const hasPostgresInName = secretName.includes('postgres')
  const looksLikeCertificate =
    certField === 'tls.crt' ||
    certField === 'ca.crt' ||
    certField === 'cert.crt' ||
    certField === 'cert.pem' ||
    certField === 'tls.pem' ||
    certField === 'certificate' ||
    secretName.endsWith('/tls.crt') ||
    secretName.endsWith('/ca.crt') ||
    secretName.endsWith('/cert.crt') ||
    secretName.endsWith('/cert.pem') ||
    secretName.endsWith('/tls.pem') ||
    secretName.endsWith('/certificate')

  return (isCnpgSecret || hasPostgresInName) && looksLikeCertificate
}

const getEffectiveCertificateStatus = (cert: any, isPostgresTlsSecret: boolean): string => {
  const daysUntilExpiry = typeof cert?.daysUntilExpiry === 'number' ? cert.daysUntilExpiry : null

  if (daysUntilExpiry === null) {
    return cert?.status || 'unknown'
  }

  if (daysUntilExpiry < 0) {
    return 'expired'
  }

  if (isPostgresTlsSecret) {
    if (daysUntilExpiry <= 3) {
      return 'critical'
    }

    if (daysUntilExpiry <= 6) {
      return 'warning'
    }

    return 'valid'
  }

  if (daysUntilExpiry <= 10) {
    return 'critical'
  }

  if (daysUntilExpiry <= 30) {
    return 'warning'
  }

  return 'valid'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    const client = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)

    // Get ALL certificates in the cluster
    const certificates = await client.getAllCertificates()
    const normalizedCertificates = certificates.map((cert: any) => {
      const isPostgresTlsSecret = isPostgresTlsSecretCertificate(cert)
      const effectiveStatus = getEffectiveCertificateStatus(cert, isPostgresTlsSecret)

      return {
        ...cert,
        isCnpgPostgres: isPostgresTlsSecret,
        status: effectiveStatus
      }
    })

    const cnpgCertificates = normalizedCertificates.filter((cert: any) => cert.isCnpgPostgres)
    const cnpgCriticalCertificates = cnpgCertificates.filter((cert: any) => cert.status === 'critical').length
    const cnpgWarningCertificates = cnpgCertificates.filter((cert: any) => cert.status === 'warning').length

    return NextResponse.json({
      clusterId,
      clusterName: cluster.name,
      certificates: normalizedCertificates,
      totalCertificates: normalizedCertificates.length,
      expiredCertificates: normalizedCertificates.filter((cert: any) => cert.status === 'expired').length,
      criticalCertificates: normalizedCertificates.filter((cert: any) => cert.status === 'critical').length,
      warningCertificates: normalizedCertificates.filter((cert: any) => cert.status === 'warning').length,
      validCertificates: normalizedCertificates.filter((cert: any) => cert.status === 'valid').length,
      cnpgCriticalCertificates,
      cnpgWarningCertificates
    })

  } catch (error) {
    console.error('Error fetching certificates:', error)
    return NextResponse.json(
      { error: 'Failed to fetch certificates' },
      { status: 500 }
    )
  }
}