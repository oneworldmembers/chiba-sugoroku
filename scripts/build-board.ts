/**
 * 盤面データ（public/boards/*.json）を生成する CLI。
 *
 * 対応する入力形式（--format で指定、省略時は自動判別）:
 *   csv     … このリポジトリ独自の CSV（data/towns.sample.csv 参照）
 *   mlit    … 国土交通省「位置参照情報（大字・町丁目レベル）」の CSV（Shift_JIS 可）
 *   geojson … e-Stat 国勢調査 小地域境界データを GeoJSON に変換したもの
 *
 * 例:
 *   npm run board:sample
 *   npm run board:build -- --input data/raw/12_2023.csv --format mlit --city 12203,12204 \
 *       --overrides data/towns.sample.csv --out public/boards/ichikawa-funabashi.json \
 *       --id ichikawa-funabashi --name "市川・船橋 町名盤"
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { BoardGraph } from '../src/core/graph';
import { hashString } from '../src/core/rng';
import type { Board, Square, TownKind } from '../src/core/types';
import { csvToObjects, decodeText } from './lib/csv';
import { centroidOf, connectComponents, knnEdges, stripChome, touchAdjacency, type Polygons } from './lib/geo';
import { TOWN_KINDS, decideSquareKind, generateProperties, parsePropertySpec } from './lib/properties';

interface TownRecord {
  cityCode: string;
  city: string;
  town: string;
  lat: number;
  lng: number;
  /** 重心計算の重み（面積など） */
  weight: number;
  kind?: TownKind;
  rank?: number;
  properties?: string;
  polys?: Polygons;
}

const { values: args } = parseArgs({
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    id: { type: 'string', default: 'custom' },
    name: { type: 'string', default: 'カスタム盤' },
    format: { type: 'string', default: 'auto' },
    city: { type: 'string' },
    'merge-chome': { type: 'boolean', default: true },
    'no-merge-chome': { type: 'boolean', default: false },
    k: { type: 'string', default: '3' },
    'max-km': { type: 'string', default: '15' },
    overrides: { type: 'string' },
    start: { type: 'string' },
    attribution: { type: 'string', multiple: true },
  },
});

if (!args.input || !args.out) {
  console.error('使い方: tsx scripts/build-board.ts --input <file> --out <file.json> [--format csv|mlit|geojson] [--city 12203,12204]');
  process.exit(1);
}

const buf = readFileSync(args.input);
const format = args.format === 'auto' ? detectFormat(args.input, buf) : args.format;
const mergeChome = args['merge-chome'] && !args['no-merge-chome'];
const cityFilter = args.city ? new Set(args.city.split(',').map((s) => s.trim())) : null;

let records: TownRecord[];
const attribution: string[] = [...(args.attribution ?? [])];
switch (format) {
  case 'csv':
    records = loadOwnCsv(decodeText(buf));
    break;
  case 'mlit':
    records = loadMlitCsv(decodeText(buf));
    attribution.push('「位置参照情報」（国土交通省）を加工して作成');
    break;
  case 'geojson':
    records = loadEstatGeoJson(JSON.parse(decodeText(buf)));
    attribution.push('出典：政府統計の総合窓口(e-Stat) 国勢調査 小地域境界データを加工して作成');
    break;
  default:
    throw new Error(`未対応の形式です: ${format}`);
}

if (cityFilter) records = records.filter((r) => cityFilter.has(r.cityCode));
if (mergeChome && format !== 'csv') records = mergeByTown(records);
if (args.overrides) applyOverrides(records, loadOwnCsv(decodeText(readFileSync(args.overrides))));
if (records.length < 2) throw new Error('町が2つ以上必要です（--city の指定を確認してください）');

