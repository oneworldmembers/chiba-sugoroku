import type { Board, Square } from '../src/core/types';

/**
 * テスト用の小さな盤面：
 *
 *   A(物件) - B(+) - C(-) - D(物件)
 *             |
 *             E(カード) - F(物件)
 */
export function tinyBoard(): Board {
  const sq = (id: string, kind: Square['kind'], props = 0): Square => ({
    id,
    name: id,
    city: 'テスト市',
    cityCode: '12999',
    lat: 35,
    lng: 140,
    kind,
    properties:
      kind === 'property'
        ? Array.from({ length: props }, (_, i) => ({ id: `${id}#${i}`, name: `${id}物件${i}`, price: 1000 * (i + 1), yieldRate: 10 }))
        : undefined,
  });
  return {
    id: 'tiny',
    name: 'テスト盤',
    version: 1,
    startSquareId: 'A',
    squares: [sq('A', 'property', 2), sq('B', 'plus'), sq('C', 'minus'), sq('D', 'property', 2), sq('E', 'card'), sq('F', 'property', 1)],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['B', 'E'],
      ['E', 'F'],
    ],
    attribution: [],
  };
}
