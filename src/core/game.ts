import { CARDS, MAX_CARDS, drawCardId } from './cards';
import type { BoardGraph } from './graph';
import { Rng } from './rng';
import type { GameState, Player, Property, Square } from './types';

/**
 * ゲームのルール本体。すべて「状態 → 新しい状態」の純粋関数で、UI には依存しない。
 * 不正な操作は例外を投げる（UI 側で事前に canXxx を確認する想定）。
 */

export interface PlayerSetup {
  name: string;
  isCpu: boolean;
  color?: string;
}

export interface GameOptions {
  players: PlayerSetup[];
  /** 何年で終了するか */
  years: number;
  seed?: number;
  /** 初期資金（万円） */
  startMoney?: number;
}

export const PLAYER_COLORS = ['#e4572e', '#2e86ab', '#3bb273', '#f2a541'];
export const START_MONTH = 4;
export const SETTLEMENT_MONTH = 3;

// ---------- 生成 ----------

export function createGame(graph: BoardGraph, opts: GameOptions): GameState {
  if (opts.players.length < 1 || opts.players.length > 4) {
    throw new Error('プレイヤーは1〜4人です');
  }
  if (graph.propertySquares().length < 2) {
    throw new Error('物件マスが2つ以上必要です');
  }
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
  const start = graph.board.startSquareId;
  const players: Player[] = opts.players.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    color: p.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length],
    isCpu: p.isCpu,
    money: opts.startMoney ?? 3000,
    position: start,
    cards: ['express'],
  }));
  let state: GameState = {
    boardId: graph.board.id,
    rngState: seed >>> 0,
    totalYears: opts.years,
    year: 1,
    month: START_MONTH,
    players,
    currentPlayer: 0,
    ownership: {},
    destinationId: start,
    diceCount: 1,
    phase: { type: 'awaitRoll' },
    log: [],
  };
  state = withRng(state, (s, rng) => {
    s.destinationId = pickDestination(graph, rng, start);
    log(s, `ゲーム開始！ 最初の目的地は「${label(graph.square(s.destinationId))}」`);
  });
  return state;
}

// ---------- プレイヤー操作 ----------

export function canUseCard(state: GameState, index: number): boolean {
  return state.phase.type === 'awaitRoll' && index >= 0 && index < current(state).cards.length;
}

export function useCard(state: GameState, graph: BoardGraph, index: number): GameState {
  if (!canUseCard(state, index)) throw new Error('今はカードを使えません');
  return withRng(state, (s, rng) => {
    const p = current(s);
    const [card] = p.cards.splice(index, 1);
    log(s, `${p.name}は${CARDS[card].name}を使った`);
    switch (card) {
      case 'express':
        s.diceCount = Math.max(s.diceCount, 2);
        break;
      case 'limitedExpress':
        s.diceCount = Math.max(s.diceCount, 3);
        break;
      case 'bonus': {
        const amount = Math.round(rng.int(30, 80) * 10 * yearFactor(s));
        p.money += amount;
        log(s, `${p.name}は${formatMoney(amount)}を受け取った`);
        break;
      }
      case 'warp': {
        const candidates = graph.propertySquares().filter((q) => q.id !== p.position);
        const target = rng.pick(candidates);
        arrive(s, graph, rng, target.id);
        break;
      }
    }
  });
}

export function roll(state: GameState, graph: BoardGraph): GameState {
  if (state.phase.type !== 'awaitRoll') throw new Error('今はサイコロを振れません');
  return withRng(state, (s, rng) => {
    const dice = Array.from({ length: s.diceCount }, () => rng.int(1, 6));
    const total = dice.reduce((a, b) => a + b, 0);
    s.diceCount = 1;
    const options = Object.fromEntries(graph.reachable(current(s).position, total));
    log(s, `${current(s).name}のサイコロ：${dice.join(' + ')} = ${total}`);
    s.phase = { type: 'chooseDestination', dice, options };
  });
}

export function move(state: GameState, graph: BoardGraph, targetId: string): GameState {
  if (state.phase.type !== 'chooseDestination' || !(targetId in state.phase.options)) {
    throw new Error('そのマスには止まれません');
  }
  return withRng(state, (s, rng) => arrive(s, graph, rng, targetId));
}

export function buyableProperties(state: GameState, graph: BoardGraph): Property[] {
  if (state.phase.type !== 'onSquare') return [];
  const sq = graph.square(state.phase.squareId);
  return (sq.properties ?? []).filter((pr) => !(pr.id in state.ownership));
}

export function buy(state: GameState, graph: BoardGraph, propertyId: string): GameState {
  const pr = buyableProperties(state, graph).find((x) => x.id === propertyId);
  if (!pr) throw new Error('その物件は買えません');
  if (current(state).money < pr.price) throw new Error('お金が足りません');
  return withRng(state, (s) => {
    const p = current(s);
    p.money -= pr.price;
    s.ownership[pr.id] = p.id;
    log(s, `${p.name}は「${pr.name}」を${formatMoney(pr.price)}で購入`);
  });
}

