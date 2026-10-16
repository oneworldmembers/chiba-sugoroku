import { describe, expect, it } from 'vitest';
import { parseCsv } from '../scripts/lib/csv';
import { centroidOf, connectComponents, knnEdges, stripChome, touchAdjacency } from '../scripts/lib/geo';
import { generateProperties } from '../scripts/lib/properties';

describe('盤面生成ツール', () => {
  it('丁目を落として町名にまとめる', () => {
    expect(stripChome('国府台１丁目')).toBe('国府台');
    expect(stripChome('国府台3丁目')).toBe('国府台');
    expect(stripChome('本町二丁目')).toBe('本町');
    expect(stripChome('大野町')).toBe('大野町');
  });

  it('境界を共有するポリゴンを隣接とみなす', () => {
    const sq = (x: number): [number, number][] => [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
      [x, 0],
    ];
    const edges = touchAdjacency([
      { nodeId: 'a', polys: [[sq(0)]] },
      { nodeId: 'b', polys: [[sq(1)]] },
      { nodeId: 'c', polys: [[sq(5)]] },
    ]);
    expect(edges).toEqual([['a', 'b']]);
  });

  it('重心', () => {
    const c = centroidOf([[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]]);
    expect(c.lng).toBeCloseTo(1);
    expect(c.lat).toBeCloseTo(1);
  });

  it('離れた成分をつなぐ', () => {
    const pts = [
      { id: 'a', lat: 35, lng: 140 },
      { id: 'b', lat: 35.001, lng: 140 },
      { id: 'c', lat: 35.5, lng: 140 },
    ];
    const edges = knnEdges(pts, 1, 5);
    expect(edges).toEqual([['a', 'b']]);
    expect(connectComponents(pts, edges)).toEqual([['c', 'b']]);
  });

  it('CSV（クォート対応）', () => {
    expect(parseCsv('a,b\n"x,1","y""z"\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'y"z'],
    ]);
  });

  it('物件生成は決定的', () => {
    expect(generateProperties('12203:国府台', 'academic', 3)).toEqual(generateProperties('12203:国府台', 'academic', 3));
  });
});
