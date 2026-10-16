import type { Board, Square } from './types';

/**
 * 盤面をグラフとして扱うためのラッパー。
 * 町名レベルのメッシュだと数千マスになり得るので、距離計算はキャッシュする。
 */
export class BoardGraph {
  readonly squares = new Map<string, Square>();
  private readonly adj = new Map<string, string[]>();
  private readonly distCache = new Map<string, Map<string, number>>();

  constructor(readonly board: Board) {
    for (const sq of board.squares) {
      if (this.squares.has(sq.id)) throw new Error(`マス ID が重複しています: ${sq.id}`);
      this.squares.set(sq.id, sq);
      this.adj.set(sq.id, []);
    }
    for (const [a, b] of board.edges) {
      if (!this.squares.has(a) || !this.squares.has(b)) {
        throw new Error(`存在しないマスへの辺です: ${a} - ${b}`);
      }
      if (a === b) continue;
      const na = this.adj.get(a)!;
      const nb = this.adj.get(b)!;
      if (!na.includes(b)) na.push(b);
      if (!nb.includes(a)) nb.push(a);
    }
    if (!this.squares.has(board.startSquareId)) {
      throw new Error(`スタートマスが見つかりません: ${board.startSquareId}`);
    }
  }

  square(id: string): Square {
    const sq = this.squares.get(id);
    if (!sq) throw new Error(`マスが見つかりません: ${id}`);
    return sq;
  }

  neighbors(id: string): readonly string[] {
    return this.adj.get(id) ?? [];
  }

  propertySquares(): Square[] {
    return this.board.squares.filter((s) => s.kind === 'property');
  }

  /** from からの全マスへの最短ホップ数（BFS、キャッシュあり） */
  distancesFrom(from: string): Map<string, number> {
    const cached = this.distCache.get(from);
    if (cached) return cached;
    const dist = new Map<string, number>([[from, 0]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const d = dist.get(cur)!;
      for (const n of this.neighbors(cur)) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }
    this.distCache.set(from, dist);
    return dist;
  }

  distance(a: string, b: string): number {
    return this.distancesFrom(b).get(a) ?? Infinity;
  }

  /**
   * ちょうど steps 歩で止まれるマスと、そこまでの経路を返す。
   * 双六のルールとして「直前のマスへすぐ引き返す」ことは禁止（行き止まりのときだけ許可）。
   */
  reachable(start: string, steps: number): Map<string, string[]> {
    type Walker = { node: string; prev: string | null; path: string[] };
    let frontier: Walker[] = [{ node: start, prev: null, path: [] }];
    for (let d = 0; d < steps; d++) {
      const next: Walker[] = [];
      const seen = new Set<string>();
      for (const w of frontier) {
        const ns = this.neighbors(w.node);
        const forward = ns.filter((n) => n !== w.prev);
        for (const n of forward.length > 0 ? forward : ns) {
          const key = `${n}\u0000${w.node}`;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ node: n, prev: w.node, path: [...w.path, n] });
        }
      }
      frontier = next;
    }
    const result = new Map<string, string[]>();
    for (const w of frontier) if (!result.has(w.node)) result.set(w.node, w.path);
    return result;
  }

  /** 全マスが連結しているか（盤面データの検証用） */
  isConnected(): boolean {
    if (this.squares.size === 0) return true;
    return this.distancesFrom(this.board.startSquareId).size === this.squares.size;
  }
}
