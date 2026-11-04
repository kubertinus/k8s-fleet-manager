import { describe, expect, it } from 'vitest'
import { __internals } from '@/lib/gatewayApi'

const { toGateway, toRoute } = __internals
const accepted = [
  { type: 'Accepted', status: 'True' },
  { type: 'ResolvedRefs', status: 'True' },
]

describe('toGateway', () => {
  it('reads listeners, certificate refs, addresses and conditions', () => {
    const gateway = toGateway({
      metadata: { name: 'public', namespace: 'gw' },
      spec: {
        gatewayClassName: 'cilium',
        listeners: [
          { name: 'http', protocol: 'HTTP', port: 80 },
          {
            name: 'https',
            protocol: 'HTTPS',
            port: 443,
            hostname: '*.example.com',
            tls: { mode: 'Terminate', certificateRefs: [{ name: 'wild' }, { name: 'other', namespace: 'certs' }, { name: 'x', kind: 'ConfigMap' }] },
          },
        ],
      },
      status: {
        addresses: [{ value: '10.0.0.10' }],
        listeners: [{ name: 'https', attachedRoutes: 3 }],
        conditions: [
          { type: 'Accepted', status: 'True' },
          { type: 'Programmed', status: 'False', reason: 'AddressNotAssigned' },
        ],
      },
    })
    expect(gateway.listeners[1]).toEqual({
      name: 'https',
      protocol: 'HTTPS',
      port: 443,
      hostname: '*.example.com',
      tlsMode: 'Terminate',
      certificateRefs: [
        { name: 'wild', namespace: 'gw' },
        { name: 'other', namespace: 'certs' },
      ],
      attachedRoutes: 3,
    })
    expect(gateway).toMatchObject({ addresses: ['10.0.0.10'], accepted: true, programmed: false, message: 'AddressNotAssigned' })
  })
})

describe('toRoute', () => {
  it('matches parent status by namespace, name and section', () => {
    const route = toRoute('HTTPRoute', {
      metadata: { name: 'app', namespace: 'web' },
      spec: {
        hostnames: ['app.example.com'],
        parentRefs: [{ name: 'public', namespace: 'gw', sectionName: 'https' }],
        rules: [{ backendRefs: [{ name: 'app', port: 80 }, { name: 'canary', port: 80, weight: 10 }] }, { backendRefs: [{ name: 'other', namespace: 'x', port: 8080 }] }],
      },
      status: { parents: [{ parentRef: { name: 'public', namespace: 'gw', sectionName: 'https' }, conditions: accepted }] },
    })
    expect(route).toMatchObject({
      hostnames: ['app.example.com'],
      backends: ['app:80', 'canary:80 (10)', 'x/other:8080'],
      rules: 2,
      parents: [{ name: 'public', namespace: 'gw', sectionName: 'https', accepted: true, resolvedRefs: true, message: null }],
    })
  })
  it('defaults the parent namespace to the route namespace and reports rejections', () => {
    const route = toRoute('GRPCRoute', {
      metadata: { name: 'grpc', namespace: 'web' },
      spec: { parentRefs: [{ name: 'internal' }] },
      status: { parents: [{ parentRef: { name: 'internal' }, conditions: [{ type: 'Accepted', status: 'False', message: 'NotAllowedByListeners' }] }] },
    })
    expect(route.parents[0]).toMatchObject({ namespace: 'web', accepted: false, message: 'NotAllowedByListeners' })
  })
})
