// Namespaces labelled customer_managed=yes are run by the customer. The UI can
// hide everything that lives in them (warnings, workloads, images, ...).

export const CUSTOMER_MANAGED_LABEL = 'customer_managed'

export function isCustomerManaged(labels: Record<string, string> | null | undefined): boolean {
  return (labels?.[CUSTOMER_MANAGED_LABEL] ?? '').toLowerCase() === 'yes'
}

function namespaceOf(item: any): string | undefined {
  if (typeof item?.namespace === 'string') return item.namespace
  if (typeof item?.metadata?.namespace === 'string') return item.metadata.namespace
  if (typeof item?.involvedObject?.namespace === 'string') return item.involvedObject.namespace
  return undefined
}

// Returns a copy of an API payload without anything that lives in one of `namespaces`:
//  - array items with a namespace (pods, services, events, certificates, ...),
//  - entries of `namespaces` lists, as names (["a", "b"]) or namespace objects ({ name }),
//  - items whose `namespaces` list only held hidden namespaces (an image used only
//    by customer workloads).
// Everything else is kept, so the payload keeps its shape.
export function withoutNamespaces<T>(value: T, namespaces: Set<string>): T {
  if (namespaces.size === 0) return value
  return strip(value, namespaces, undefined) as T
}

function strip(value: any, hidden: Set<string>, key: string | undefined): any {
  if (Array.isArray(value)) {
    if (key === 'namespaces') {
      return value.filter(item => {
        if (typeof item === 'string') return !hidden.has(item)
        if (item && typeof item === 'object' && namespaceOf(item) === undefined && typeof item.name === 'string') {
          return !hidden.has(item.name)
        }
        return true
      })
    }
    return value.flatMap(item => {
      if (!item || typeof item !== 'object') return [item]
      const ns = namespaceOf(item)
      if (ns !== undefined && hidden.has(ns)) return []
      const stripped = strip(item, hidden, undefined)
      const usedOnlyInHidden =
        Array.isArray(item.namespaces) && item.namespaces.length > 0 && stripped.namespaces.length === 0
      return usedOnlyInHidden ? [] : [stripped]
    })
  }

  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) result[k] = strip(v, hidden, k)
    return result
  }

  return value
}
