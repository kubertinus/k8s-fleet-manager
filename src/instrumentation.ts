// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startImageScanScheduler } = await import('./lib/images/scheduler')
    startImageScanScheduler()
    const { startHealthHistorySampler } = await import('./lib/history/sampler')
    startHealthHistorySampler()
  }
}
