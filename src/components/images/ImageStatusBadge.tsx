import { cn } from '@/lib/utils'
import type { ReportImage } from './types'

const updateLabel = { major: 'Major update', minor: 'Minor update', patch: 'Patch update' }
const updateClass = { major: 'badge-err', minor: 'badge-warn', patch: 'badge-info' }

export default function ImageStatusBadge({ image }: { image: ReportImage }) {
  switch (image.status) {
    case 'update': {
      const type = image.updateType ?? 'minor'
      return <span className={cn('badge', updateClass[type])}>{updateLabel[type]}</span>
    }
    case 'current':
      return <span className="badge badge-ok">Up to date</span>
    case 'unversioned':
      return (
        <span className="badge badge-muted" title="The tag is not a version number (e.g. latest), so it can't be compared">
          Not versioned
        </span>
      )
    case 'pinned':
      return (
        <span className="badge badge-muted" title="Referenced by digest only, so there is no tag to compare">
          Digest pinned
        </span>
      )
    case 'error':
      return (
        <span className="badge badge-err" title={image.error ?? undefined}>
          Check failed
        </span>
      )
    default:
      return <span className="badge badge-muted">Not checked yet</span>
  }
}
