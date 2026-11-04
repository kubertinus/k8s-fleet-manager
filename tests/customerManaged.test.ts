import { describe, expect, it } from 'vitest'
import { isCustomerManaged, withoutNamespaces } from '@/lib/customerManaged'

describe('isCustomerManaged', () => {
  it('matches customer_managed=yes case-insensitively', () => {
    expect(isCustomerManaged({ customer_managed: 'yes' })).toBe(true)
    expect(isCustomerManaged({ customer_managed: 'Yes' })).toBe(true)
    expect(isCustomerManaged({ customer_managed: 'no' })).toBe(false)
    expect(isCustomerManaged(undefined)).toBe(false)
  })
})

describe('withoutNamespaces', () => {
  const hidden = new Set(['cust'])
  it('drops items in hidden namespaces, at any depth', () => {
    const payload = {
      pods: [{ name: 'a', namespace: 'cust' }, { name: 'b', namespace: 'web' }],
      nested: { events: [{ involvedObject: { namespace: 'cust' } }, { metadata: { namespace: 'web' } }] },
    }
    expect(withoutNamespaces(payload, hidden)).toEqual({
      pods: [{ name: 'b', namespace: 'web' }],
      nested: { events: [{ metadata: { namespace: 'web' } }] },
    })
  })
  it('filters namespace lists and drops items used only in hidden namespaces', () => {
    const images = [
      { image: 'x', namespaces: ['cust'] },
      { image: 'y', namespaces: ['cust', 'web'] },
    ]
    expect(withoutNamespaces({ images, namespaces: [{ name: 'cust' }, { name: 'web' }] }, hidden)).toEqual({
      images: [{ image: 'y', namespaces: ['web'] }],
      namespaces: [{ name: 'web' }],
    })
  })
  it('returns the same value when nothing is hidden', () => {
    const value = { a: [1] }
    expect(withoutNamespaces(value, new Set())).toBe(value)
  })
})
