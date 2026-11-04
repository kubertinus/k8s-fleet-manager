import type { PoolClient } from 'pg'
import { getPool, initializeDatabase } from '@/lib/database'
import { collectWorkloadImages, type WorkloadImage } from './inventory'
import { parseImageReference, type ImageReference } from './reference'
import { listTags, publicEndpoint, RegistryError, type RegistryEndpoint } from './registry'
import { findNewerVersion, isVersionTag, type UpdateType } from './versions'

// Image report scan: collects all workload images of every active cluster and
// checks each unique image for a newer version, on Nexus when configured and
// otherwise (or when Nexus doesn't know the image) on the image's own registry.

export type ImageStatus = 'update' | 'current' | 'unversioned' | 'pinned' | 'error'

export interface ImageVersionResult extends ImageReference {
  status: ImageStatus
  latestVersion?: string
  updateType?: UpdateType
  latestInMajor?: string
  source?: 'nexus' | 'online'
  error?: string
  // The error looked temporary (timeout, rate limit, 5xx): try again later in the scan
  retryable?: boolean
}

// Arbitrary, fixed key for pg_try_advisory_lock so only one full scan runs at a time,
// also across replicas.
const SCAN_LOCK_KEY = 727_001
const CLUSTER_CONCURRENCY = 3
const VERSION_CONCURRENCY = 6
// Images that still failed after a full round get one more, quieter try
const RETRY_ROUND_DELAY_MS = 5000
const RETRY_ROUND_CONCURRENCY = 2
const INSERT_CHUNK = 500

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) await worker(queue.shift()!)
    })
  )
}

async function nexusEndpoint(): Promise<RegistryEndpoint | null> {
  const result = await getPool().query('SELECT key, value FROM settings WHERE key = ANY($1)', [
    ['nexus_server_url', 'nexus_allow_insecure_tls', 'nexus_username', 'nexus_password'],
  ])
  const settings = Object.fromEntries(result.rows.map((row: any) => [row.key, row.value]))
  const baseUrl = (settings.nexus_server_url || '').trim()
  if (!baseUrl) return null
  return {
    baseUrl,
    username: (settings.nexus_username || '').trim() || undefined,
    password: settings.nexus_password || undefined,
    insecureTls: settings.nexus_allow_insecure_tls === 'true',
  }
}

// Docker Hub answers 401 instead of 404 for repositories that don't exist.
function describeOnlineError(error: any) {
  if (error instanceof RegistryError && (error.status === 401 || error.status === 404)) {
    return 'repository not found or not accessible'
  }
  return error?.message || String(error)
}

// Tag lists are shared between images of the same repository within one check round.
export type TagLookup = (ref: ImageReference) => Promise<{ tags: string[]; source: 'nexus' | 'online' }>

function createTagLookup(nexus: RegistryEndpoint | null): TagLookup {
  const cache = new Map<string, Promise<{ tags: string[]; source: 'nexus' | 'online' }>>()

  const lookup = async (ref: ImageReference) => {
    let nexusError: string | undefined
    let nexusTransient = false
    if (nexus) {
      try {
        return { tags: await listTags(nexus, ref.repository), source: 'nexus' as const }
      } catch (error: any) {
        // Not on Nexus (or not reachable): fall back to the public registry
        nexusError = error?.message || String(error)
        nexusTransient = error instanceof RegistryError && error.transient
      }
    }
    try {
      // With Nexus the public registry is only a fallback, often unreachable (no
      // internet): don't spend retries on it
      return { tags: await listTags(publicEndpoint(ref.registry), ref.repository, nexus ? { retries: 0 } : {}), source: 'online' as const }
    } catch (error: any) {
      const onlineError = describeOnlineError(error)
      // Report both attempts so a misconfigured Nexus is visible in the report
      const failure: Error & { transient?: boolean } = new Error(nexusError ? `Nexus: ${nexusError} · Online: ${onlineError}` : onlineError)
      // Worth another try when the source that should have answered failed temporarily
      failure.transient = nexus ? nexusTransient : error instanceof RegistryError && error.transient
      throw failure
    }
  }

  return ref => {
    const key = `${ref.registry}/${ref.repository}`
    if (!cache.has(key)) {
      const promise = lookup(ref)
      promise.catch(() => cache.delete(key))
      cache.set(key, promise)
    }
    return cache.get(key)!
  }
}

