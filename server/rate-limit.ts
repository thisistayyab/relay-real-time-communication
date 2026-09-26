export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly windowMs: number
  private readonly max: number

  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs
    this.max = max
  }

  allow(key: string): boolean {
    const now = Date.now()
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }

  clear(key: string): void {
    this.hits.delete(key)
  }

  prune(): void {
    const now = Date.now()
    for (const [key, times] of this.hits) {
      const recent = times.filter((time) => now - time < this.windowMs)
      if (recent.length === 0) this.hits.delete(key)
      else this.hits.set(key, recent)
    }
  }
}
