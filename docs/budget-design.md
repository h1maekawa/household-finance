# 予算機能（固定費の枠 → 変動費に使える額）設計メモ

Date: 2026-07-22
Status: 要件検討中（実装未着手）

## 目的

固定費を「枠」として登録・管理し、`収入 − 固定費 − 先取り貯蓄 = 変動費に使える額` を毎月自動で算出する。
月の途中でも「今月あといくら使えるか」「1日あたりいくらか」が分かる状態にする。

## 決定済みの方針

| 論点 | 決定 |
|---|---|
| 予算の基準 | **収入ベースと残高ベースの併用**。枠の管理は収入ベース、口座が尽きないかの検算は残高ベース |
| カード払いの計上 | **利用日ベース**で枠を消化。加えて「来月の引き落とし予定額」を別枠で併記 |
| 変動費の粒度 | **まず全体で1枠**。カテゴリ別サブ枠は後から追加できる設計にしておく |
| 固定費の金額 | **予定と実績を突合**。支払済みは実額、未払いは予定額を使う |

## 2つの時間軸の整理（重要）

このアプリには元々2つの時間軸が混在している。予算機能ではこれを**役割で分離**して整合させる。

| 軸 | データ | 用途 |
|---|---|---|
| 利用日ベース（発生主義） | `transactions.date` | **変動費枠の消化**。7/5にカードで5,000円使ったら7月の枠から即引く |
| 引き落とし日ベース（現金主義） | `projectCashflow()` / `buildGeneratedCreditPayments()` | **口座残高の検算**。8/27に楽天から◯円出る、という予測 |

同じ支出を二重計上しないため、**枠の計算に引き落とし予定を混ぜない**。逆に残高予測に変動費枠を混ぜない。
UI上は「今月あと使える額（利用日ベース）」と「来月の引き落とし予定（残高ベース）」を別カードで並べる。

## 主計算

```
変動費枠   = 収入見込み − 固定費(予定と実績の突合後) − 先取り貯蓄目標 − 予備費
変動費実績 = 当月 transactions のうち kind='expense' かつ 固定費カテゴリでないものの合計（利用日ベース）
残り       = 変動費枠 − 変動費実績
1日あたり  = 残り / 当月の残日数（当日を含む）
ペース     = 変動費実績 / (変動費枠 × 経過日数 / 当月日数)   … 1.0超で使いすぎ傾向
```

固定費の突合後の額:

```
固定費 = Σ(支払済み固定費の実額) + Σ(未払い固定費の予定額)
```

## 固定費の予定 ↔ 実績 突合ロジック

`scheduled_payments`（`type = 'fixed'`）1件に対し、当月の `transactions` から1件を割り当てる（1対1、重複割当なし）。

マッチ条件（すべて満たす）:

1. 取引が当月内
2. 取引のカテゴリが固定費カテゴリ（`getMergedCategories().fixedNames`）
3. 名前の近似一致 — 予定の `name` を正規化した文字列が取引の `memo` / `payment_method` / `category` のいずれかに含まれる、またはその逆
4. 金額が予定額の ±20% 以内、または差額 ±3,000円以内（どちらか緩い方）

候補が複数ある場合は「金額差が最小 → 日付が `due_day` に近い」順で1件を選ぶ。

判定結果:

| status | 意味 | 枠計算に使う額 |
|---|---|---|
| `paid` | 実績あり・予定額とほぼ一致 | 実額 |
| `over` / `under` | 実績あり・予定と乖離（差額表示＋予定額の更新提案） | 実額 |
| `unpaid` | 当月の実績なし・支払日前 | 予定額 |
| `missing` | 当月の実績なし・支払日を過ぎている（要確認アラート） | 予定額 |

自動突合が外れるケースに備え、`transactions.scheduled_payment_id`（nullable）を追加して手動で紐付け直せるようにする。手動紐付けがある場合は自動判定より優先。

## 固定費をカードで払っている場合

例: 携帯代を三井住友カードで払う → 7/15に `transactions` へ計上される。

- 枠の計算: 7月の固定費として消化（利用日ベース）。変動費枠には影響しない
- 残高予測: 8/26のカード引き落としに含まれる（既存の `buildGeneratedCreditPayments` のまま）
- 二重計上にはならない。軸が違うため

## データモデル

### 新規テーブル `budgets`

