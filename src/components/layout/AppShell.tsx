'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, LogOut, Menu, Search, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ensureClusterList, statusTone, useClusterSummaries } from '@/lib/clusterStatus'
import { footerNav, platformNav, primaryNav, toolsNav, type NavItem } from './navigation'
import Logo from './Logo'
import CustomerManagedToggle from './CustomerManagedToggle'
import ClusterSwitcher from './ClusterSwitcher'

export interface ClusterNavItem {
  id: string
  label: string
  icon: LucideIcon
  critical?: number
  warning?: number
}

export interface ClusterNav {
  clusterId: number
  items: ClusterNavItem[]
  activeId: string
  onSelect: (id: string) => void
}

interface AppShellProps {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  // On a cluster page: the cluster's sections, shown under that cluster in the
  // sidebar; the cluster switcher then takes the place of the title
  clusterNav?: ClusterNav
  // Show the global "hide customer managed" switch in the top bar
  customerFilter?: boolean
  children: ReactNode
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION
const TOOLS_OPEN_KEY = 'k8s-fleet-manager.toolsOpen'
// Show a filter box once the cluster list stops fitting comfortably.
const CLUSTER_SEARCH_THRESHOLD = 6

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return <span className={cn('status-dot', `status-dot-${statusTone(status)}`, className)} aria-hidden />
}

function isActive(item: NavItem, pathname: string) {
  return item.match ? item.match(pathname) : pathname.startsWith(item.href)
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const Icon = item.icon
  if (item.comingSoon) {
    return (
      <span className="side-link cursor-default opacity-50" title="Coming soon">
        <Icon className="h-4 w-4" />
        <span className="flex-1">{item.label}</span>
        <span className="badge badge-muted">soon</span>
      </span>
    )
  }
  return (
    <Link href={item.href} onClick={onNavigate} className={cn('side-link', isActive(item, pathname) && 'active')}>
      <Icon className="h-4 w-4" />
      <span className="flex-1">{item.label}</span>
    </Link>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="px-3 pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</div>
}

// Sections of the open cluster, nested under it in the sidebar
function ClusterSections({ nav, onNavigate }: { nav: ClusterNav; onNavigate: () => void }) {
  return (
    <div className="mb-1 ml-[1.05rem] space-y-0.5 border-l border-slate-800 pl-2" aria-label="Cluster sections">
      {nav.items.map(item => {
        const Icon = item.icon
        const active = nav.activeId === item.id
        return (
          <button
            key={item.id}
            data-active={active || undefined}
            onClick={() => {
              nav.onSelect(item.id)
              onNavigate()
            }}
            className={cn('side-link w-full py-1.5 text-left', active && 'active')}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="flex-1 truncate">{item.label}</span>
            {!!item.critical && <span className="badge badge-err">{item.critical > 9 ? '9+' : item.critical}</span>}
            {!!item.warning && <span className="badge badge-warn">{item.warning > 9 ? '9+' : item.warning}</span>}
          </button>
        )
      })}
    </div>
  )
}

// Cluster list at the bottom of the sidebar; the open cluster shows its sections.
// The sidebar scrolls as a whole, so a long list never squeezes the sections.
function SidebarClusters({ clusterNav, onNavigate }: { clusterNav?: ClusterNav; onNavigate: () => void }) {
  const clusters = useClusterSummaries()
  const [filter, setFilter] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const currentId = clusterNav?.clusterId
  const currentTab = clusterNav?.activeId

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const sorted = [...clusters].sort((a, b) => a.name.localeCompare(b.name))
    return needle ? sorted.filter(c => c.name.toLowerCase().includes(needle)) : sorted
  }, [clusters, filter])

  // Keep the open section (or else the open cluster) in view. Scroll only the
  // sidebar: scrollIntoView would also move the page.
  useEffect(() => {
    const target = (listRef.current?.querySelector('[data-active]') ?? listRef.current?.querySelector('[data-current]')) as HTMLElement | null
    const scroller = listRef.current?.closest('nav')
    if (!target || !scroller) return
    const t = target.getBoundingClientRect()
    const box = scroller.getBoundingClientRect()
    if (t.bottom > box.bottom) scroller.scrollTop += t.bottom - box.bottom + 8
    else if (t.top < box.top) scroller.scrollTop -= box.top - t.top + 8
  }, [currentId, currentTab, clusters.length])

  return (
    <div>
      <SectionTitle>
        Clusters{clusters.length > 0 && <span className="ml-1.5 text-slate-600">{clusters.length}</span>}
      </SectionTitle>
      {clusters.length > CLUSTER_SEARCH_THRESHOLD && (
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter clusters…" className="input h-8 pl-8 text-xs" />
        </div>
      )}
      <div ref={listRef} className="space-y-0.5">
        {visible.map(cluster => {
          const isCurrent = cluster.id === currentId
          return (
            <div key={cluster.id}>
              <Link
                data-current={isCurrent || undefined}
                // From a cluster page, stay on the same section
                href={`/cluster/${cluster.id}${currentTab ? `?tab=${encodeURIComponent(currentTab)}` : ''}`}
                onClick={onNavigate}
                className={cn('side-link', isCurrent && 'font-medium text-white')}
                title={cluster.name}
              >
                <StatusDot status={cluster.status} />
                <span className="flex-1 truncate">{cluster.name}</span>
                {isCurrent && <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
              </Link>
              {isCurrent && clusterNav && <ClusterSections nav={clusterNav} onNavigate={onNavigate} />}
            </div>
          )
        })}
        {clusters.length === 0 && <p className="px-3 py-1.5 text-xs text-slate-500">No clusters yet</p>}
        {clusters.length > 0 && visible.length === 0 && <p className="px-3 py-1.5 text-xs text-slate-500">No match for “{filter}”</p>}
      </div>
    </div>
  )
}

