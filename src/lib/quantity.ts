// Parser for Kubernetes resource quantities (CPU and memory), following
// k8s.io/apimachinery resource.Quantity: "250m", "24081u", "123456789n", "2",
// "512Mi", "1G", "1.5Gi", "1e3". Returns the value in base units: cores for CPU,
// bytes for memory. Returns NaN when the string is not a valid quantity.

const SUFFIXES: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
}

const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:([eE][+-]?\d+)|(Ki|Mi|Gi|Ti|Pi|Ei|[numkMGTPE])?)$/

export function parseQuantity(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return NaN
  const match = value.trim().match(QUANTITY)
  if (!match) return NaN
  const [, number, exponent, suffix = ''] = match
  if (exponent) return parseFloat(number + exponent)
  return parseFloat(number) * SUFFIXES[suffix]
}
