import './style.css';
import {
  BoardGraph,
  CARDS,
  buy,
  buyableProperties,
  createGame,
  cpuStep,
  current,
  endTurn,
  formatMoney,
  label,
  move,
  ranking,
  roll,
  useCard,
  type Board,
  type GameState,
  type Square,
} from './core';
import { BoardMap } from './ui/map';

interface BoardEntry {
  id: string;
  name: string;
  file: string;
}

const SAVE_KEY = 'chiba-sugoroku:save:v1';
const base = import.meta.env.BASE_URL;
const app = document.querySelector<HTMLDivElement>('#app')!;

let graph: BoardGraph;
let boardMap: BoardMap;
let state: GameState;
let busy = false;
let inspected: Square | null = null;

// ---------------------------------------------------------------------------
// 起動・セットアップ
// ---------------------------------------------------------------------------

async function boot() {
  const boards = (await fetchJson<BoardEntry[]>(`${base}boards/index.json`)) ?? [];
  const saved = loadSave();
  app.innerHTML = `
    <div class="setup">
      <div class="setup-card">
        <h1>ちばすご！<small>千葉町名すごろく</small></h1>
        <p class="lead">千葉県の町ひとつひとつがマス。サイコロを振って目的地をめざし、物件を買い集めよう。</p>
        <form id="setup-form">
          <label>盤面
            <select name="board">${boards.map((b) => `<option value="${esc(b.file)}">${esc(b.name)}</option>`).join('')}</select>
          </label>
          <label>あなたの名前 <input name="name" value="あなた" maxlength="8" required /></label>
          <div class="row">
            <label>CPU の数
              <select name="cpus"><option>0</option><option>1</option><option>2</option><option selected>3</option></select>
            </label>
            <label>プレイ年数
              <select name="years"><option value="1">1年</option><option value="3" selected>3年</option><option value="5">5年</option><option value="10">10年</option></select>
            </label>
          </div>
          <button type="submit" class="primary">はじめる</button>
          ${saved ? '<button type="button" id="resume">続きから遊ぶ</button>' : ''}
        </form>
        <p class="note">非公式のファンメイド作品です。地図：地理院タイル</p>
      </div>
    </div>`;

  const form = document.querySelector<HTMLFormElement>('#setup-form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const board = await fetchJson<Board>(`${base}boards/${fd.get('board')}`);
    if (!board) return alert('盤面データを読み込めませんでした');
    const cpus = Number(fd.get('cpus'));
    const players = [
      { name: String(fd.get('name') || 'あなた'), isCpu: false },
      ...['房総', '印旛', '葛南'].slice(0, cpus).map((n) => ({ name: `${n}CPU`, isCpu: true })),
    ];
    graph = new BoardGraph(board);
    startGame(createGame(graph, { players, years: Number(fd.get('years')) }), board.id);
  });
  document.querySelector('#resume')?.addEventListener('click', async () => {
    const entry = boards.find((b) => b.id === saved!.boardId);
    const board = entry && (await fetchJson<Board>(`${base}boards/${entry.file}`));
    if (!board) return alert('保存された盤面が見つかりません');
    graph = new BoardGraph(board);
    startGame(saved!, board.id);
  });
}

function startGame(initial: GameState, boardId: string) {
  state = initial;
  app.innerHTML = `
    <div class="game">
      <div id="map" class="map" role="application" aria-label="千葉県の盤面"></div>
      <aside class="panel">
        <header class="status" id="status"></header>
        <section id="players" class="players"></section>
        <section id="actions" class="actions"></section>
        <section id="inspect" class="inspect"></section>
        <section class="log"><h2>ログ</h2><ol id="log"></ol></section>
        <footer class="board-credit">${graph.board.attribution.map(esc).join('<br>')}<br>盤面: ${esc(boardId)}</footer>
      </aside>
    </div>`;
  boardMap = new BoardMap(document.querySelector('#map')!, graph, onSquareClick);
  render();
  scheduleCpu();
}

// ---------------------------------------------------------------------------
// 状態遷移
// ---------------------------------------------------------------------------