export default function AppShell({ title, subtitle, actions, clusterNav, customerFilter, children }: AppShellProps) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Tools start collapsed; the choice is remembered once toggled
  const [toolsOpen, setToolsOpen] = useState(false)
  const [user, setUser] = useState<{ username?: string; role?: string } | null>(null)

  useEffect(() => {
    ensureClusterList()
    fetch('/api/auth/me')
      .then(response => (response.ok ? response.json() : null))
      .then(data => data && setUser(data))
      .catch(() => {})
    // Read after mount to avoid a hydration mismatch
    try {
      if (localStorage.getItem(TOOLS_OPEN_KEY) === 'true') setToolsOpen(true)
    } catch {
      // keep default
    }
  }, [])

  const toggleTools = () =>
    setToolsOpen(open => {
      try {
        localStorage.setItem(TOOLS_OPEN_KEY, String(!open))
      } catch {
        // not persisted, fine
      }
      return !open
    })

  // Close the mobile drawer whenever we navigate.
  useEffect(() => setMobileOpen(false), [pathname])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.push('/login')
    }
  }

  const closeMobile = () => setMobileOpen(false)

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-slate-800 px-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2 whitespace-nowrap font-semibold text-white">
          <Logo className="h-6 w-6 flex-shrink-0" />
          K8s Fleet Manager
        </Link>
        {APP_VERSION && <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-slate-500">v{APP_VERSION}</span>}
        <button className="ml-2 text-slate-400 hover:text-white lg:hidden" onClick={closeMobile} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3 text-sm">
        <div className="space-y-0.5">
          {primaryNav.map(item => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobile} />
          ))}
        </div>

        <div>
          <SectionTitle>{platformNav.title}</SectionTitle>
          <div className="space-y-0.5">
            {platformNav.items.map(item => (
              <NavLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobile} />
            ))}
          </div>

          <button
            onClick={toggleTools}
            className="flex w-full items-center justify-between px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
          >
            <span>{toolsNav.title}</span>
            {toolsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <div className="space-y-0.5">
            {/* Collapsed: still show the tool you are on */}
            {toolsNav.items
              .filter(item => toolsOpen || isActive(item, pathname))
              .map(item => (
                <NavLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobile} />
              ))}
          </div>
        </div>

        <SidebarClusters clusterNav={clusterNav} onNavigate={closeMobile} />
      </nav>

      <div className="flex-shrink-0 space-y-0.5 border-t border-slate-800 p-3 text-sm">
        {footerNav.map(item => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobile} />
        ))}
        <div className="flex items-center gap-2 px-3 pt-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-slate-300">{user?.username ?? '…'}</div>
            {user?.role && <div className="text-[11px] capitalize text-slate-500">{user.role}</div>}
          </div>
          <button onClick={handleLogout} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" title="Log out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-800 bg-slate-900 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-slate-950/70" onClick={closeMobile} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-slate-800 bg-slate-900">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button className="-ml-1 rounded-md p-1.5 text-slate-400 hover:text-white lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              {clusterNav ? (
                <ClusterSwitcher variant="title" currentId={clusterNav.clusterId} currentTab={clusterNav.activeId} />
              ) : (
                title && <h1 className="truncate text-base font-semibold text-white">{title}</h1>
              )}
              {subtitle && <div className="truncate text-xs text-slate-400">{subtitle}</div>}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {!clusterNav && <ClusterSwitcher variant="compact" />}
              {customerFilter && <CustomerManagedToggle />}
              {actions}
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
