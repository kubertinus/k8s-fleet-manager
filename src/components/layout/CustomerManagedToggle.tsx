'use client'

import { EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setHideCustomerManaged, useHideCustomerManaged } from '@/lib/useHideCustomerManaged'

// Global switch: hide everything in namespaces labelled customer_managed=yes.
export default function CustomerManagedToggle() {
  const hide = useHideCustomerManaged()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={hide}
      onClick={() => setHideCustomerManaged(!hide)}
      title={hide ? 'Customer-managed namespaces are hidden. Click to show them.' : 'Hide everything in namespaces labelled customer_managed=yes'}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm transition-colors',
        hide ? 'border-orange-500/40 bg-orange-500/10 text-orange-200' : 'border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white'
      )}
    >
      <EyeOff className="h-4 w-4" />
      <span className="hidden lg:inline">Hide customer managed</span>
      <span className={cn('relative h-4 w-7 rounded-full transition-colors', hide ? 'bg-orange-500' : 'bg-slate-700')}>
        <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', hide ? 'left-3.5' : 'left-0.5')} />
      </span>
    </button>
  )
}
