/** 盤面生成用の幾何ユーティリティ */

export type LngLat = [number, number];
export type Ring = LngLat[];
/** Polygon（外周＋穴）の配列。MultiPolygon も Polygon もこれに正規化する */
export type Polygons = Ring[][];

export interface Point {
  id: string;
  lat: number;
  lng: number;
}

/** 2点間の距離（km） */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 面積で重み付けした重心と（相対的な）面積。外周リングのみ使用 */
export function centroidOf(polys: Polygons): { lat: number; lng: number; area: number } {
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring || ring.length < 3) continue;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      A += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
  }
  if (Math.abs(A) < 1e-15) {
    const pts = polys.flatMap((p) => p[0] ?? []);
    const lng = pts.reduce((s, p) => s + p[0], 0) / Math.max(pts.length, 1);
    const lat = pts.reduce((s, p) => s + p[1], 0) / Math.max(pts.length, 1);
    return { lat, lng, area: 0 };
  }
  return { lng: cx / (3 * A), lat: cy / (3 * A), area: Math.abs(A / 2) };
}

/**
 * 境界を共有するポリゴン同士を隣接とみなす。
 * 頂点座標を丸めてキーにし、2頂点以上を共有するペアを辺にする（点で接するだけのものは除外）。
 * @param groupOf 各ポリゴンが属するノード ID（丁目を町にまとめる場合などに同じ ID を返す）
 */
export function touchAdjacency(features: { nodeId: string; polys: Polygons }[], precision = 6): [string, string][] {
  const vertexOwners = new Map<string, Set<string>>();
  for (const f of features) {
    for (const poly of f.polys) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          const key = `${x.toFixed(precision)},${y.toFixed(precision)}`;
          let set = vertexOwners.get(key);
          if (!set) vertexOwners.set(key, (set = new Set()));
          set.add(f.nodeId);
        }
      }
    }
  }
  const shared = new Map<string, number>();
  for (const owners of vertexOwners.values()) {
    if (owners.size < 2) continue;
    const ids = [...owners].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]}\u0000${ids[j]}`;
        shared.set(k, (shared.get(k) ?? 0) + 1);
      }
    }
  }
  const edges: [string, string][] = [];
  for (const [k, n] of shared) {
    if (n >= 2) {
      const [a, b] = k.split('\u0000');
      edges.push([a, b]);
    }
  }
  return edges;
}

/** 各点から近い k 点へ辺を張る（重複除去済み）。maxKm を超える辺は張らない */
export function knnEdges(points: Point[], k: number, maxKm = Infinity): [string, string][] {
  const set = new Set<string>();
  for (const p of points) {
    const near = points
      .filter((q) => q.id !== p.id)
      .map((q) => ({ q, d: haversineKm(p, q) }))
      .filter((x) => x.d <= maxKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const { q } of near) set.add([p.id, q.id].sort().join('\u0000'));
  }
  return [...set].map((s) => s.split('\u0000') as [string, string]);
}

/**
 * 連結成分が複数ある場合、成分間の最短ペアを結んで全体を連結にする（Kruskal 風）。
 * 海や川で分断された町、データの欠けを補うために使う。
 */
export function connectComponents(points: Point[], edges: [string, string][]): [string, string][] {
  const parent = new Map(points.map((p) => [p.id, p.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const [a, b] of edges) union(a, b);

  const added: [string, string][] = [];
  for (;;) {
    const comps = new Map<string, Point[]>();
    for (const p of points) {
      const r = find(p.id);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r)!.push(p);
    }
    if (comps.size <= 1) break;
    // 最小の成分から一番近い他成分の点へ結ぶ
    const smallest = [...comps.values()].sort((a, b) => a.length - b.length)[0];
    const root = find(smallest[0].id);
    let best: { a: Point; b: Point; d: number } | null = null;
    for (const a of smallest) {
      for (const b of points) {
        if (find(b.id) === root) continue;
        const d = haversineKm(a, b);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) break;
    added.push([best.a.id, best.b.id]);
    union(best.a.id, best.b.id);
  }
  return added;
}

/** "国府台１丁目" → "国府台" のように丁目を落として町名にまとめる */
export function stripChome(name: string): string {
  const stripped = name.replace(/[0-9０-９一二三四五六七八九十〇]+丁目$/u, '').trim();
  return stripped || name;
}