async function dispatch(next: GameState) {
  const prev = state;
  busy = true;
  // 移動が起きたらコマをアニメーション
  if (prev.phase.type === 'chooseDestination') {
    const mover = prev.players[prev.currentPlayer];
    const to = next.players[prev.currentPlayer].position;
    const path = prev.phase.options[to];
    if (path) {
      // 移動前の位置のまま候補ハイライトだけ消してから動かす
      state = { ...prev, phase: { type: 'awaitRoll' } };
      boardMap.render(state);
      await boardMap.animate(mover.id, path);
    }
  }
  state = next;
  busy = false;
  saveGame();
  render();
  if (state.phase.type === 'onSquare') boardMap.focus(state.phase.squareId);
  scheduleCpu();
}

function act(fn: () => GameState) {
  if (busy) return;
  try {
    void dispatch(fn());
  } catch (err) {
    alert((err as Error).message);
  }
}

function scheduleCpu() {
  if (state.phase.type === 'gameOver' || !current(state).isCpu) return;
  const delay = state.phase.type === 'chooseDestination' ? 700 : 450;
  setTimeout(() => {
    if (!busy && current(state).isCpu) void dispatch(cpuStep(state, graph));
  }, delay);
}

function onSquareClick(sq: Square) {
  const phase = state.phase;
  if (phase.type === 'chooseDestination' && !current(state).isCpu && sq.id in phase.options) {
    act(() => move(state, graph, sq.id));
    return;
  }
  inspected = sq;
  renderInspect();
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

function render() {
  boardMap.render(state);
  renderStatus();
  renderPlayers();
  renderActions();
  renderInspect();
  renderLog();
}

function renderStatus() {
  const dest = graph.square(state.destinationId);
  const me = current(state);
  const dist = graph.distance(me.position, dest.id);
  $('#status').innerHTML = `
    <div class="date">${state.year}<small>年目</small> ${state.month}<small>月</small>
      <span class="remaining">全${state.totalYears}年</span></div>
    <div class="dest">目的地 <strong>${esc(label(dest))}</strong>
      <span class="dist">${esc(me.name)}から${dist}マス</span></div>`;
}

function renderPlayers() {
  const ranks = new Map(ranking(state, graph).map((r, i) => [r.player.id, { ...r, rank: i + 1 }]));
  $('#players').innerHTML = state.players
    .map((p, i) => {
      const r = ranks.get(p.id)!;
      return `
      <div class="player ${i === state.currentPlayer ? 'active' : ''}" style="--c:${p.color}">
        <span class="badge">${r.rank}位</span>
        <span class="pname">${esc(p.name)}</span>
        <span class="money ${p.money < 0 ? 'neg' : ''}">${formatMoney(p.money)}</span>
        <span class="sub">物件 ${formatMoney(r.assets)} ・ カード ${p.cards.length}枚 ・ ${esc(graph.square(p.position).name)}</span>
      </div>`;
    })
    .join('');
}

function renderActions() {
  const el = $('#actions');
  const p = current(state);
  const phase = state.phase;

  if (phase.type === 'gameOver') {
    el.innerHTML = `<h2>最終結果</h2><ol class="result">${ranking(state, graph)
      .map((r) => `<li><b>${esc(r.player.name)}</b> ${formatMoney(r.total)}</li>`)
      .join('')}</ol><button class="primary" id="again">もう一度遊ぶ</button>`;
    $('#again').addEventListener('click', () => {
      clearSave();
      void boot();
    });
    return;
  }
  if (p.isCpu) {
    el.innerHTML = `<p class="thinking">${esc(p.name)}が考えています…</p>`;
    return;
  }

  switch (phase.type) {
    case 'awaitRoll':
      el.innerHTML = `
        <button class="primary dice" id="roll">🎲 サイコロを振る${state.diceCount > 1 ? `（${state.diceCount}個）` : ''}</button>
        ${p.cards.length ? `<h3>カード</h3><div class="cards">${p.cards
          .map((c, i) => `<button class="card" data-i="${i}" title="${esc(CARDS[c].description)}">${esc(CARDS[c].name)}</button>`)
          .join('')}</div>` : ''}`;
      $('#roll').addEventListener('click', () => act(() => roll(state, graph)));
      el.querySelectorAll<HTMLButtonElement>('.card').forEach((b) =>
        b.addEventListener('click', () => act(() => useCard(state, graph, Number(b.dataset.i)))),
      );
      break;

    case 'chooseDestination': {
      const total = phase.dice.reduce((a, b) => a + b, 0);
      const opts = Object.keys(phase.options).sort(
        (a, b) => graph.distance(a, state.destinationId) - graph.distance(b, state.destinationId),
      );
      el.innerHTML = `
        <p class="dice-result">${phase.dice.map((d) => `<span class="die">${d}</span>`).join('')} = <b>${total}</b> マス</p>
        <p class="hint">地図の光っているマスをクリック、または下から選んでください</p>
        <div class="options">${opts
          .map((id) => {
            const sq = graph.square(id);
            return `<button data-id="${esc(id)}" class="opt kind-${sq.kind}">${esc(sq.name)}<small>${esc(sq.city)}・目的地まで${graph.distance(id, state.destinationId)}</small></button>`;
          })
          .join('')}</div>`;
      el.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) =>
        b.addEventListener('click', () => act(() => move(state, graph, b.dataset.id!))),
      );
      break;
    }

    case 'onSquare': {
      const sq = graph.square(phase.squareId);
      const buyable = buyableProperties(state, graph);
      el.innerHTML = `
        <h2>${esc(label(sq))}</h2>
        ${sq.kind === 'property'
          ? buyable.length
            ? `<table class="props"><tbody>${buyable
                .map(
                  (pr) => `<tr><td>${esc(pr.name)}</td><td>${formatMoney(pr.price)}</td><td>${pr.yieldRate}%</td>
                  <td><button class="buy" data-id="${esc(pr.id)}" ${p.money < pr.price ? 'disabled' : ''}>買う</button></td></tr>`,
                )
                .join('')}</tbody></table>`
            : '<p class="hint">買える物件はありません</p>'
          : ''}
        <button class="primary" id="end">ターン終了</button>`;
      el.querySelectorAll<HTMLButtonElement>('.buy').forEach((b) =>
        b.addEventListener('click', () => act(() => buy(state, graph, b.dataset.id!))),
      );
      $('#end').addEventListener('click', () => act(() => endTurn(state, graph)));
      break;
    }
  }
}

