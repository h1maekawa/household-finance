# Architecture

## 全体像

```
                    AI Company
                         │
                  read-only summary
                         ▼
┌─────────────────────────────────┐
│             Flow+               │
│      Personal Finance OS        │
│                                 │
│  Budget Engine                  │
│       ↓                         │
│  Money Plan                     │
│       ↓                         │
│  Investment Capacity            │
│       ↓                         │
│  Goal Progress                  │
│       ↓                         │
│  Emergency Fund      (未実装)    │
│       ↓                         │
│  Projection          (未実装)    │
│       ↓                         │
│  Asset Planning Orchestrator    │
│       ↓         (未実装)         │
│  Dashboard / Plan / Coach       │
└─────────────────────────────────┘
                 │
                 ▼
        Supabase Auth + RLS
                 │
                 ▼
             PostgreSQL
```

## 3つの規律

**1. 計算は純関数に閉じ込める。**
`lib/services/` の金融エンジンは DB I/O を持ちません。データ収集は `app/api/` と
`lib/repositories/`、`lib/services/budget-loader.ts` が担い、集めた値を引数で渡します。
そのままテストできる形を保ってください。

**2. 同じ計算式を2箇所に書かない。**
自由に使えるお金の定義、固定費の集計、目標の逆算はそれぞれ1箇所にしかありません。
新しい機能が同じ数字を必要とする場合、再実装せず既存エンジンの結果を組み替えます。

**3. AIに金額を作らせない。**
AIへ渡すのは計算済みの Context だけです。AIの出力を金額として採用しません。

## 決定論エンジン

| ファイル | 役割 |
|---|---|
| `lib/services/budget-engine.ts` | 予算の主計算。収入・固定費の突合・変動費の実績・カテゴリ別統計から `BudgetSummary` を作る |
| `lib/services/money-plan.ts` | Money Flow の組み立て。`BudgetSummary` を滝の6ステップへ変換する |
| `lib/services/investment-capacity.ts` | 再配分できる現金と、その配分（防衛資金 / 貯金 / 資産形成 / 未配分） |
| `lib/services/liquid-cash.ts` | 流動現金の合計（純関数）。I/Oは `liquid-cash-loader.ts` |
| `lib/services/emergency-fund.ts` | 現金防衛資金の必要額と不足額 |
| `lib/services/projection.ts` | 将来資産の単純予測（利回り0%） |
| `lib/services/asset-planning.ts` | 上記を束ねる Orchestration 層。計算式を持たない |
| `lib/services/goal-progress.ts` | 目標の逆算と達成見込み判定 |
| `lib/services/goal-milestone.ts` | 目標の通過点の到達判定と、次の通過点までの距離 |
| `lib/services/fire-planner.ts` | FIRE に必要な資産の逆算。I/Oは `fire-planner-loader.ts` |
| `lib/services/scenario-engine.ts` | 条件を変えたときの目標到達の比較。I/Oは `scenario-loader.ts` |
| `lib/services/return-assumptions.ts` | 想定利回りの仮定（0/3/5/7%）。FIRE と Scenario が共有する |
| `lib/services/expense-intelligence.ts` | カテゴリ別の支出分析と見直し候補。I/Oは `expense-intelligence-loader.ts` |
| `lib/services/fixed-costs.ts` / `fixed-cost-matching.ts` | 固定費の解決と、予定と実績の突合 |
| `lib/services/upcoming-debits.ts` | 直近の引落予定 |
| `lib/services/coach-context.ts` | 上記を束ねて AI Coach 用の Context を作る |
| `lib/services/coach-rules.ts` | Context から洞察を導くルール。現状の Coach はここが本体 |
| `lib/services/money.ts` | 円の丸めと安全な比率計算 |

### money-plan の要点

`buildMoneyPlan()` は新しい計算式を持たず、`BudgetSummary` の値を組み替えるだけです。
2つの二重計上を意図的に避けています。

- **積立投資**: 固定費と投資の両方に数えると収入から2回引かれるため、固定費側から差し引いて投資ステップで1回だけ引く
- **カード請求**: 請求そのもの（`type: 'credit'`）は支出に足さない。カードで払った電気代を固定費として1回、翌月の請求として1回、と二重に数えないため

この2点は変更前に必ずテスト（`money-plan.test.ts`）を確認してください。

### 利回りは仮定であって保証ではない

`projection.ts` は利回り0%の単純積立だけを出します。ここは変えません。

