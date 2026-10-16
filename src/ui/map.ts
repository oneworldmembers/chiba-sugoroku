import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BoardGraph } from '../core/graph';
import type { GameState, Square, SquareKind } from '../core/types';

const KIND_STYLE: Record<SquareKind, { fill: string; stroke: string; radius: number }> = {
  property: { fill: '#ffffff', stroke: '#2b2b2b', radius: 7 },
  plus: { fill: '#2f6fd6', stroke: '#1b4a99', radius: 5 },
  minus: { fill: '#d64545', stroke: '#9a2626', radius: 5 },
  card: { fill: '#f0b400', stroke: '#a37a00', radius: 5 },
};

/** 地図表示（Leaflet + 地理院タイル）。ゲームの状態は持たず、描画だけを担当する */
export class BoardMap {
  readonly map: L.Map;
  private readonly highlightLayer = L.layerGroup();
  private readonly tokenLayer = L.layerGroup();
  private readonly tokens = new Map<string, L.Marker>();
  private destinationMarker: L.Marker | null = null;

  constructor(
    el: HTMLElement,
    private readonly graph: BoardGraph,
    private readonly onSquareClick: (sq: Square) => void,
  ) {
    this.map = L.map(el, { zoomControl: true, preferCanvas: true, minZoom: 8, maxZoom: 17 });
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
      maxZoom: 18,
    }).addTo(this.map);

    const pos = (id: string) => {
      const s = graph.square(id);
      return L.latLng(s.lat, s.lng);
    };
    for (const [a, b] of graph.board.edges) {
      L.polyline([pos(a), pos(b)], { color: '#6b5b4b', weight: 3, opacity: 0.45, interactive: false }).addTo(this.map);
    }
    for (const sq of graph.board.squares) {
      const st = KIND_STYLE[sq.kind];
      const m = L.circleMarker([sq.lat, sq.lng], {
        radius: st.radius,
        color: st.stroke,
        weight: 2,
        fillColor: st.fill,
        fillOpacity: 1,
      })
        .bindTooltip(`${sq.name}<small>${sq.city}</small>`, {
          permanent: sq.kind === 'property',
          direction: 'top',
          offset: [0, -6],
          className: `sq-label sq-label-${sq.kind}`,
        })
        .on('click', () => onSquareClick(sq))
        .addTo(this.map);
      m.getElement?.()?.setAttribute('aria-label', `${sq.city}${sq.name}`);
    }
    this.highlightLayer.addTo(this.map);
    this.tokenLayer.addTo(this.map);

    const bounds = L.latLngBounds(graph.board.squares.map((s) => [s.lat, s.lng]));
    this.map.fitBounds(bounds, { padding: [20, 20] });
    // ズームアウト時はラベルを隠す
    const updateLabels = () => el.classList.toggle('labels-hidden', this.map.getZoom() < 10);
    this.map.on('zoomend', updateLabels);
    updateLabels();
  }

  render(state: GameState) {
    this.renderDestination(state.destinationId);
    this.renderHighlights(state);
    state.players.forEach((p, i) => {
      if (!this.tokens.has(p.id)) {
        const marker = L.marker([0, 0], {
          icon: L.divIcon({
            className: 'token',
            html: `<span style="--c:${p.color};--i:${i}">${p.name.slice(0, 1)}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13 - (i - 1.5) * 9, 26],
          }),
          zIndexOffset: 1000 + i,
          keyboard: false,
        }).addTo(this.tokenLayer);
        this.tokens.set(p.id, marker);
      }
      const sq = this.graph.square(p.position);
      this.tokens.get(p.id)!.setLatLng([sq.lat, sq.lng]);
      this.tokens.get(p.id)!.getElement()?.classList.toggle('current', i === state.currentPlayer);
    });
  }

  /** コマを経路に沿って1マスずつ動かす */
  async animate(playerId: string, path: string[], msPerStep = 160): Promise<void> {
    const marker = this.tokens.get(playerId);
    if (!marker) return;
    for (const id of path) {
      const sq = this.graph.square(id);
      marker.setLatLng([sq.lat, sq.lng]);
      await new Promise((r) => setTimeout(r, msPerStep));
    }
  }

  focus(squareId: string) {
    const sq = this.graph.square(squareId);
    if (!this.map.getBounds().pad(-0.15).contains([sq.lat, sq.lng])) {
      this.map.panTo([sq.lat, sq.lng], { animate: true });
    }
  }

  private renderDestination(id: string) {
    const sq = this.graph.square(id);
    if (!this.destinationMarker) {
      this.destinationMarker = L.marker([sq.lat, sq.lng], {
        icon: L.divIcon({ className: 'destination', html: '<span>目的地</span>', iconSize: [56, 24], iconAnchor: [28, 44] }),
        interactive: false,
        zIndexOffset: 500,
      }).addTo(this.map);
    }
    this.destinationMarker.setLatLng([sq.lat, sq.lng]);
  }

  private renderHighlights(state: GameState) {
    this.highlightLayer.clearLayers();
    const phase = state.phase;
    if (phase.type !== 'chooseDestination') return;
    const isHuman = !state.players[state.currentPlayer].isCpu;
    for (const id of Object.keys(phase.options)) {
      const sq = this.graph.square(id);
      L.circleMarker([sq.lat, sq.lng], {
        radius: 13,
        color: '#ff7a00',
        weight: 3,
        fillColor: '#ffb347',
        fillOpacity: 0.35,
        className: 'reachable',
        interactive: isHuman,
      })
        .on('click', () => this.onSquareClick(sq))
        .addTo(this.highlightLayer);
    }
  }
}
