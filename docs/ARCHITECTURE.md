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
| `lib/services/investment-capacity.ts` | 当月の投資可能額。口座残高・入金予定・支払予定・生活維持資金から算出 |
| `lib/services/goal-progress.ts` | 目標の逆算と達成見込み判定 |
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

### Asset Planning は計算エンジンではない

`lib/services/asset-planning.ts`（未実装）は Orchestration / Composition Layer です。
既存エンジンの結果を束ねるだけで、**同じ計算式を再実装してはいけません**。

```
budget-engine → money-plan → investment-capacity → goal-progress
              → emergency-fund → projection
                      ↓
                asset-planning
                      ↓
          API / Dashboard / AI Coach
```

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
