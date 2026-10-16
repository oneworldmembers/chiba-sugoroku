import type { CardId } from './types';

export interface CardDef {
  id: CardId;
  name: string;
  description: string;
  /** カードマスでの出やすさ（相対値） */
  weight: number;
}

export const CARDS: Record<CardId, CardDef> = {
  express: { id: 'express', name: '快速カード', description: 'このターン、サイコロを2個振れる', weight: 5 },
  limitedExpress: { id: 'limitedExpress', name: '特急カード', description: 'このターン、サイコロを3個振れる', weight: 2 },
  warp: { id: 'warp', name: 'どこでもバスカード', description: 'ランダムな物件マスへ移動する', weight: 2 },
  bonus: { id: 'bonus', name: '臨時収入カード', description: 'すぐにお金がもらえる（年数で増額）', weight: 3 },
};

export const MAX_CARDS = 8;

export function drawCardId(rand: () => number): CardId {
  const defs = Object.values(CARDS);
  const total = defs.reduce((s, c) => s + c.weight, 0);
  let r = rand() * total;
  for (const c of defs) {
    r -= c.weight;
    if (r < 0) return c.id;
  }
  return defs[defs.length - 1].id;
}