function renderInspect() {
  const el = $('#inspect');
  if (!inspected) {
    el.innerHTML = '<p class="hint">マスをクリックすると詳細を表示します</p>';
    return;
  }
  const sq = inspected;
  const kindName = { property: '物件マス', plus: 'プラスマス', minus: 'マイナスマス', card: 'カードマス' }[sq.kind];
  const owners = new Map(state.players.map((p) => [p.id, p]));
  el.innerHTML = `
    <h3>${esc(label(sq))} <span class="tag kind-${sq.kind}">${kindName}</span></h3>
    <p class="sub">${esc(sq.id)} ・ 目的地まで${graph.distance(sq.id, state.destinationId)}マス</p>
    ${(sq.properties ?? [])
      .map((pr) => {
        const o = owners.get(state.ownership[pr.id]);
        return `<div class="prop-row"><span>${esc(pr.name)}</span><span>${formatMoney(pr.price)} / ${pr.yieldRate}%</span>
          <span class="owner" style="--c:${o?.color ?? 'transparent'}">${o ? esc(o.name) : '未所有'}</span></div>`;
      })
      .join('')}`;
}

function renderLog() {
  $('#log').innerHTML = state.log
    .slice(-60)
    .reverse()
    .map((l) => `<li><span class="when">${l.year}年${l.month}月</span>${esc(l.text)}</li>`)
    .join('');
}

// ---------------------------------------------------------------------------
// 保存（ブラウザ内のみ）
// ---------------------------------------------------------------------------

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* プライベートモード等では保存しない */
  }
}

function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? (JSON.parse(raw) as GameState) : null;
    return s && s.phase.type !== 'gameOver' ? s : null;
  } catch {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------

function $(sel: string): HTMLElement {
  return document.querySelector<HTMLElement>(sel)!;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

void boot();