// Tag lookup through Nexus when configured, else the public registry
export async function createDefaultTagLookup(): Promise<TagLookup> {
  return createTagLookup(await nexusEndpoint())
}

async function checkImage(raw: string, lookup: TagLookup): Promise<ImageVersionResult> {
  const ref = parseImageReference(raw)
  if (!ref.tag) return { ...ref, status: 'pinned' }
  if (!isVersionTag(ref.tag)) return { ...ref, status: 'unversioned' }
  try {
    const { tags, source } = await lookup(ref)
    const newer = findNewerVersion(ref.tag, tags)
    return newer
      ? { ...ref, status: 'update', latestVersion: newer.latest, updateType: newer.type, latestInMajor: newer.latestInMajor, source }
      : { ...ref, status: 'current', latestVersion: ref.tag, source }
  } catch (error: any) {
    return { ...ref, status: 'error', error: error?.message || 'Version check failed', retryable: error?.transient === true }
  }
}

async function saveVersions(results: ImageVersionResult[]) {
  const pool = getPool()
  for (const r of results) {
    await pool.query(
      `INSERT INTO image_versions (image, registry, repository, tag, digest, status, latest_version, update_type, latest_in_major, source, error, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (image) DO UPDATE SET
         registry = EXCLUDED.registry, repository = EXCLUDED.repository, tag = EXCLUDED.tag, digest = EXCLUDED.digest,
         status = EXCLUDED.status, latest_version = EXCLUDED.latest_version, update_type = EXCLUDED.update_type,
         latest_in_major = EXCLUDED.latest_in_major,
         source = EXCLUDED.source, error = EXCLUDED.error, checked_at = EXCLUDED.checked_at`,
      [r.image, r.registry, r.repository, r.tag ?? null, r.digest ?? null, r.status, r.latestVersion ?? null, r.updateType ?? null, r.latestInMajor ?? null, r.source ?? null, r.error ?? null]
    )
  }
}

async function checkImages(images: string[]): Promise<ImageVersionResult[]> {
  const lookup = createTagLookup(await nexusEndpoint())
  const results: ImageVersionResult[] = []
  await runPool(images, VERSION_CONCURRENCY, async image => {
    results.push(await checkImage(image, lookup))
  })

  // Failed lookups are not cached, so this asks the registry again
  const failed = results.filter(r => r.status === 'error' && r.retryable)
  if (failed.length > 0) {
    await new Promise(resolve => setTimeout(resolve, RETRY_ROUND_DELAY_MS))
    await runPool(failed, RETRY_ROUND_CONCURRENCY, async previous => {
      const retried = await checkImage(previous.image, lookup)
      results[results.indexOf(previous)] = retried
    })
    const recovered = failed.length - results.filter(r => r.status === 'error' && failed.some(f => f.image === r.image)).length
    console.log(`[image-scan] retried ${failed.length} failed image(s), ${recovered} recovered`)
  }

  await saveVersions(results)
  return results
}

// Re-run the version check for a selection of images (from the report page).
export async function recheckImages(images: string[]): Promise<ImageVersionResult[]> {
  await initializeDatabase()
  const unique = Array.from(new Set(images.map(image => parseImageReference(image).image)))
  return checkImages(unique)
}

