# Version 3.0 設計レビュー — 「AIを中心とした資産管理OS」への移行

Date: 2026-07-23
Reviewer stance: プロダクトアーキテクト（コードレビューではなく、プロダクト全体設計）
Roadmap前提: 家計簿 → 資産管理 → AIライフプランナー → 家族共有 → サブスクリプション

---

## 0. 結論サマリ（先に読む用）

現状のコードベースは「個人用家計簿＋投資記録」としては**想定以上に土台が整っています**。マルチユーザー・RLS・Stripe課金・Gmail取込・投資CSV取込・カスタムカテゴリまで既にある。V3.0で目指す「AIライフプランナー付き資産管理OS」に進むにあたって、作り直しは不要です。**ただし、そのまま5年運用すると必ず詰まる構造的な地雷が4つ**あります。これを直すのが最優先で、AI機能はその上に載せるべきです。

**4つの地雷（すべてMUST）**

1. **全APIが `service_role`（`supabaseAdmin`）でDBアクセスし、`user_id` を手書きフィルタしている。** RLSは有効だが実質バイパスされている。25本のAPIのうち1本でも `.eq('user_id', ...)` を書き忘れれば**全ユーザーの資産情報が漏れる**。課金・資産・AIを扱うプロダクトでこれは許容できない。
2. **口座が「単一残高（`account_balance`）」でしか管理されていない。** V3要件⑥（口座別資金管理）とⅤ⑤（引落口座別の残高計算）は、`accounts` テーブルが無いと成立しない。今の `bank_account` は `credit_cards` と `scheduled_payments` に**フリーテキストで重複保存**されていて参照整合性が無い。
3. **AIが「単発JSON抽出」しかできない。** `lib/gemini.ts` はプロンプト1回投げてJSONを取るだけ。会話履歴・ユーザー文脈・ツール実行・キャッシュの概念が無い。「人生設計パートナー」はこの延長では作れない。エージェント基盤を別レイヤーとして新設する必要がある。
4. **課金が「買い切り（`pro_lifetime`）」設計で、月額サブスクに対応していない。** `user_entitlements` にサブスクのライフサイクル（更新日・解約・支払失敗）カラムが無く、`requireActiveEntitlement()` はenv フラグ待ちで**どのAPIからも呼ばれていない**。収益化の中核をここに載せるなら作り直しが要る。

**進め方の推奨**: 「画面から作る」誘惑を断ち、**Phase 0（基盤の是正）→ Phase 1（口座・予算のデータモデル）→ Phase 2（AIエージェント基盤）→ Phase 3（サブスク＋家族共有）** の順で進める。詳細は §12。

---

## 1. 現状アーキテクチャの棚卸し（レビューの根拠）

実際に確認した構成。

### 技術スタック
- Next.js 16.2.9（App Router）+ React 19 + TypeScript + Tailwind v4
- Supabase（Postgres + Auth + RLS）、`@supabase/ssr` でCookieセッション
- Vercelデプロイ想定、Stripe課金、Gemini（`@google/generative-ai`）、Yahoo Finance（`yahoo-finance2`）
- Gmail取込はGAS経由（アプリはGmailトークンを持たない — セキュリティ設計として良い）

### データモデル（migrations 001–017 実在テーブル）
| ドメイン | テーブル |
|---|---|
| 家計 | `transactions`（kind, category, manual_category, auto_category, card_issuer, external_id, needs_review）, `scheduled_payments`（固定費・予定, bank_account, last_paid_month, source）, `account_balance`（単一残高）, `custom_categories`, `merchant_rules` |
| カード | `credit_cards`（card_type, card_plan, closing_day_int, payment_day_int, bank_account） |
| 投資 | `portfolios`, `holdings`, `stock_holdings`, `fund_holdings`, `transactions_stock`, `investment_transactions`, `watchlist`, `fx_rates`, `news_items`, `earnings_calendar` |
| 借金 | `debts` |
| ユーザー | `users_profile`（initial_balance, monthly_income, income_day）, `user_entitlements`（課金）, `user_import_secrets`（GAS連携秘密鍵） |

