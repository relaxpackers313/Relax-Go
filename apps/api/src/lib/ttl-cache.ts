/** Tiny in-memory TTL cache with a size cap — for de-duplicating paid provider calls. */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 1000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.v;
  }

  set(key: string, value: V) {
    if (this.map.size >= this.max) {
      // Drop the oldest entry (insertion order) — good enough for a request cache.
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, { v: value, exp: Date.now() + this.ttlMs });
  }
}
