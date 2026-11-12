import { NextRequest, NextResponse } from 'next/server'
import { getPool, initializeDatabase } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { displayRepository } from '@/lib/images/reference'
import { getSchedule, nextRunAt } from '@/lib/images/scheduler'

// Image report: every image in use, its version status and where it is used.
export async function GET(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  const user = token ? verifyToken(token) : null
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await initializeDatabase()
    const pool = getPool()

    const [usages, versions, clusters, runs, schedule] = await Promise.all([
      pool.query(`
        SELECT w.image, w.cluster_id, c.name AS cluster_name, w.namespace, w.kind, w.name, w.container, w.init_container, w.customer_managed
        FROM image_workloads w JOIN clusters c ON c.id = w.cluster_id
        WHERE c.is_active = true
        ORDER BY c.name, w.namespace, w.kind, w.name, w.container
      `),
      pool.query('SELECT * FROM image_versions'),
      pool.query(`
        SELECT c.id, c.name, s.scanned_at, s.attempted_at, s.error
        FROM clusters c LEFT JOIN image_cluster_scans s ON s.cluster_id = c.id
        WHERE c.is_active = true ORDER BY c.name
      `),
      pool.query(`
        (SELECT * FROM image_scan_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1)
        UNION ALL
        (SELECT * FROM image_scan_runs WHERE status <> 'running' ORDER BY started_at DESC LIMIT 1)
      `),
      getSchedule(),
    ])

    const versionByImage = new Map(versions.rows.map((row: any) => [row.image, row]))
    const images = new Map<string, any>()
    for (const row of usages.rows) {
      let entry = images.get(row.image)
      if (!entry) {
        const v: any = versionByImage.get(row.image)
        const [nameAndTag, digest] = row.image.split('@')
        const slash = nameAndTag.indexOf('/')
        const registry = v?.registry ?? nameAndTag.slice(0, slash)
        const repoAndTag = nameAndTag.slice(slash + 1)
        const colon = repoAndTag.lastIndexOf(':')
        const repository = v?.repository ?? (colon === -1 ? repoAndTag : repoAndTag.slice(0, colon))
        entry = {
          image: row.image,
          registry,
          repository,
          name: displayRepository(registry, repository),
          tag: v?.tag ?? (colon === -1 ? null : repoAndTag.slice(colon + 1)),
          digest: v?.digest ?? digest ?? null,
          // Inventory is done but the version check hasn't run for this image yet
          status: v?.status ?? 'pending',
          latestVersion: v?.latest_version ?? null,
          updateType: v?.update_type ?? null,
          latestInMajor: v?.latest_in_major ?? null,
          source: v?.source ?? null,
          error: v?.error ?? null,
          checkedAt: v?.checked_at ?? null,
          cveSeverity: v?.cve_severity ?? null,
          cveCritical: v?.cve_critical ?? null,
          cveHigh: v?.cve_high ?? null,
          cveMedium: v?.cve_medium ?? null,
          cveLow: v?.cve_low ?? null,
          cveTotal: v?.cve_total ?? null,
          cveFixable: v?.cve_fixable ?? null,
          cveScannedAt: v?.cve_scanned_at ?? null,
          cveError: v?.cve_error ?? null,
          usages: [],
        }
        images.set(row.image, entry)
      }
      entry.usages.push({
        clusterId: row.cluster_id,
        clusterName: row.cluster_name,
        namespace: row.namespace,
        kind: row.kind,
        workload: row.name,
        container: row.container,
        initContainer: row.init_container,
        customerManaged: row.customer_managed,
      })
    }

    const running = runs.rows.find((r: any) => r.status === 'running') ?? null
    const lastRun = runs.rows.find((r: any) => r.status !== 'running') ?? null
    const next = nextRunAt(schedule)

    return NextResponse.json(
      {
        images: Array.from(images.values()),
        clusters: clusters.rows.map((c: any) => ({ id: c.id, name: c.name, scannedAt: c.scanned_at, attemptedAt: c.attempted_at, error: c.error })),
        running,
        lastRun,
        schedule: { ...schedule, nextRunAt: next?.toISOString() ?? null },
        canEditSchedule: user.role === 'admin',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('Error building image report:', error)
    return NextResponse.json({ error: 'Failed to load image report' }, { status: 500 })
  }
}
