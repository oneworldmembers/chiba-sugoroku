# ちばすご！ — 千葉町名すごろく

千葉県の**町名ひとつひとつがマス**になった、すごろく型の物件経営ボードゲームです。
サイコロを振って目的地をめざし、止まった町で物件を買い、3月の決算で収益を得て総資産を競います。

「市川市国府台」「船橋市本町」「銚子市犬吠埼」……地元の地名がそのままマスになるのが特徴です。

> [!NOTE]
> 本作は個人による非公式のファンメイド作品で、既存の商用ゲーム（「桃太郎電鉄」など）やその権利者とは一切関係ありません。
> 既存作品の名称・キャラクター・固有の用語は使わない方針です（[CONTRIBUTING.md](CONTRIBUTING.md) 参照）。

**▶ 遊ぶ: https://oneworldmembers.github.io/chiba-sugoroku/**

## 特徴

- 🗾 **町名レベルのメッシュ**：公開データから千葉県全域の町（丁目をまとめた単位）をマスとして生成できます
- 🎲 **双六＋物件経営**：目的地一番乗りで賞金、物件を独占すると収益2倍
- 🤖 **CPU 対戦**：1人でも遊べます（最大4人）
- 🧩 **ルールと UI を分離**：`src/core` は DOM に依存しない純粋関数なので、テスト・別 UI・サーバー対戦に流用できます
- 💾 **再現可能**：乱数の状態をゲーム状態に含めているので、保存・再開・リプレイが簡単
- 🗺 **地理院タイル**を背景にした地図 UI（Leaflet）

## すぐ遊ぶ