### アクセスパターン（重要）
- 全25 APIルートが `supabaseAdmin`（service_role）でクエリし、コード内で `.eq('user_id', user.id)` を手書き。
- RLSポリシー（`auth.uid() = user_id`）は定義されているが、service_roleはRLSを**無視する**ため、事実上「アプリコードのフィルタが唯一の防御線」。
- 認証は `getAuthenticatedUser()` がCookie優先＋Bearer対応（`lib/auth.ts`）。ここは堅い。

### ビジネスロジックの居場所
- `lib/cashflow.ts`（キャッシュフロー予測・カード請求生成、純関数）— 設計は良い
- `lib/card-payment-rules.ts`（カード締め日ルール）— 先日リファクタ済み
- `lib/gemini.ts`（AI）— 単発抽出のみ
- **ただし、月アンカー計算・カードマッチング等の一部ロジックがページコンポーネント（`app/cashflow/page.tsx`）に直書き**されている。マルチプラットフォーム展開の障害になる（§4）。

---

## 2. 中核となる設計判断（ここを間違えると5年後に効く）

AI機能より前に、以下3つの「土台の思想」を確定させることを強く推奨します。

### 判断A: DBアクセスは service_role から「RLS + authenticatedクライアント」へ寄せるか
現状は全部service_role。これは開発が速い反面、**セキュリティを人間の注意力に依存**する。資産・課金を扱うなら、読み取り系はRLSが効くユーザーセッションクライアントに寄せ、service_roleはWebhook等の管理操作に限定すべき（§9でMUST指定）。

### 判断B: 「お金」の型を統一するか
現状 `numeric` と `integer` が混在（`transactions.amount` はnumeric扱い、円）。TS側は全部 `number`。円は最小単位が1円なので**整数円で統一**し、外貨・FXが絡む投資値だけ別扱いにする方針を明文化すべき。浮動小数の丸め事故は家計アプリで信用を失う。

### 判断C: 「口座（accounts）」を第一級エンティティにするか
V3要件⑤⑥は口座が主役。`account_balance`（単一残高）→ `accounts`（口座マスタ）+ `account_balances`（口座別残高スナップショット）へ昇格させ、`transactions`・`scheduled_payments`・`credit_cards` から `account_id` でFK参照させる。これが**V3全体の背骨**になる。

---

## 3. 【観点①】アーキテクチャ — 5年運用できるか

**評価: 現状の「Next.js API Routes + Supabase」構成は5年戦える。フレームワークの入れ替えは不要（MUSTではない）。** ただしレイヤリングを1段追加すべき。

現状は「APIルート = 認証 + DBクエリ + ビジネスロジック + 整形」が1ファイルに同居している。これはドメインが増えると破綻する。

**提案する層構造（既存を活かす）**
```
UI (web / 将来 iOS・Android)
  ↓  HTTP (REST)  ← 契約はここで固定（§4）
API Route（薄いコントローラ：認証・入力検証・レスポンス整形のみ）
  ↓
Service層 lib/services/*.ts（ドメインロジック。純粋・テスト可能）
  ↓
Repository層 lib/repositories/*.ts（Supabaseアクセスを1箇所に集約）
  ↓
Supabase（RLS）
```

- **MUST**: Repository層を作り、`supabaseAdmin` の直接呼び出しをAPIルートから排除する（§9のセキュリティと直結）。`user_id` フィルタをRepositoryに閉じ込めれば、書き忘れ事故が構造的に起きなくなる。
- **SHOULD**: `lib/cashflow.ts` のような純関数スタイルを他ドメイン（budget, lifeplan）にも展開。副作用ゼロ＝ユニットテストで数値の正しさを担保できる。
- **COULD**: 将来のバックグラウンド処理（相場更新・AI日次分析・通知）に備え、Supabase Edge Functions か Vercel Cron + キューを想定。今は不要だが、AI日次コーチ（要件④）で必ず必要になる。

---

## 4. 【観点③】コンポーネント設計 — Web/iOS/Android展開

**評価: 現状はページ内にロジックが混在し、そのままではネイティブに再利用不可。ただしAPI駆動なので分離しやすい。**