FIRE の必要資産と Scenario の比較だけは利回りの仮定を置かないと計算できないため、
0% / 3% / 5% / 7%（正式シナリオ）とユーザー指定の Custom を並べて出します。
正式シナリオの定義は `return-assumptions.ts` の1箇所だけです。次を守ってください。

- 利回り0%では FIRE の必要資産は `null`（「賄えない」）。0円でも巨大な有限額でもない
- **Scenario Engine の利回り0%は既存 `projection.ts` をそのまま呼ぶ。** 同じ単純積立の式を2つ持たない
- 到達判定には必ず上限（`MAX_PROJECTION_MONTHS` = 1200ヶ月）を置く。到達しない条件で無限に回さない
- 月次複利の途中で円へ丸めない。丸めるのは出力の一度だけ
- 画面に「確実に」「必ず」と読める表現を出さない

### 税金の扱い

FIRE Planner の税率の既定は **0%（税引前シミュレーション）** です。取り崩し額へ
一律 20.315% がかかる前提は取れません（NISA の非課税枠、元本部分の取り崩し、
控除の状況で実際の税額は変わります）。20.315% は「課税を単純化した参考シナリオ」
として選べるだけで、実際の税額を示すものではありません。

税の計算は `fire-planner.ts` だけが持ちます。Scenario Engine は FIRE が出した
`requiredAssets` を目標として受け取るだけで、税を再計算しません。

### FIRE の「副業収入」は2種類ある

混同すると意味が壊れるので、別のフィールドにしています。

| 名前 | 意味 | どこが持つか |
|---|---|---|
| `postFireMonthlyIncome` | **FIRE後**に続く収入。必要な資産収入を減らす | `fire_settings`（保存する） |
| `monthlyExtraContribution` | **FIREまで**の到達を早める追加積立 | Scenario の入力（保存しない） |

### Asset Planning は計算エンジンではない

`lib/services/asset-planning.ts` は Orchestration / Composition Layer です。
既存エンジンの結果を束ねるだけで、**同じ計算式を再実装してはいけません**
（`asset-planning.test.ts` が契約として固定しています）。

```
budget-engine → money-plan → investment-capacity → goal-progress
              → emergency-fund → projection
                      ↓
                asset-planning
                      ↓
          API / Dashboard / AI Coach
```

### capacity ではなく allocation

`allocation` は「安全上いくらまで使えるか（capacity）」ではなく
「今月いくらをどこへ充てるか（allocation）」です。上限はユーザーが設定した
目標額なので、`asset_building = 30,000` は「3万円までしか投資できない」ではなく
「目標として3万円を配分している」という意味です。この違いをUIへ持ち込まないこと。

4つを「別々に使えるお金」として扱うと二重計上になります。1つの原資
（`allocatable_cash`）を次の順に分けたものです。

```
allocatable_cash
  → emergency_fund   防衛資金の補充（手元現金の振り替え）
  → savings          通常の貯金（budget.savings.target が上限）
  → asset_building   資産形成（budget.investment.target が上限）
  → unallocated_cash 残り
```

合計は常に `max(allocatable_cash, 0)` と一致します（`capacity-allocation.test.ts`）。
防衛資金が不足しているときに資産形成へ全額が回らないのは、この順序によります。

**防衛資金の確保と通常貯金を合算しないでください。** 前者は手元にある現金の
振り替え、後者は今月の貯蓄目標で、意味が違います。合算すると
「今月19万円貯金できる」のように見えてしまいます。

### 毎月の積立額

将来予測に使う積立額は `savings + asset_building` です（`monthlyAssetContribution`）。
防衛資金は既存現金の振り替えなので**含めません**。式を各所で組み立てず、
配分結果を足すだけにします。

### 流動現金は1箇所で数える

Dashboard / Assets / Investment Capacity / Emergency Fund が別々に現金を数えると
必ずズレるので、`liquid-cash.ts` に集約します。

```
accounts + 各口座の最新 account_balances（bank / cash / emoney）
  → 無ければ legacy の account_balance の最新1件
  → どちらも無ければ null
```

証券口座（`securities`）は投資資産なので流動現金に含めません。残高が一度も
記録されていない口座を0円として数えません（数えると「残高データがある」と
誤判定します）。

### 将来予測の currentAssets

`projection` に渡す `currentAssets` は**総資産**です。
`流動現金 + 株式 + 投資信託 + その他対象資産` を合わせたものを渡してください。
`account_balance` のような現金だけの値を渡すと、資産推移が実態より低く出ます。
統一した Asset Summary Loader はまだ無いので、Phase 4 で用意します。