```bash
git clone https://github.com/oneworldmembers/chiba-sugoroku.git
cd chiba-sugoroku
npm ci
npm run dev        # http://localhost:5173
```

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm test` | テスト（ルール・盤面生成・同梱盤面の検証） |
| `npm run build` | 型チェック＋本番ビルド（`dist/`） |
| `npm run board:sample` | サンプル盤面 `public/boards/chiba-sample.json` を再生成 |
| `npm run board:build -- ...` | 公開データから盤面を生成（下記） |

## ルール（v0.1）

1. 全員が千葉駅（千葉市中央区富士見）からスタート。初期資金 3,000万円
2. 手番ではカードを使うか、サイコロを振る
3. 出た目の数だけちょうど進めるマスが光るので、止まるマスを選ぶ（直前のマスへすぐ引き返すのは不可）
4. 止まったマスの効果
   - ⬜ **物件マス**：物件を買える
   - 🟦 **プラスマス**：お金がもらえる
   - 🟥 **マイナスマス**：お金を失う
   - 🟨 **カードマス**：カードを1枚もらう（最大8枚）
5. **目的地**に一番乗りすると賞金。次の目的地が決まる
6. 全員が1回ずつ動くと1か月経過。**3月末に決算**で物件収益（価格×利回り）を受け取る。町内の物件を独占すると2倍
7. 規定年数が終わった時点で、所持金＋物件価格の**総資産**が多い人の勝ち

詳しい設計は [docs/DESIGN.md](docs/DESIGN.md) を見てください。

## 盤面データを作る

盤面は `public/boards/*.json`（形式は `src/core/types.ts` の `Board`）で、`scripts/build-board.ts` で生成します。
3種類の入力に対応しています。

### 1. 手書き CSV（同梱のサンプル）

[`data/towns.sample.csv`](data/towns.sample.csv) を編集して `npm run board:sample`。

| 列 | 例 | 説明 |
| --- | --- | --- |
| `city_code` | `12203` | 市区町村コード（5桁） |
| `city` / `town` | `市川市` / `国府台` | 市区町村名・町名 |
| `lat` / `lng` | `35.743` / `139.905` | 代表点の緯度経度 |
| `kind` | `academic` | 町の性格（物件の自動生成に使う）：`commercial` `residential` `tourism` `port` `agri` `airport` `academic` `industrial` |
| `rank` | `3` | 1〜5。3以上は物件マスになる |
| `properties` | `古書店:600:10\|定食屋:900:9` | 物件を手書きする場合（名前:価格万円:利回り%）。空なら自動生成 |

> サンプルの座標は駅や中心部付近のおおよその値です。

### 2. 国土交通省「位置参照情報」（大字・町丁目レベル）— おすすめ

[位置参照情報ダウンロードサービス](https://nlftp.mlit.go.jp/isj/)から千葉県の「大字・町丁目レベル」CSV を取得し、`data/raw/` に置きます（`data/raw/` は `.gitignore` 済み）。

```bash
# 市川市・船橋市だけで盤面を作る。丁目は町名にまとめ、近い町同士をつなぐ
npm run board:build -- \
  --input data/raw/12_2024.csv --format mlit \
  --city 12203,12204 \
  --overrides data/towns.sample.csv \
  --out public/boards/ichikawa-funabashi.json \
  --id ichikawa-funabashi --name "市川・船橋 町名盤"
```

`--overrides` に手書き CSV を渡すと、一致する町（市区町村コード＋町名）の性格・ランク・物件で上書きします。

### 3. e-Stat 国勢調査 小地域境界データ（ポリゴン）

境界ポリゴンを使うと「実際に隣り合っている町」同士が辺になり、より地図に忠実な盤面になります。
e-Stat の統計GIS から千葉県の小地域境界（世界測地系緯度経度・Shapefile）を取得し、GeoJSON に変換して使います。

```bash
npx mapshaper -i data/raw/r2ka12.shp encoding=shiftjis -o format=geojson data/raw/chiba.geojson
npm run board:build -- --input data/raw/chiba.geojson --city 12203 --out public/boards/ichikawa.json --id ichikawa --name "市川市 町名盤"
```

生成した盤面は `public/boards/index.json` に1行追加するとタイトル画面で選べるようになります。

> [!IMPORTANT]
> 公開データを使った盤面を配布するときは、各データの利用規約に従い出典を表記してください。
> `build-board.ts` は形式に応じた出典を盤面 JSON の `attribution` に自動で入れ、ゲーム画面に表示します。
> 規約は変わることがあるので、公開前に必ず提供元のページで最新の条件を確認してください。

## ディレクトリ構成

```
src/
  core/          ルール本体（DOM 非依存）
    types.ts       型定義（Board / Square / GameState …）
    graph.ts       盤面グラフ：最短距離、N歩で止まれるマス
    game.ts        状態遷移：roll / move / buy / endTurn / 決算
    cards.ts       カード定義
    ai.ts          CPU
    rng.ts         再現可能な乱数
  ui/map.ts      Leaflet による地図描画
  main.ts        画面とゲーム進行の制御
scripts/
  build-board.ts 盤面生成 CLI
  lib/           CSV・幾何・物件生成
data/            手書きの町データ
public/boards/   生成済み盤面 JSON
tests/           Vitest
```

## GitHub Pages で公開する

`.github/workflows/deploy.yml` を同梱しています。リポジトリの **Settings → Pages → Source** を「GitHub Actions」にすると、`main` への push で自動デプロイされます。

## ロードマップ

- [ ] 千葉県全域の町名盤（数千マス）向けに「路線」レイヤー：鉄道でつながる町は数マスをまとめて進める
- [ ] 市区町村単位の拡大・縮小表示、町境ポリゴンの描画
- [ ] 物件データのコミュニティ編集（名物・地場産業を反映）
- [ ] 季節イベント（落花生の収穫、潮干狩り、成田山の初詣 など）
- [ ] 借金時の物件売却、妨害キャラクター（オリジナル）
- [ ] オンライン対戦（`src/core` をサーバーで共有）

## コントリビュート

町データの追加・修正、ルール提案、バグ報告を歓迎します。[CONTRIBUTING.md](CONTRIBUTING.md) を見てください。

## ライセンス

コードは [MIT License](LICENSE)。
地図タイル・公開データにはそれぞれの提供元の利用条件が適用されます。
