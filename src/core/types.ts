/**
 * ゲーム全体で使う型定義。
 * 金額の単位はすべて「万円」（整数）。
 */

/** マスの種類 */
export type SquareKind =
  | 'property' // 物件マス：物件を買える。目的地候補
  | 'plus' //     プラスマス：お金がもらえる
  | 'minus' //    マイナスマス：お金を失う
  | 'card'; //    カードマス：カードを1枚もらう

/** 町の性格。物件の自動生成に使う */
export type TownKind =
  | 'commercial'
  | 'residential'
  | 'tourism'
  | 'port'
  | 'agri'
  | 'airport'
  | 'academic'
  | 'industrial';

export interface Property {
  /** 盤面内で一意な ID（例: "12203:国府台#0"） */
  id: string;
  name: string;
  /** 価格（万円） */
  price: number;
  /** 年間利回り（%）。決算時に price * yieldRate / 100 が収益になる */
  yieldRate: number;
}

export interface Square {
  /** 盤面内で一意な ID。慣例として "<市区町村コード>:<町名>"（例: "12203:国府台"） */
  id: string;
  /** 町名（例: "国府台"） */
  name: string;
  /** 市区町村名（例: "市川市"） */
  city: string;
  /** 全国地方公共団体コード（5桁、検査数字なし。例: "12203"） */
  cityCode: string;
  lat: number;
  lng: number;
  kind: SquareKind;
  townKind?: TownKind;
  /** kind === 'property' のときのみ */
  properties?: Property[];
}

export interface Board {
  id: string;
  name: string;
  /** 盤面データの形式バージョン */
  version: 1;
  startSquareId: string;
  squares: Square[];
  /** 無向辺。[a, b] の組 */
  edges: [string, string][];
  /** 地図・統計データの出典表記 */
  attribution: string[];
}

export type CardId = 'express' | 'limitedExpress' | 'warp' | 'bonus';

export interface Player {
  id: string;
  name: string;
  color: string;
  isCpu: boolean;
  /** 所持金（万円）。マイナス＝借金 */
  money: number;
  position: string;
  cards: CardId[];
}

export type Phase =
  | { type: 'awaitRoll' }
  | {
      type: 'chooseDestination';
      dice: number[];
      /** 到達可能なマス ID → そこまでの経路（出発マスを含まない） */
      options: Record<string, string[]>;
    }
  | { type: 'onSquare'; squareId: string }
  | { type: 'gameOver' };

export interface LogEntry {
  year: number;
  month: number;
  text: string;
}

export interface GameState {
  boardId: string;
  /** 乱数の内部状態。状態を JSON で保存すればそのまま再開・再現できる */
  rngState: number;
  totalYears: number;
  year: number;
  /** 1〜12。4月スタート、3月末に決算 */
  month: number;
  players: Player[];
  currentPlayer: number;
  /** 物件 ID → 所有プレイヤー ID */
  ownership: Record<string, string>;
  destinationId: string;
  /** 次のサイコロの個数（カードで増える） */
  diceCount: number;
  phase: Phase;
  log: LogEntry[];
}
