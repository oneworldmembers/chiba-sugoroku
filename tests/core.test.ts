import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cpuStep } from '../src/core/ai';
import { BoardGraph } from '../src/core/graph';
import { buy, createGame, endTurn, formatMoney, move, propertyIncome, roll } from '../src/core/game';
import { Rng } from '../src/core/rng';
import type { Board, GameState } from '../src/core/types';
import { tinyBoard } from './fixtures';

describe('BoardGraph', () => {
  const g = new BoardGraph(tinyBoard());

  it('最短距離を計算できる', () => {
    expect(g.distance('A', 'D')).toBe(3);
    expect(g.distance('A', 'F')).toBe(3);
    expect(g.isConnected()).toBe(true);
  });

  it('ちょうど N 歩で止まれるマスを返す（すぐ引き返すのは禁止）', () => {
    expect([...g.reachable('A', 1).keys()]).toEqual(['B']);
    expect(new Set(g.reachable('A', 2).keys())).toEqual(new Set(['C', 'E']));
    expect(g.reachable('A', 3).get('D')).toEqual(['B', 'C', 'D']);
  });

  it('行き止まりでは引き返せる', () => {
    // A→B→C→D の先は行き止まりなので、4歩目は C に戻る
    expect(g.reachable('A', 4).has('C')).toBe(true);
  });

  it('壊れた盤面を検出する', () => {
    const bad: Board = { ...tinyBoard(), edges: [['A', 'Z']] };
    expect(() => new BoardGraph(bad)).toThrow();
  });
});

describe('ゲーム進行', () => {
  const g = new BoardGraph(tinyBoard());
  const setup = () => createGame(g, { players: [{ name: 'あなた', isCpu: false }, { name: 'CPU', isCpu: true }], years: 1, seed: 42 });

  it('同じシードなら同じ展開になる', () => {
    const a = roll(setup(), g);
    const b = roll(setup(), g);
    expect(a.phase).toEqual(b.phase);
  });

  it('サイコロ → 移動 → 購入 → ターン終了', () => {
    let s = roll(setup(), g);
    if (s.phase.type !== 'chooseDestination') throw new Error('phase');
    const target = Object.keys(s.phase.options)[0];
    s = move(s, g, target);
    expect(s.players[0].position).toBe(target);
    expect(s.phase).toEqual({ type: 'onSquare', squareId: target });
    s = endTurn(s, g);
    expect(s.currentPlayer).toBe(1);
  });

  it('物件を買うとお金が減り、決算で収益が入る', () => {
    let s: GameState = { ...setup(), phase: { type: 'onSquare', squareId: 'A' } };
    s = buy(s, g, 'A#0');
    s = buy(s, g, 'A#1');
    expect(s.players[0].money).toBe(3000 - 1000 - 2000);
    // 独占で収益2倍：(1000 + 2000) * 10% * 2
    expect(propertyIncome(s, g, 'p1')).toBe(600);
  });

  it('不正な操作は例外になる', () => {
    const s = setup();
    expect(() => move(s, g, 'D')).toThrow();
    expect(() => endTurn(s, g)).toThrow();
  });

  it('CPU だけで最後まで遊べる（規定年数で終了）', () => {
    let s = createGame(g, { players: [{ name: 'C1', isCpu: true }, { name: 'C2', isCpu: true }], years: 2, seed: 7 });
    for (let i = 0; i < 5000 && s.phase.type !== 'gameOver'; i++) s = cpuStep(s, g);
    expect(s.phase.type).toBe('gameOver');
    expect(s.year).toBe(3);
  });
});

describe('ユーティリティ', () => {
  it('金額表示', () => {
    expect(formatMoney(500)).toBe('500万円');
    expect(formatMoney(12345)).toBe('1億2,345万円');
    expect(formatMoney(20000)).toBe('2億円');
    expect(formatMoney(-300)).toBe('-300万円');
  });

  it('乱数は再現可能', () => {
    const a = new Rng(1);
    const b = new Rng(1);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
});

describe('同梱の盤面データ', () => {
  const board = JSON.parse(readFileSync('public/boards/chiba-sample.json', 'utf8')) as Board;
  const g = new BoardGraph(board);

  it('連結で、物件マスが十分ある', () => {
    expect(g.isConnected()).toBe(true);
    expect(g.propertySquares().length).toBeGreaterThan(10);
  });

  it('物件 ID が一意', () => {
    const ids = board.squares.flatMap((s) => s.properties ?? []).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('CPU 4人で3年間遊べる', () => {
    let s = createGame(g, { players: [1, 2, 3, 4].map((i) => ({ name: `C${i}`, isCpu: true })), years: 3, seed: 123 });
    for (let i = 0; i < 20000 && s.phase.type !== 'gameOver'; i++) s = cpuStep(s, g);
    expect(s.phase.type).toBe('gameOver');
  });
});