export function endTurn(state: GameState, graph: BoardGraph): GameState {
  if (state.phase.type !== 'onSquare') throw new Error('まだターンを終了できません');
  return withRng(state, (s) => {
    s.currentPlayer = (s.currentPlayer + 1) % s.players.length;
    s.phase = { type: 'awaitRoll' };
    if (s.currentPlayer !== 0) return;

    // 全員が1回ずつ動いたら1か月進む
    const wasSettlementMonth = s.month === SETTLEMENT_MONTH;
    s.month = (s.month % 12) + 1;
    if (wasSettlementMonth) {
      settle(s, graph);
      s.year += 1;
      if (s.year > s.totalYears) {
        s.phase = { type: 'gameOver' };
        const [winner] = ranking(s, graph);
        log(s, `ゲーム終了！ 優勝は${winner.player.name}（総資産 ${formatMoney(winner.total)}）`);
      } else {
        log(s, `${s.year}年目が始まった`);
      }
    }
  });
}

// ---------- 集計 ----------

export function propertyIncome(state: GameState, graph: BoardGraph, playerId: string): number {
  let income = 0;
  for (const sq of graph.propertySquares()) {
    const props = sq.properties ?? [];
    const owned = props.filter((pr) => state.ownership[pr.id] === playerId);
    if (owned.length === 0) continue;
    const base = owned.reduce((sum, pr) => sum + (pr.price * pr.yieldRate) / 100, 0);
    // 町内の物件を独占すると収益2倍
    income += owned.length === props.length ? base * 2 : base;
  }
  return Math.round(income);
}

export function assetValue(state: GameState, graph: BoardGraph, playerId: string): number {
  let total = 0;
  for (const sq of graph.propertySquares()) {
    for (const pr of sq.properties ?? []) {
      if (state.ownership[pr.id] === playerId) total += pr.price;
    }
  }
  return total;
}

export function ranking(state: GameState, graph: BoardGraph) {
  return state.players
    .map((player) => {
      const assets = assetValue(state, graph, player.id);
      return { player, assets, total: player.money + assets };
    })
    .sort((a, b) => b.total - a.total);
}

// ---------- 表示用ユーティリティ ----------

/** 万円単位の金額を「1億2,345万円」形式に */
export function formatMoney(man: number): string {
  const sign = man < 0 ? '-' : '';
  const abs = Math.abs(Math.round(man));
  const oku = Math.floor(abs / 10000);
  const rest = abs % 10000;
  if (oku === 0) return `${sign}${rest.toLocaleString('ja-JP')}万円`;
  if (rest === 0) return `${sign}${oku.toLocaleString('ja-JP')}億円`;
  return `${sign}${oku.toLocaleString('ja-JP')}億${rest.toLocaleString('ja-JP')}万円`;
}

export function label(sq: Square): string {
  return `${sq.city}${sq.name}`;
}

export function current(state: GameState): Player {
  return state.players[state.currentPlayer];
}

// ---------- 内部処理 ----------

function withRng(state: GameState, fn: (s: GameState, rng: Rng) => void): GameState {
  const s = structuredClone(state);
  const rng = new Rng(s.rngState);
  fn(s, rng);
  s.rngState = rng.state;
  return s;
}

function log(s: GameState, text: string) {
  s.log.push({ year: s.year, month: s.month, text });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
}

function yearFactor(s: GameState): number {
  return 1 + (s.year - 1) * 0.25;
}

function pickDestination(graph: BoardGraph, rng: Rng, from: string): string {
  const dist = graph.distancesFrom(from);
  const candidates = graph.propertySquares().filter((q) => q.id !== from);
  // 近すぎる目的地は避ける（盤面が小さいときはすべて候補）
  const far = candidates.filter((q) => (dist.get(q.id) ?? 0) >= 8);
  return rng.pick(far.length > 0 ? far : candidates).id;
}

/** マスに止まったときの処理 */
function arrive(s: GameState, graph: BoardGraph, rng: Rng, squareId: string) {
  const p = current(s);
  const sq = graph.square(squareId);
  p.position = squareId;
  s.phase = { type: 'onSquare', squareId };
  log(s, `${p.name}は「${label(sq)}」に止まった`);

  if (squareId === s.destinationId) {
    const hops = graph.distance(graph.board.startSquareId, squareId);
    const bonus = Math.round((2000 + hops * 50) * yearFactor(s));
    p.money += bonus;
    log(s, `🎉 ${p.name}が目的地に一番乗り！ 賞金${formatMoney(bonus)}`);
    s.destinationId = pickDestination(graph, rng, squareId);
    log(s, `次の目的地は「${label(graph.square(s.destinationId))}」`);
  }

  switch (sq.kind) {
    case 'plus': {
      const amount = Math.round(rng.int(10, 50) * 10 * yearFactor(s));
      p.money += amount;
      log(s, `${formatMoney(amount)}を手に入れた`);
      break;
    }
    case 'minus': {
      const amount = Math.round(rng.int(5, 40) * 10 * yearFactor(s));
      p.money -= amount;
      log(s, `${formatMoney(amount)}を失った…`);
      break;
    }
    case 'card': {
      if (p.cards.length >= MAX_CARDS) {
        log(s, 'カードがいっぱいで受け取れなかった');
      } else {
        const card = drawCardId(() => rng.next());
        p.cards.push(card);
        log(s, `${CARDS[card].name}を手に入れた`);
      }
      break;
    }
    case 'property':
      break;
  }
}

/** 3月末の決算：物件収益を配る */
function settle(s: GameState, graph: BoardGraph) {
  log(s, `📊 ${s.year}年目の決算`);
  for (const p of s.players) {
    const income = propertyIncome(s, graph, p.id);
    p.money += income;
    log(s, `${p.name}：物件収益 ${formatMoney(income)}`);
  }
}