- **MUST**: **ドメインロジックをコンポーネントから完全に抜く。** 例として `app/cashflow/page.tsx` に「月アンカー計算」「カードマッチング」「集計」が直書きされている。これらは `lib/services/cashflow-view.ts` に移し、ページは表示だけにする。iOS/Androidは同じ計算を再実装せず、**同じAPIレスポンスを消費**する形にする。
- **MUST**: **APIをクライアント非依存の契約として設計する。** 「今月あと使える額」「口座別残高」「AI提案」などは、Webのためだけでなく汎用JSONとして返す。ネイティブアプリはこのAPIを叩くだけにする（＝ロジックの単一の真実の源はサーバー）。
- **SHOULD**: 表示用の型（`types/*.ts`）はWeb/native共通パッケージに切り出せる形にしておく（将来 monorepo 化）。今のうちに `types/` を「APIの契約」として厳密に保つ。
- **SHOULD**: デザイントークン（`globals.css` の色 `#1476B3` 等）を変数に集約し、ネイティブとブランド共通化できるようにする。
- **COULD**: 共通UIはReact Native / Expo移植を見据え、ロジックとプレゼンテーションを分けた「Headlessコンポーネント」パターンを採用。今は時期尚早。

**結論**: ネイティブ展開の鍵は「UIの共通化」ではなく「**ロジックをサーバーAPIに集約し、クライアントを薄く保つ**」こと。ここを徹底すればWeb/iOS/Androidは同じ頭脳を共有できる。

---

## 5. 【観点②】DB設計 — 固定費・AI・ライフプラン・Premium・家族共有まで

現状を活かしつつ、V3で追加すべきテーブルを提案します。DDLはスケッチ（本実装時にRLS・grant・indexを付ける）。

### 5.1 口座（要件⑤⑥の背骨）— MUST
```sql
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                    -- '三井住友銀行' '楽天銀行'
  type text not null,                    -- 'bank' | 'emoney' | 'cash' | 'securities'
  institution text,                      -- 金融機関名（表示・集計用）
  is_primary boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table account_balances (           -- 口座別の残高スナップショット（時系列）
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  balance integer not null,               -- 整数円（§2 判断B）
  recorded_at timestamptz not null default now()
);
```
- 既存 `credit_cards.bank_account`（text）→ `credit_cards.debit_account_id`（FK）へ移行。
- 既存 `scheduled_payments.bank_account`（text）→ `scheduled_payments.debit_account_id`（FK）へ移行。
- `transactions` に `account_id`（nullable、現金・カード利用元の口座）を追加。
- これで「家賃58,330円が26日に三井住友から引き落とされる。26日までに口座へいくら残すべきか」がFK1本で計算できる（＝要件⑤の核心）。

### 5.2 予算（要件③）— MUST（別途 `docs/budget-design.md` で詳細設計済み）
`budgets`（月次・収入/固定費/投資/貯蓄/予備費/自由予算）+ 将来の `budget_categories`（カテゴリ別推奨枠）。詳細は既存の予算設計メモを参照。V3ではこれに「AIが推奨枠を提案 → ユーザーが承認」のフローを足す。

### 5.3 ライフプラン・目標（要件②）— MUST
```sql
create table life_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                    -- 'fire' | 'house' | 'car' | 'education' | 'savings' | 'custom'
  title text not null,
  target_amount integer,                 -- 目標額（整数円）
  target_date date,                      -- 達成目標日
  priority integer not null default 0,
  monthly_contribution integer,          -- 逆算した毎月の積立額（AIが算出）
  status text not null default 'active', -- 'active' | 'achieved' | 'paused'
  assumptions jsonb,                     -- 利回り・インフレ等の前提（AI再計算用）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table life_events (               -- キャッシュフローに影響する将来イベント
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references life_goals(id) on delete set null,
  title text not null,
  event_date date not null,
  amount integer not null,               -- 収入は正・支出は負、または別カラムで方向
  recurrence text,                       -- null=単発 / 'yearly' 等
  created_at timestamptz not null default now()
);
```
- `life_events` はキャッシュフロー予測（§8）の入力になる。これで「教育資金」「車購入」を予測に織り込める。