### 防衛資金は安全側の見積り

必須生活費を `生活固定費 + 変動費予算` としているため、娯楽なども含んだ
やや大きめの必要額になります。UIでは「防衛資金の目安」「安全側に計算した」と
分かる表記にしてください。将来カテゴリへ `essential` / `discretionary` を
持たせて精度を上げる余地を残しています。

### null と 0 を区別する

`0` は「計算した結果0円」、`null` は「入力不足で計算できない」です。
口座残高が未登録なのに `saving_capacity = 0` と返してはいけません。
何が足りないかは `missingData` で伝え、UI が設定を促せるようにします。

### 金融計算に時刻を持ち込まない

純関数の中で `new Date()` を呼ぶと、同じ入力でも結果が変わりテストできません。
算出時刻は I/O 境界（API ルート）で付けます。`計算に使う「今日」`も
`budget-engine` と同じく引数で受け取ります。

## データフロー

```
リクエスト
  ↓ app/api/*/route.ts          認証・認可・入力の検証
  ↓ lib/repositories/*.ts        Supabaseアクセス
  ↓ lib/services/budget-loader.ts データ収集をまとめる
  ↓ lib/services/*.ts            純関数で計算
レスポンス
```

`budget-loader.ts` は「収集(I/O)」と「計算(純関数)」の境界です。
サーバー間連携ではセッションが無いため、`loadBudget()` は Supabase クライアントを引数で受け取れます。

## ディレクトリ規約

```
proxy.ts        Next.js 16 の Proxy（旧 middleware.ts）。ページのログイン判定
app/
  api/          RESTエンドポイント。計算式を書かない
  <画面>/       App Router のページ
lib/
  services/     決定論エンジン。DB I/Oを持たない。*.test.ts を隣に置く
  repositories/ Supabaseアクセス
  integrations/ Integration Token の scope 定義・発行・失効
  billing/      課金。Stripe と Entitlement
  supabase/     セッションクライアント生成
types/          ドメイン型。API のレスポンス形もここに寄せる
supabase/
  migrations/   連番。既存ファイルは書き換えず新しい番号を足す
```

## テスト

`npm test` は `lib/**/*.test.ts` を `node --test` で実行します
（`scripts/register-test-resolver.mjs` が `@/` エイリアスを解決）。

現在のテスト対象: `budget-engine` / `money-plan` / `goal-progress` / `coach-rules` /
`fixed-costs` / `fixed-cost-matching` / `fixed-cost-preset` / `cashflow`。

金融計算を変更するときは、先にテストを足してから実装してください。

## 既知の技術的負債

改善の方針は [SECURITY.md](SECURITY.md) と [BILLING.md](BILLING.md) に書いています。

| 項目 | 現状 |
|---|---|
| Schema Reproducibility Debt | 後述 |
| service_role の多用 | 44 の API ルートのうち 25 が `supabaseAdmin` を使い RLS をバイパスしている。RLSポリシー自体は揃っているため、多くはセッションクライアントへ移行できる |
| Rate Limit | 未実装。`proxy.ts` はページのログイン判定のみで、matcher が `/api` を除外している |
| セキュリティヘッダー | 未設定（`next.config.ts` は turbopack 設定のみ） |
| `investment-capacity` | `investable_amount` の1本のみで、貯金余力と資産形成余力を分離していない |

## Schema Reproducibility Debt

`supabase/migrations/` はスキーマの完全な定義ではありません。次の4テーブルは
`create table` がどのマイグレーションにも存在せず、001 より前に別経路
（Supabase の SQL Editor 等）で作成されています。

```
transactions
scheduled_payments
account_balance
stock_holdings
```

RLS とポリシーは `001_multi_user_rls.sql` の動的ループが
`to_regclass` で存在を確認してから付与しているため、**現行のDBに穴はありません**。
問題は再現性のほうです。

影響するのは次の場面です。

- clean environment の構築
- disaster recovery
- CI でのDB再構築
- staging 環境の作成

いずれも「migrations を空のDBへ順に流す」ことが前提になりますが、上記4テーブルは
作成されないため 001 のループが空振りし、後続のマイグレーションも失敗します。

**新しい `create table` マイグレーションを足して解決してはいけません。**
既存の Production DB と衝突する可能性があります。別タスクとして次の順で扱います。

```
現DB schema dump → migrations との差分確認 → baseline 作成 → clean DB 再構築テスト
```

`supabase db dump` によるスナップショットを baseline に据える案を検討中です。
