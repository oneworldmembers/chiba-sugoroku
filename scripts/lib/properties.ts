import type { Property, SquareKind, TownKind } from '../../src/core/types';
import { Rng, hashString } from '../../src/core/rng';

/** [物件名, 基準価格(万円), 利回り(%)] */
type Template = [string, number, number];

const TEMPLATES: Record<TownKind, Template[]> = {
  commercial: [
    ['駅前ラーメン屋', 800, 10],
    ['コンビニ', 1500, 7],
    ['商店街の総菜屋', 600, 11],
    ['ビジネスホテル', 8000, 5],
    ['オフィスビル', 30000, 3],
    ['ショッピングモール', 60000, 2],
    ['居酒屋', 1000, 9],
  ],
  residential: [
    ['パン屋', 500, 12],
    ['学習塾', 1200, 8],
    ['マンション', 12000, 4],
    ['銭湯', 900, 9],
    ['クリーニング店', 400, 13],
  ],
  tourism: [
    ['土産物屋', 700, 11],
    ['旅館', 6000, 5],
    ['展望カフェ', 2000, 8],
    ['観光バス会社', 9000, 4],
  ],
  port: [
    ['漁協直売所', 800, 10],
    ['水産加工場', 4000, 6],
    ['倉庫会社', 10000, 4],
    ['海鮮食堂', 900, 10],
  ],
  agri: [
    ['落花生農家', 400, 15],
    ['梨園', 600, 12],
    ['道の駅', 3000, 6],
    ['いちご狩り農園', 800, 11],
  ],
  airport: [
    ['空港ラウンジ', 5000, 6],
    ['貨物ターミナル', 40000, 3],
    ['エアポートホテル', 15000, 4],
    ['レンタカー店', 2000, 8],
  ],
  academic: [
    ['大学前の定食屋', 700, 10],
    ['古書店', 500, 11],
    ['研究所', 20000, 3],
    ['学生マンション', 6000, 5],
  ],
  industrial: [
    ['町工場', 2000, 8],
    ['物流センター', 15000, 4],
    ['製鉄所の下請け', 8000, 5],
    ['作業服店', 600, 11],
  ],
};

const RANK_PRICE = [0, 0.6, 0.8, 1, 1.5, 2.5];

/** "名前:価格:利回り|..." 形式の手書き物件リストを解析 */
export function parsePropertySpec(squareId: string, spec: string): Property[] {
  return spec
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => {
      const [name, price, yieldRate] = s.split(':');
      if (!name || !Number(price) || !Number(yieldRate)) {
        throw new Error(`物件指定が不正です（${squareId}）: "${s}"`);
      }
      return { id: `${squareId}#${i}`, name, price: Number(price), yieldRate: Number(yieldRate) };
    });
}

/** 町の性格とランクから物件を決定的に生成（同じ入力なら毎回同じ結果） */
export function generateProperties(squareId: string, townKind: TownKind, rank: number): Property[] {
  const rng = new Rng(hashString(squareId));
  const pool = [...TEMPLATES[townKind]];
  const count = Math.min(pool.length, Math.max(2, rank));
  const mult = RANK_PRICE[Math.min(Math.max(rank, 1), 5)];
  const out: Property[] = [];
  for (let i = 0; i < count; i++) {
    const [name, base, y] = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    const jitter = 0.85 + rng.next() * 0.3;
    const price = Math.max(100, Math.round((base * mult * jitter) / 10) * 10);
    out.push({ id: `${squareId}#${i}`, name, price, yieldRate: y });
  }
  return out.sort((a, b) => a.price - b.price);
}

/**
 * マスの種類を決める。ランク3以上（主要駅・名所）は物件マス、
 * それ以外はハッシュでプラス/マイナス/カードに振り分ける。
 */
export function decideSquareKind(squareId: string, rank: number): SquareKind {
  if (rank >= 3) return 'property';
  const r = hashString(`kind:${squareId}`) / 2 ** 32;
  if (r < 0.55) return 'plus';
  if (r < 0.8) return 'minus';
  return 'card';
}

export const TOWN_KINDS = Object.keys(TEMPLATES) as TownKind[];