### 5.4 AIエージェント（要件①④）— MUST
```sql
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);
create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,                    -- 'user' | 'assistant' | 'tool'
  content text,
  tool_calls jsonb,                      -- 実行したツールと引数（監査・再現用）
  token_usage jsonb,                     -- コスト計測（課金・レート制御）
  created_at timestamptz not null default now()
);
create table ai_insights (               -- 日次コーチが生成する洞察（要件④）
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                    -- 'overspend' | 'transfer_suggestion' | 'upcoming_debit' | 'on_track'
  severity text not null,                -- 'info' | 'warning' | 'action'
  title text not null,
  body text,
  payload jsonb,                         -- 「楽天へ22,000円移動」等の構造化アクション
  status text not null default 'new',    -- 'new' | 'seen' | 'dismissed' | 'done'
  generated_for date not null,           -- どの日の分析か
  created_at timestamptz not null default now()
);
create table ai_user_memory (            -- エージェントの長期記憶（要件①の"理解する"の実体）
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb,                         -- 価値観・重視点・リスク許容度など
  updated_at timestamptz not null default now()
);
```

### 5.5 サブスク課金（要件⑧）— MUST（現状の買い切りを拡張）
現 `user_entitlements`（plan=pro_lifetime）に以下を追加、または `subscriptions` を新設：
```sql
alter table user_entitlements
  add column billing_type text default 'lifetime',      -- 'lifetime' | 'subscription'
  add column current_period_end timestamptz,            -- 更新期限
  add column cancel_at_period_end boolean default false,
  add column stripe_subscription_id text,
  add column last_payment_status text;                  -- 'paid' | 'past_due' | 'canceled'
```
- Webhookで `customer.subscription.updated` / `deleted` / `invoice.payment_failed` を処理する必要がある（現状は `checkout.session.completed` のみ）。

### 5.6 家族共有（ロードマップ後段）— SHOULD（今は"壊さない設計"だけ）
```sql
create table households (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  name text,
  created_at timestamptz not null default now()
);
create table household_members (
  household_id uuid references households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'member',   -- 'owner' | 'member' | 'viewer'
  primary key (household_id, user_id)
);
```
- **今やるべきは実装ではなく「所有権モデルの決定」**。全テーブルが `user_id` 単独所有の今、後から家族共有を足すとRLSを全面書き換えになる。**先に「所有スコープは user_id か household_id か」を1箇所（Repository層）で切り替えられる設計**にしておくのがCOULD→SHOULDの肝。

### 5.7 カテゴリ手動化（要件⑦）— SHOULD
- 既に `transactions.manual_category` / `auto_category` カラムは存在（migration 017）。土台はある。
- V3方針「未分類 → 手動 → AI提案 → 自動ルール」に合わせ、`transactions` に `category_status text`（'unclassified' | 'manual' | 'ai_suggested' | 'rule'）を追加し、優先順位を明示的に持たせる。
- 1レシート内の費目混在（食材・日用品・タバコ）に備え、将来的に `transaction_splits`（1取引を複数費目に分割）テーブルをCOULDで想定。要件⑦の「スーパーで混在」を本気で解くならこれが必要。

---

## 6. 【観点④】AI設計 — 「アプリ内エージェント」として

**評価: 現状の `lib/gemini.ts`（単発JSON抽出）はV3の要件①④を満たせない。エージェント層を新設する。** これはV3で最も設計が重要な部分。

チャットボットと「エージェント」の違いは、**ツールを持ち、ユーザーの実データを文脈として理解し、行動提案まで出す**こと。以下の4点を分離して設計する。

### 6.1 コンテキスト管理 — MUST
- LLMのプロンプトに家計・投資・口座・目標を毎回全部詰めるのは**コストと精度の両面で破綻**する。
- **2層コンテキスト**にする：
  - **静的サマリ**（`ai_user_memory` + 事前集計）: 月収・固定費合計・総資産・目標・価値観。安価に毎回渡す。
  - **動的取得**（ツール経由）: 「今月の食費は?」と聞かれたら、その時だけ集計ツールを呼ぶ。全取引をプロンプトに入れない。
