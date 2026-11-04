import { cn } from '@/lib/utils'

export default function Logo({ className }: { className?: string }) {
  return (
    <svg className={cn('text-orange-400', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 2 3 7v10l9 5 9-5V7z" />
      <path d="M12 22V12M3 7l9 5 9-5" />
    </svg>
  )
}