const board = buildBoard(records);
const graph = new BoardGraph(board); // 検証を兼ねる
if (!graph.isConnected()) throw new Error('盤面が連結になっていません');

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(board, null, 1) + '\n');
const counts = board.squares.reduce<Record<string, number>>((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {});
console.log(`✔ ${args.out}: ${board.squares.length} マス / ${board.edges.length} 辺`, counts);

// ---------------------------------------------------------------------------

function detectFormat(path: string, data: Buffer): string {
  if (/\.(geo)?json$/i.test(path)) return 'geojson';
  const head = decodeText(data.subarray(0, 2000));
  if (head.includes('大字町丁目名') || head.includes('大字・町丁目名')) return 'mlit';
  return 'csv';
}

function loadOwnCsv(text: string): TownRecord[] {
  return csvToObjects(text).map((r) => {
    const kind = (r.kind || undefined) as TownKind | undefined;
    if (kind && !TOWN_KINDS.includes(kind)) throw new Error(`不明な kind: ${kind}（${r.town}）`);
    return {
      cityCode: r.city_code,
      city: r.city,
      town: r.town,
      lat: Number(r.lat),
      lng: Number(r.lng),
      weight: 1,
      kind,
      rank: r.rank ? Number(r.rank) : undefined,
      properties: r.properties || undefined,
    };
  });
}

function loadMlitCsv(text: string): TownRecord[] {
  const rows = csvToObjects(text);
  const col = (r: Record<string, string>, ...names: string[]) => {
    for (const n of names) if (r[n] !== undefined) return r[n];
    return '';
  };
  return rows
    .map((r) => ({
      cityCode: col(r, '市区町村コード').padStart(5, '0').slice(0, 5),
      city: col(r, '市区町村名'),
      town: col(r, '大字町丁目名', '大字・町丁目名'),
      lat: Number(col(r, '緯度')),
      lng: Number(col(r, '経度')),
      weight: 1,
    }))
    .filter((r) => r.town && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

interface GeoFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

function loadEstatGeoJson(fc: { features: GeoFeature[] }): TownRecord[] {
  const out: TownRecord[] = [];
  for (const f of fc.features) {
    const p = f.properties;
    const town = String(p.S_NAME ?? p.MOJI ?? '').trim();
    if (!town || !f.geometry) continue;
    const polys: Polygons =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as Polygons[number]]
        : f.geometry.type === 'MultiPolygon'
          ? (f.geometry.coordinates as Polygons)
          : [];
    if (polys.length === 0) continue;
    const c = centroidOf(polys);
    const cityCode = p.PREF && p.CITY ? `${p.PREF}${p.CITY}` : String(p.KEY_CODE ?? '').slice(0, 5);
    out.push({
      cityCode,
      city: String(p.CITY_NAME ?? ''),
      town,
      lat: c.lat,
      lng: c.lng,
      weight: c.area || 1e-12,
      polys,
    });
  }
  return out;
}

/** 丁目単位のレコードを町名単位にまとめる（重心は面積の重み付き平均） */
function mergeByTown(recs: TownRecord[]): TownRecord[] {
  const groups = new Map<string, TownRecord>();
  for (const r of recs) {
    const town = stripChome(r.town);
    const key = `${r.cityCode}:${town}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...r, town, polys: r.polys ? [...r.polys] : undefined });
      continue;
    }
    const w = g.weight + r.weight;
    g.lat = (g.lat * g.weight + r.lat * r.weight) / w;
    g.lng = (g.lng * g.weight + r.lng * r.weight) / w;
    g.weight = w;
    if (g.polys && r.polys) g.polys.push(...r.polys);
  }
  return [...groups.values()];
}

/** 手書きデータ（性格・ランク・物件）で上書き。座標は元データを優先 */
function applyOverrides(recs: TownRecord[], overrides: TownRecord[]) {
  const map = new Map(overrides.map((o) => [`${o.cityCode}:${o.town}`, o]));
  for (const r of recs) {
    const o = map.get(`${r.cityCode}:${r.town}`);
    if (!o) continue;
    r.kind = o.kind ?? r.kind;
    r.rank = o.rank ?? r.rank;
    r.properties = o.properties ?? r.properties;
  }
}

function buildBoard(recs: TownRecord[]): Board {
  const squares: Square[] = recs.map((r) => {
    const id = `${r.cityCode}:${r.town}`;
    const rank = r.rank ?? 1;
    const townKind = r.kind ?? 'residential';
    // ランク未指定の町（大量データ）は一部を物件マスにする
    const kind = r.rank === undefined && hashFrac(id) < 0.12 ? 'property' : decideSquareKind(id, rank);
    const sq: Square = {
      id,
      name: r.town,
      city: r.city,
      cityCode: r.cityCode,
      lat: round6(r.lat),
      lng: round6(r.lng),
      kind,
      townKind,
    };
    if (kind === 'property') {
      sq.properties = r.properties ? parsePropertySpec(id, r.properties) : generateProperties(id, townKind, Math.max(rank, 3));
    }
    return sq;
  });

  const ids = new Set(squares.map((s) => s.id));
  if (ids.size !== squares.length) throw new Error('町 ID が重複しています（同じ市区町村に同名の町があります）');

  const points = squares.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng }));
  const withPolys = recs.filter((r) => r.polys);
  let edges: [string, string][] =
    withPolys.length === recs.length
      ? touchAdjacency(recs.map((r) => ({ nodeId: `${r.cityCode}:${r.town}`, polys: r.polys! })))
      : knnEdges(points, Number(args.k), Number(args['max-km']));
  edges = [...edges, ...connectComponents(points, edges)];
  edges.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));

  // スタート地点：指定がなければランクが最も高い町
  const rankOf = new Map(recs.map((r) => [`${r.cityCode}:${r.town}`, r.rank ?? 0]));
  const start = args.start ?? [...squares].sort((a, b) => rankOf.get(b.id)! - rankOf.get(a.id)!)[0].id;
  if (!ids.has(start)) throw new Error(`--start のマスが見つかりません: ${start}`);

  return {
    id: args.id!,
    name: args.name!,
    version: 1,
    startSquareId: start,
    squares,
    edges,
    attribution: [...new Set(attribution)],
  };
}

function hashFrac(s: string): number {
  return hashString(`prop:${s}`) / 2 ** 32;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