- サーバー側で「ユーザー文脈スナップショット」を組み立てる `lib/ai/context.ts` を新設。

### 6.2 ツール設計 — MUST
- エージェントに**関数（ツール）**を持たせ、LLMには「どのツールを呼ぶか」だけ判断させる。Gemini の function calling / または汎用のツールディスパッチャを自前で持つ。
- 最小ツールセット案：
  - `get_spending(period, category?)` — 支出集計
  - `get_cashflow_projection(days)` — 既存 `projectCashflow()` を再利用
  - `get_account_balances()` — 口座別残高（§5.1）
  - `get_goals_progress()` — 目標進捗
  - `suggest_budget()` — 予算提案（§5.2）
  - `propose_transfer(from, to, amount)` — 資金移動提案（**実行はしない。提案のみ**。要件⑥）
- **重要な安全設計**: AIは「提案」だけ生成し、**送金・取引・課金などの実行は必ず人間の承認を挟む**。`propose_*` 系ツールは `ai_insights` に構造化アクションを書くだけにする。
- ツール実行結果とtool_callsは `ai_messages.tool_calls` に保存（監査・デバッグ・再現性）。

### 6.3 プロンプト管理 — MUST
- プロンプトをコード直書き（今の `TRANSACTION_PROMPT` 等）から**バージョン管理された別ファイル/DB**へ。`lib/ai/prompts/` にMarkdownかTSで置き、変更履歴を追えるようにする。
- システムプロンプト（人格・禁止事項・金融アドバイスの免責）を1箇所に集約。「投資助言は一般情報であり保証しない」旨をシステムレベルで固定（§9・法的観点）。
- モデル名（今 `gemini-1.5-flash` 直書き）を設定に外出しし、用途別に切替可能に（抽出は安いモデル、ライフプラン相談は賢いモデル）。**要件の「違うAPIキー」も、この設定レイヤーで `provider/model/apiKey` を用途別に持てば自然に実現できる。**

### 6.4 キャッシュ — SHOULD
- **決定的処理はLLMに投げない。** 予算計算・キャッシュフロー・口座残高は純関数（§3）で出し、LLMには「解釈と文章化」だけさせる。これが最大のコスト削減＆精度向上。
- ユーザー文脈スナップショットを短時間キャッシュ（数分）。同一セッションで毎回集計し直さない。
- 日次コーチ（要件④）は**バッチ**で回す（全ユーザー分を夜間に生成し `ai_insights` に保存）。ユーザーが開くたびにLLMを呼ばない。これはコストとサブスク採算に直結。

### 6.5 提案するAIレイヤー構成
```
components/AIAssistant（右下常駐UI・全画面共通）
  ↓  POST /api/ai/chat（会話） / GET /api/ai/insights（日次コーチ）
lib/ai/agent.ts        … オーケストレーション（文脈構築→LLM→ツール→保存）
lib/ai/context.ts      … ユーザー文脈スナップショット
lib/ai/tools/*.ts      … 各ツール（既存lib/servicesを呼ぶだけ）
lib/ai/prompts/*       … プロンプト（バージョン管理）
lib/ai/provider.ts     … LLMプロバイダ抽象（Gemini今／将来他社、用途別キー）
```
- **provider抽象化はMUST寄りのSHOULD**。Geminiに密結合すると、モデル移行やコスト最適化で詰まる。インターフェースだけ切っておけば安い。

---

## 7. 【観点①再掲・エージェント常駐UX】右下常駐アシスタント

- 全画面共通の常駐は `app/layout.tsx` に `<AIAssistant/>` を1つ置くのが正解（現状 `ToastProvider` と同じ階層）。画面ごとに実装しない。
- 常駐アシスタントには**現在の画面コンテキスト**（今どの月・どの口座を見ているか）を渡すと「この固定費、来週引き落としですよ」のような画面連動の助言ができる。これがチャットボットとの差別化。

---

