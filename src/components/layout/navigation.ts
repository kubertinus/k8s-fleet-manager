import { AlertTriangle, Archive, Braces, Container, FileKey, GitBranch, GitCompare, Globe, KeyRound, LayoutDashboard, Package, Settings, ShieldCheck, type LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  // Not built yet: shown in the menu as "soon" and not clickable.
  comingSoon?: boolean
  match?: (pathname: string) => boolean
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

// Top of the sidebar. The cluster list is rendered between these sections.
export const primaryNav: NavItem[] = [
  {
    label: 'Overview',
    href: '/dashboard',
    icon: LayoutDashboard,
    match: pathname => pathname === '/dashboard',
  },
]

// Fleet-wide tools that are not tied to a single cluster.
// Flip `comingSoon` off (and add the route under src/app) once a section is built.
export const platformNav: NavSection = {
  title: 'Platform',
  items: [
    { label: 'Images', href: '/images', icon: Package },
    { label: 'Hostnames', href: '/hostnames', icon: Globe },
    { label: 'Versions', href: '/versions', icon: GitBranch },
    { label: 'Backups', href: '/backups', icon: Archive },
  ],
}

// Standalone helpers. Secret decoder, YAML, YAML diff and Compose run entirely in the browser.
export const toolsNav: NavSection = {
  title: 'Tools',
  items: [
    { label: 'Kubeconfigs', href: '/tools/kubeconfigs', icon: KeyRound },
    { label: 'Certificates', href: '/tools/certificates', icon: ShieldCheck },
    { label: 'Secret decoder', href: '/tools/secret-decoder', icon: FileKey },
    { label: 'YAML', href: '/tools/yaml', icon: Braces, match: pathname => pathname === '/tools/yaml' },
    { label: 'YAML diff', href: '/tools/yaml-diff', icon: GitCompare },
    { label: 'Compose → Kubernetes', href: '/tools/compose', icon: Container },
    { label: 'Deprecated APIs', href: '/tools/deprecated-apis', icon: AlertTriangle },
  ],
}

export const footerNav: NavItem[] = [
  {
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    match: pathname => pathname.startsWith('/settings'),
  },
]