async function replaceClusterWorkloads(client: PoolClient, clusterId: number, rows: WorkloadImage[]) {
  await client.query('BEGIN')
  try {
    await client.query('DELETE FROM image_workloads WHERE cluster_id = $1', [clusterId])
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK)
      const values: unknown[] = []
      const placeholders = chunk.map((row, j) => {
        values.push(clusterId, row.namespace, row.kind, row.name, row.container, row.initContainer, parseImageReference(row.image).image, row.customerManaged)
        const o = j * 8
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`
      })
      await client.query(
        `INSERT INTO image_workloads (cluster_id, namespace, kind, name, container, init_container, image, customer_managed) VALUES ${placeholders.join(', ')}`,
        values
      )
    }
    await client.query(
      `INSERT INTO image_cluster_scans (cluster_id, scanned_at, attempted_at, error) VALUES ($1, NOW(), NOW(), NULL)
       ON CONFLICT (cluster_id) DO UPDATE SET scanned_at = NOW(), attempted_at = NOW(), error = NULL`,
      [clusterId]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export async function isScanRunning(): Promise<boolean> {
  const result = await getPool().query("SELECT 1 FROM image_scan_runs WHERE status = 'running' LIMIT 1")
  return result.rows.length > 0
}

// Full scan. Returns the run id, or null when another scan already holds the lock.
// `onStarted` fires once the run row exists, so callers can respond without waiting for the scan.
export async function runImageScan(
  trigger: 'scheduled' | 'manual',
  { scheduledFor, onStarted }: { scheduledFor?: string; onStarted?: (runId: number) => void } = {}
): Promise<number | null> {
  await initializeDatabase()
  const pool = getPool()
  const lockClient = await pool.connect()
  let runId: number | null = null

  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [SCAN_LOCK_KEY])
    if (!lock.rows[0].locked) return null

    // Holding the lock means no scan is really running: older 'running' rows were interrupted.
    await lockClient.query(
      "UPDATE image_scan_runs SET status = 'failed', finished_at = NOW(), error = 'Interrupted (application restarted)' WHERE status = 'running'"
    )

    const run = await lockClient.query(
      "INSERT INTO image_scan_runs (trigger, scheduled_for, status) VALUES ($1, $2, 'running') RETURNING id",
      [trigger, scheduledFor ?? null]
    )
    runId = run.rows[0].id as number
    onStarted?.(runId)
    console.log(`[image-scan] run ${runId} started (${trigger})`)

    // 1. Inventory per cluster. A failing cluster keeps its previous inventory.
    const clusters = (await pool.query('SELECT id, name, kubeconfig FROM clusters WHERE is_active = true ORDER BY name')).rows
    let failed = 0
    await runPool(clusters, CLUSTER_CONCURRENCY, async cluster => {
      try {
        const rows = await collectWorkloadImages(cluster.kubeconfig)
        const client = await pool.connect()
        try {
          await replaceClusterWorkloads(client, cluster.id, rows)
        } finally {
          client.release()
        }
        console.log(`[image-scan] ${cluster.name}: ${rows.length} containers`)
      } catch (error: any) {
        failed++
        console.error(`[image-scan] ${cluster.name} failed:`, error?.message || error)
        await pool.query(
          `INSERT INTO image_cluster_scans (cluster_id, attempted_at, error) VALUES ($1, NOW(), $2)
           ON CONFLICT (cluster_id) DO UPDATE SET attempted_at = NOW(), error = EXCLUDED.error`,
          [cluster.id, error?.message || String(error)]
        )
      }
    })

    // 2. Version check for every image still in use; forget images nobody uses any more.
    await pool.query('DELETE FROM image_workloads WHERE cluster_id NOT IN (SELECT id FROM clusters WHERE is_active = true)')
    const images = (await pool.query('SELECT DISTINCT image FROM image_workloads')).rows.map((row: any) => row.image as string)
    const results = await checkImages(images)
    await pool.query('DELETE FROM image_versions WHERE image NOT IN (SELECT DISTINCT image FROM image_workloads)')

    const workloads = await pool.query('SELECT COUNT(DISTINCT (cluster_id, namespace, kind, name)) AS count FROM image_workloads')
    await pool.query(
      `UPDATE image_scan_runs SET status = 'completed', finished_at = NOW(), clusters_total = $2, clusters_failed = $3,
         workloads_total = $4, images_total = $5, updates_found = $6 WHERE id = $1`,
      [runId, clusters.length, failed, Number(workloads.rows[0].count), images.length, results.filter(r => r.status === 'update').length]
    )
    console.log(`[image-scan] run ${runId} completed: ${images.length} images, ${failed} cluster(s) failed`)
    return runId
  } catch (error: any) {
    console.error('[image-scan] run failed:', error)
    // Failed before a run was recorded: let the caller see the error (null means "already running")
    if (runId === null) throw error
    await pool
      .query("UPDATE image_scan_runs SET status = 'failed', finished_at = NOW(), error = $2 WHERE id = $1", [runId, error?.message || String(error)])
      .catch(() => {})
    return runId
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [SCAN_LOCK_KEY]).catch(() => {})
    lockClient.release()
  }
}