## 8. 【観点⑤】キャッシュフロー — cashflow.ts の拡張耐性

**評価: `lib/cashflow.ts` の純関数設計は良い。ただし「取引ベースのカード請求生成」だけを前提にしており、固定費・ライフイベント・投資積立を足すと単一関数が肥大化する。**

現状 `projectCashflow()` は「残高 + 予定支払い」を日次で回すシンプルな構造。ここに要件を足すには、**入力を「イベントの集合」に一般化**するのが最善。

- **SHOULD**: キャッシュフローの入力を統一イベント型に抽象化する。
```ts
type CashflowEvent = {
  date: string
  amount: number          // 収入+ / 支出-
  kind: 'income' | 'fixed' | 'card_debit' | 'life_event' | 'investment' | 'manual'
  accountId?: string      // どの口座に効くか（§5.1）
  source: string
}
```
  - カード請求生成・固定費・給与・`life_events`・投資積立が、それぞれ `CashflowEvent[]` を吐く**独立したジェネレータ**になる。`projectCashflow()` は全イベントをマージして残高を回すだけ。
  - これで要件が増えても「新しいジェネレータを足す」だけで済み、コア関数は不変（オープン/クローズド原則）。
- **MUST（口座対応）**: 予測を「総残高」だけでなく**口座別**に出せるようにする（要件⑤⑥）。`CashflowEvent.accountId` があれば、口座ごとの残高推移が計算でき「26日までに三井住友へいくら」が出る。
- **SHOULD**: 現状は毎リクエストで全取引を取得して再計算（`getCashflowFetchStart()` = 3ヶ月前〜）。取引が数万件になると重くなる（§10）。予測は「確定済み残高スナップショット + 差分」で計算する方式に将来移行できる余地を残す。
- **COULD**: モンテカルロ的な「投資リターンのブレを考慮した資産予測」。FIRE試算（要件②）で効くが、まずは決定的な線形予測で十分。

---

## 9. 【観点⑦】セキュリティ — 課金・AI・資産情報を扱う前提

ここは**プロダクトの生死に関わる**ので厳しめに。

- **MUST — RLSバイパスの是正**: 全APIが `service_role` を使い `user_id` を手書きフィルタしている。これは「1箇所の書き忘れ = 全ユーザーの資産漏洩」。対策：
  1. 読み取り系APIは**ユーザーセッションのSupabaseクライアント**（RLSが効く）に移行する。`.eq('user_id')` を書き忘れてもRLSが守る二重防御にする。
  2. `service_role` はWebhook・バッチ・GAS連携など「ユーザー文脈が無い管理操作」に限定。
  3. 移行前段として、Repository層（§3）に `user_id` フィルタを強制する型設計を入れ、生の `supabaseAdmin` をAPIから禁止（lint ルール化）。
- **MUST — AIエンドポイントのレート制限とコスト上限**: LLMは1リクエストが実コスト。認証済みでも**ユーザー単位のレート制限**と**月間トークン上限**（プラン別）を入れないと、課金前に破産する。`ai_messages.token_usage` を集計してガードする。
- **MUST — 金融アドバイスの免責**: 投資・税・資金移動の助言は法的リスク。システムプロンプトに「一般情報であり投資助言ではない」を固定し、UIにも明示。これは§6.3と一体。
- **SHOULD — Stripe Webhookの堅牢化**: 署名検証は実装済み（timing-safe）で良い。ただしサブスク移行時は `payment_failed`・`subscription.deleted` を処理し、**支払失敗時に自動でエンタイトルメントを落とす**。冪等性（同一イベント再送）も担保する。
- **SHOULD — 監査ログ**: 資産・課金・AI提案の重要操作を記録する `audit_log`。家族共有が入ると「誰が何を変更したか」が必須になる。
- **SHOULD — PII/機密の扱い**: 資産額・口座情報をLLMプロバイダに送る際、送信範囲を最小化（§6.1の2層コンテキスト）。ユーザーへのデータ利用説明（プライバシーポリシー）を用意。
- **COULD — service_roleキーの露出面縮小**: 現状 `lib/supabase.ts` でモジュールロード時にservice_roleクライアントを生成。Repository層に隔離し、誤importを防ぐ。

