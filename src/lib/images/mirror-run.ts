import { getPool, initializeDatabase } from '@/lib/database'
import { loadHarborMirrorSettings, mirrorImage } from './harbor'

// One pull at a time. The browser only starts it; the copy keeps going if that request ends.
let active = false
let reconciled = false

// A restart drops the in-memory run but leaves its row on "running". The first report
// load after startup marks that row failed. Later loads must not touch a live pull.
export async function reconcileMirrorRun() {
  if (reconciled || active) return
  reconciled = true
  await getPool().query(
    "UPDATE image_mirror_runs SET status = 'failed', finished_at = NOW(), error = 'Interrupted (application restarted)' WHERE status = 'running' AND started_at < NOW() - INTERVAL '15 seconds'"
  )
}

export async function startImageMirror(images: string[]): Promise<number | null> {
  await initializeDatabase()
  if (active) return null
  active = true
  const pool = getPool()
  try {
    await pool.query(
      "UPDATE image_mirror_runs SET status = 'failed', finished_at = NOW(), error = 'Interrupted (application restarted)' WHERE status = 'running'"
    )
    const inserted = await pool.query(
      "INSERT INTO image_mirror_runs (status) VALUES ('running') RETURNING id"
    )
    const id = inserted.rows[0].id as number
    void runImageMirror(id, images).finally(() => {
      active = false
    })
    return id
  } catch (error) {
    active = false
    throw error
  }
}

async function runImageMirror(id: number, images: string[]) {
  const pool = getPool()
  try {
    const settings = await loadHarborMirrorSettings()
    const unique = Array.from(new Set(images))
    const versions = await pool.query(
      'SELECT image, registry, repository, status, latest_version FROM image_versions WHERE image = ANY($1)',
      [unique]
    )
    const byImage = new Map(versions.rows.map((row: any) => [row.image, row]))
    const failed: { image: string; error: string }[] = []
    let mirrored = 0
    for (const image of unique) {
      const row = byImage.get(image)
      if (!row || row.status !== 'update' || !row.latest_version) continue
      const tagged = `${row.registry}/${row.repository}:${row.latest_version}`
      try {
        const result = await mirrorImage(settings, tagged)
        mirrored++
        console.log(`[image-mirror] ${tagged} -> ${result.target}`)
      } catch (error: any) {
        failed.push({ image, error: error?.message || 'Mirror failed' })
        console.error(`[image-mirror] ${tagged} failed:`, error?.message || error)
      }
    }
    const summary = `Pulled ${mirrored} image${mirrored === 1 ? '' : 's'} to Harbor.`
    const detail = failed.length ? `${summary} ${failed.length} failed: ${failed.map(item => `${item.image} (${item.error})`).join('; ')}` : summary
    await pool.query(
      "UPDATE image_mirror_runs SET status = 'completed', finished_at = NOW(), mirrored = $2, failed = $3, error = $4 WHERE id = $1",
      [id, mirrored, failed.length, detail]
    )
  } catch (error: any) {
    await pool.query(
      "UPDATE image_mirror_runs SET status = 'failed', finished_at = NOW(), error = $2 WHERE id = $1",
      [id, error?.message || 'Failed to pull images to Harbor']
    )
  }
}
