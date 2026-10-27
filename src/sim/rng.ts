/** A seeded random generator that can report its state, so a saved world carries on the same sequence. */
export interface Rng {
  (): number;
  /** The whole internal state: mulberry32(rng.state()) continues exactly where rng is. */
  state(): number;
}

/** Small seeded random generator, so the same seed and script always play out the same way. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.state = () => a;
  return next;
}