---

## 10. 【観点⑥】パフォーマンス — 数万取引・数百固定費・複数口座

- **ボトルネック1 — キャッシュフローの全件再計算**: `/api/cashflow` が毎回3ヶ月分の全取引を取得しメモリで集計（`buildGeneratedCreditPayments`）。取引数万件 × アクセス毎で重い。
  - **SHOULD**: カード請求見込みを日次バッチで事前計算し `scheduled_payments`（generated）に保存。リクエスト時は読むだけ。
- **ボトルネック2 — インデックス**: `transactions` は `(user_id, external_id)` と `(user_id, needs_review, date)` はあるが、**集計の主軸 `(user_id, date)` / `(user_id, category, date)` の複合インデックスが要る**（分析API・予算・AIツールが全部ここを叩く）。— MUST（安く効く）
- **ボトルネック3 — N+1とラウンドトリップ**: 口座別残高・目標進捗をAIツールが個別に叩くと往復が増える。集計はDBの集計クエリ（`group by`）に寄せ、アプリ側ループを避ける。— SHOULD
- **ボトルネック4 — 相場取得**: Yahoo Finance を都度呼ぶと遅く不安定。`fx_rates` のように**価格スナップショットをキャッシュ**し、バッチ更新に寄せる。— SHOULD
- **COULD**: 取引が本当に大量になったら月次サマリのマテリアライズドビュー。まだ早い。

---

## 11. 【観点⑧⑨】UX と 収益化

### UX（毎日開きたくなる家計簿）— 主にSHOULD/COULD
- **MUST（土台）**: 起動直後に「今日の1画面」＝ 今月あと使える額・今日の要注意（引き落とし接近・食費オーバー）・目標進捗。今の情報設計は画面が分散しているので、**ホームに"今日"を集約**する。
- **SHOULD**: 日次AIコーチ（要件④）を**通知/バッジ**として届ける。「開くと新しい洞察が1つある」状態が習慣化のフック。`ai_insights` の未読で駆動。
- **SHOULD**: 未分類取引の「1タップ分類」体験（要件⑦）。手動分類を基本にするなら、そこが**最も摩擦になる**ので、UXで徹底的に軽くする（候補提示・スワイプ分類）。ここの体験品質がリテンションを左右する。
- **COULD**: 目標達成の可視化（FIREまであと何年、教育資金の積立進捗バー）。「毎日開く」の情緒的動機になる。

### 収益化（月100円〜、AIライフプランナー中心のSaaS）— 提案
- **月100円は"AIライフプランナー"の価値に対して安すぎる懸念**。100円は「習慣アプリ」の値付けで、AIの実コスト（LLM）を割ると赤字になりやすい。段階設計を推奨：
  - **Free**: 手動家計簿・口座別残高・基本キャッシュフロー（AIは月数回まで）
  - **Standard（例 月480円前後）**: AIコーチ日次・予算自動提案・目標逆算
  - **Premium（例 月980円前後）**: 無制限AI相談・家族共有・高度ライフプラン（FIRE試算・投資反映）
- **MUST（今やる設計）**: §5.5のサブスク・データモデルと、**機能ゲート（feature flag）を1箇所で判定する仕組み**（`lib/entitlements.ts` を「プラン → 使える機能」のマップに拡張）。現状 `requireActiveEntitlement()` はどのAPIからも呼ばれていないので、**ゲートを実際に配線する**。
- **SHOULD**: AIコストをプラン別トークン上限で制御（§9）。採算はここで決まる。
- **COULD**: 年払い割引、トライアル、紹介。まずはゲートとサブスク基盤が先。

---

## 12. リファクタリング優先順位（実装を活かす順序）

各フェーズは独立して価値が出る・検証できる単位に分割。**AI機能は Phase 2 まで着手しない**のが安全（土台の上に載せる）。

