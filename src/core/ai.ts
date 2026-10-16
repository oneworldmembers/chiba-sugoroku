import { buy, buyableProperties, current, endTurn, move, roll, useCard } from './game';
import type { BoardGraph } from './graph';
import type { GameState } from './types';

/**
 * シンプルな CPU。1回呼ぶごとに1アクションだけ進める（UI でアニメーションを挟めるように）。
 * 方針：目的地に近づく／手元資金を少し残して利回りの良い物件を買う。
 */
export function cpuStep(state: GameState, graph: BoardGraph): GameState {
  const p = current(state);
  const phase = state.phase;
  switch (phase.type) {
    case 'awaitRoll': {
      const dist = graph.distance(p.position, state.destinationId);
      if (state.diceCount === 1 && dist > 8) {
        const idx = p.cards.findIndex((c) => c === 'limitedExpress' || c === 'express');
        if (idx >= 0) return useCard(state, graph, idx);
      }
      const bonusIdx = p.cards.indexOf('bonus');
      if (bonusIdx >= 0 && p.money < 0) return useCard(state, graph, bonusIdx);
      return roll(state, graph);
    }
    case 'chooseDestination': {
      const target = Object.keys(phase.options).sort(
        (a, b) => graph.distance(a, state.destinationId) - graph.distance(b, state.destinationId),
      )[0];
      return move(state, graph, target);
    }
    case 'onSquare': {
      const reserve = 500 + state.year * 300;
      const candidates = buyableProperties(state, graph)
        .filter((pr) => p.money - pr.price >= reserve)
        .sort((a, b) => b.yieldRate * b.price - a.yieldRate * a.price);
      if (candidates.length > 0) return buy(state, graph, candidates[0].id);
      return endTurn(state, graph);
    }
    case 'gameOver':
      return state;
  }
}