```sql
create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text,                      -- 'YYYY-MM'。null = 既定テンプレート（毎月に適用）
  income_planned integer,          -- null なら users_profile.monthly_income を使う
  savings_target integer not null default 0,
  buffer integer not null default 0,          -- 予備費（臨時支出用に確保する額）
  variable_budget_override integer,           -- 手入力で枠を直接指定したい場合
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);
```

月の予算取得は「その月の行 → 無ければ `month is null` のテンプレート行 → 無ければ `users_profile` の既定値」の順にフォールバック。

### 既存テーブルへの追加

```sql
alter table transactions add column scheduled_payment_id uuid references scheduled_payments(id) on delete set null;
```

### 将来拡張（今回は作らない）

```sql
-- カテゴリ別サブ枠
create table budget_categories (budget_id uuid, category text, amount integer);
```

## API

### `GET /api/budget?month=YYYY-MM`

```jsonc
{
  "month": "2026-07",
  "income":  { "planned": 300000, "actual": 300000 },
  "fixed": {
    "planned": 120000, "paid": 89000, "unpaid": 31000, "effective": 121500,
    "items": [
      { "id": "...", "name": "家賃", "planned": 80000, "actual": 80000,
        "status": "paid", "matched_transaction_id": "..." }
    ]
  },
  "savings": { "target": 50000 },
  "buffer": 10000,
  "variable": {
    "budget": 118500, "spent": 78000, "remaining": 40500,
    "daysLeft": 10, "dailyAllowance": 4050, "pace": 1.08,
    "byCategory": { "食費": 41000, "外食": 19000 }
  },
  "cash": {
    "projectedMonthEnd": 210000, "minBalance": 45000,
    "upcomingCardDebit": 62000, "shortfall": 0
  },
  "alerts": [
    { "type": "pace_high", "severity": "warning", "message": "..." }
  ]
}
```

`cash` は既存の `projectCashflow()` をそのまま再利用する（新規ロジックを書かない）。

### `PUT /api/budget`

`{ month, income_planned, savings_target, buffer, variable_budget_override }` を upsert。
`month` 省略時はテンプレート行を更新。

## アラート

| type | 条件 |
|---|---|
| `pace_high` | ペース > 1.15 |
| `over_budget` | 残り < 0 |
| `fixed_missing` | `missing` 状態の固定費がある |
| `fixed_drift` | 予定と実績の乖離が3ヶ月連続、または2万円超 |
| `cash_shortfall` | 残高ベースの予測で最小残高 < 0（枠が黒字でも口座が尽きるケース） |

## UI

### ダッシュボード上部「今月あと使える額」カード

- 主数値: 残り金額（大）
- 副: `1日あたり ◯円 / 残 ◯日`
- 進捗バー: 消化率。経過日数の位置にペース線を重ねて、線より手前なら黒字ペース
- 内訳（折りたたみ）: `収入 − 固定費(済◯/未◯) − 貯蓄 − 予備費 = 枠`
- 隣に「来月の引き落とし予定 ◯円」を別カードで併記

### 設定に「予算」タブ

月収見込み・先取り貯蓄・予備費の入力。固定費一覧は既存の `ScheduledPaymentList` を流用し、突合ステータス（済/未/要確認）のバッジを追加。

## 実装ステップ

1. マイグレーション `018_budgets.sql`（`budgets` + `transactions.scheduled_payment_id`）
2. `lib/budget.ts` — 突合と枠計算を**純関数**で実装（副作用なし＝テストしやすい）
3. `GET/PUT /api/budget`
4. 設定画面の予算タブ
5. ダッシュボードのカード
6. 残高ベース検算の統合（`projectCashflow` 再利用）

各ステップ単体で動作確認できる単位に分ける。1〜3が終われば数値の正しさは検証可能。

## 未決事項

1. **予算期間** — 暦月（1日〜末日）で始める前提。給料日起点サイクル（25日〜24日）にしたい場合は初期段階で決めたい
2. **収入の扱い** — 固定値（`income_planned`）で始めるか、実績入金（`kind='income'`）を反映するか。ボーナス月の扱い
3. **繰越** — 余った/超過した分を翌月に持ち越すか（持ち越さない方が単純で、破綻しにくい）
4. **貯蓄の実績判定** — 目標値のみで管理するか、`investment_transactions` や特定カテゴリの実績と突合するか
5. **臨時支出の扱い** — 医療費・冠婚葬祭などを変動費枠に含めるか、`buffer`（予備費）から出すか
6. **突合の許容誤差** — ±20% / ±3,000円は仮。実データを見て調整する