### Phase 0 — 基盤是正（AIの前に必ず）★最優先
1. **Repository層の新設**と `supabaseAdmin` のAPI直呼び排除（§3・§9 MUST）。`user_id` フィルタを構造的に強制。
2. **お金の型を整数円に統一**する方針決定＋型定義（§2判断B）。
3. **主要インデックス追加** `(user_id, date)` 等（§10 MUST・安い）。
4. 課金ゲート（`entitlements`）を実際にAPIへ配線（§11）。
→ 成果: セキュリティと採算の土台が固まる。既存機能の挙動は変えない。

### Phase 1 — 口座と予算のデータモデル（V3の背骨）
5. `accounts` / `account_balances` 新設、`bank_account`(text)→`account_id`(FK)移行（§5.1）。
6. キャッシュフローを**口座別**＆**イベント抽象**へ拡張（§8）。
7. `budgets` 実装（既存 `docs/budget-design.md`）。収入→固定費→投資→貯蓄→自由予算の自動算出（要件③）。
→ 成果: 要件⑤⑥③が動く。AIが使う「集計ツール」の土台も揃う。

### Phase 2 — AIエージェント基盤
8. `lib/ai/`（provider抽象・context・tools・prompts）新設（§6）。
9. `ai_conversations`/`ai_messages`/`ai_insights`/`ai_user_memory` 新設（§5.4）。
10. 右下常駐アシスタント（`app/layout.tsx`）＋ `/api/ai/chat`・`/api/ai/insights`（§6.5・§7）。
11. 日次コーチのバッチ生成（§6.4・要件④）。
12. オンボーディング（要件②）＝ヒアリング → 目標作成（`life_goals`）→ 逆算予算。
→ 成果: 「AIライフプランナー」のコア体験。**サブスクの価値提供の本体。**

### Phase 3 — サブスク＆家族共有
13. `user_entitlements` をサブスク対応に拡張、Webhook強化（§5.5・§9）。
14. プラン別機能ゲート・トークン上限（§11）。
15. `households`/`household_members` と所有スコープの切替（§5.6）。
→ 成果: 収益化と家族共有。

### 横断（各フェーズで並行）
- コンポーネントからロジックを抜く（§4）— ネイティブ展開の布石。フェーズごとに触る画面で少しずつ。
- 純関数にはユニットテストを付ける（数値の正しさの担保）。

---

## 13. 未決事項（先に決めると手戻りが減る）

1. **所有モデル**: 全データを最初から「world = household」で設計するか、`user_id` 単独で始めて後で移行するか。家族共有をロードマップに入れるなら、**Phase 1のうちにRepository層で切替可能にしておく**のが安い。
2. **お金の型**: 整数円で統一してよいか（外貨投資値の扱いをどうするか）。§2判断B。
3. **AIプロバイダ方針**: Gemini単独か、用途別に複数プロバイダ（安いモデル＝抽出、賢いモデル＝相談）を前提にするか。「違うAPIキー」の意図（コスト分離？レート分離？）。
4. **価格**: 月100円単価か、Free/Standard/Premiumの段階制か（§11）。AIコストの採算前提を決めないとトークン上限が設計できない。
5. **AIの実行権限の線引き**: 「提案のみ・実行は人間」を原則とするか（推奨）。資金移動・取引をAIに実行させないことを明文化。
6. **オンボーディングの深さ**: 初回ヒアリングをどこまで必須にするか（離脱率とのトレードオフ）。
7. **日次コーチの配信**: プッシュ通知（PWA/ネイティブ）を前提にするか、アプリ内バッジのみか。習慣化設計に直結。

---

## 付記: Claude Code へ渡す際の一文（推奨どおり）

> 今回の実装は画面や機能単位ではなく、プロダクトロードマップ（家計簿 → 資産管理 → AIライフプランナー → 家族共有 → サブスクリプション）を前提に、拡張性・保守性・データ整合性を重視した設計を提案してください。既存実装（Next.js App Router + Supabase + 純関数ロジック `lib/cashflow.ts`）を活かし、Phase 0（セキュリティ・型・インデックスの基盤是正）から着手すること。AI機能は Phase 2 まで着手せず、まず口座・予算のデータモデル（Phase 1）を背骨として固めること。
