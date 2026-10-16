/**
 * 再現可能な乱数（mulberry32）。
 * 状態は 32bit 整数ひとつなので GameState に保存でき、リプレイやテストが簡単になる。
 */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  /** [0, 1) の一様乱数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max] の整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)];
  }
}

/** 文字列から決定的な 32bit ハッシュ（FNV-1a）。盤面生成で使う */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
