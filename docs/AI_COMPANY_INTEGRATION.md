# AI Company Integration

## 役割分離

```
AI Company
     │
     │ read-only financial summary
     ▼
Flow+ (household-finance)
     │
     ├── Deterministic Financial Engine
     └── Supabase
```

**Flow+ が金融データの唯一の Source of Truth です。**
AI Company は上位のAIとして、Flow+ が計算した結果を利用します。

この分離は「同じ機能を2つ実装しない」ためのものです。分類・集計・金額計算は
すべて Flow+ 側にあり、AI Company 側で再実装しません。

## 渡すもの・渡さないもの

| | |
|---|---|
| 渡す | 集計済みのサマリ（家計・資産・目標・資産形成余力・要確認件数・信頼度） |
| 渡さない | 取引履歴の全件、カード明細の全件、その他の生データ |

AI Company は原則 **read-only** です。Flow+ の金融データを書き換えられません。

## 正式API

```
GET /api/integrations/finance-summary?month=YYYY-MM
```

認証は `x-import-secret` ヘッダー（`requireIntegrationScope()`）。
必要な scope は `finance-summary:read` です。

### レスポンス

```json
{
  "month": "2026-09",

  "income": { "planned": 300000, "actual": 300000 },

  "expenses": { "fixed": 120000, "variable": 70000, "total": 190000 },

  "cashflow": { "free_to_spend": 80000, "daily_allowance": 3333 },

  "capacity": { "saving": 40000, "asset_building": 30000, "free_cash": 20000 },

  "assets": { "cash": 500000, "investment": 700000, "total": 1200000 },

  "emergency_fund": {
    "required": 600000, "current": 500000, "gap": 100000, "status": "behind"
  },

  "goals": [],

  "review": {
    "unreviewed_transactions": 2,
    "unassigned_card_usage": 1,
    "negative_balance_risk": false
  },

  "confidence": "high"
}
```

金額はすべて円の整数です。`confidence` は入力の欠損度から決まり、
AIの判断ではありません（`investment-capacity` の `missing_data` と同じ考え方）。

## 他の Integration API

| エンドポイント | scope | 状態 |
|---|---|---|
| `/api/integrations/finance-summary` | `finance-summary:read` | 実装済み |
| `/api/integrations/card-activity` | `card-activity:read` | 実装済み（最小化済みカード利用のみ） |
| `/api/integrations/investment-capacity` | `investment-capacity:read` | 実装済み |
| `/api/integrations/tokens` | — | Token の発行・一覧（ユーザーセッション） |
| `/api/integrations/gas-secret` | — | GAS用 Token の発行・一覧（既存運用の互換） |

## Token

AI Company 用の Token は `POST /api/integrations/tokens` に
`{"integration": "ai_company"}` を渡して発行します。scope はサーバー側で
決まり、read 系のみが付きます。

```
finance-summary:read
investment-capacity:read
assets:read
card-activity:read
```

**`transactions:write` は付きません。** AI Company から取引の
INSERT / UPDATE / DELETE は実行できません。GAS 取込用の Token とは
別物で、1本を使い回しません。

Token は認証できただけでは何も呼べず、必ず scope の確認を通ります。

| 状況 | レスポンス |
|---|---|
| Token が無い・不正・失効 | 401 |
| Token は正しいが scope 不足 | 403（`required_scope` を含む） |

例えば GAS の Token で `investment-capacity` を呼ぶと 403 になります。

平文の Token は発行直後のレスポンスでしか手に入りません（再表示不可）。
入れ替えは新旧を併存させてから古い方を失効させます。詳細は [SECURITY.md](SECURITY.md)。

## monthly-summary について

開発途中に `/api/integrations/monthly-summary` を追加する変更
（household-finance PR #1）がありましたが、**正式仕様には残しません**。

このエンドポイントが持っていた情報（変動費のカテゴリ内訳、要確認件数、
`daily_allowance` / `pace` などの生活ペース）は捨てず、`finance-summary` へ統合します。

AI Company 側も `monthly-summary` への依存を作らず、`finance-summary` を利用します
（ai-company PR #29 は統合後の仕様へ追従させます）。

## Card activity

`GET /api/integrations/card-activity?month=YYYY-MM&limit=30&cursor=...` は
`card-activity:read` を要求します。返すのは `id`, `date`, `merchant`, `amount`,
`card`, `category`, `review_status` だけです。メール本文、外部ID、取込メタデータは
返しません。レスポンスは `no-store` で、ページングの上限は100件です。

既存のAI Company Tokenには新scopeは自動付与されません。新しいTokenを発行し、
呼び出し側を切り替えてから旧Tokenを失効させてください。GAS Tokenにはこのscopeを
付与しません。

## New card transaction event

GAS/Gmailから新しいカード支出が登録された後、Flow+は任意でAI Companyの
`POST /api/integrations/flow/events` へ最小イベントを送れます。

```text
AI_COMPANY_FLOW_EVENT_URL=https://<ai-company>/api/integrations/flow/events
FLOW_EVENT_SECRET=<shared server-side secret>
```

`FLOW_EVENT_SECRET` は両サービスのserver-side環境変数にのみ設定します。送信時は
13桁Unixミリ秒の `x-flow-timestamp` と、
`sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)` の
`x-flow-signature` を付けます。本文はevent、transaction ID、日付、加盟店、金額、
カード名だけで、メール本文は送りません。

送信は3秒で打ち切ります。AI Company停止、timeout、4xx/5xxでもFlow+への取引登録を
巻き戻さず、transaction IDと失敗種別だけをserver logへ記録します。重複import時は
新規イベントを送信しません。現在のGAS importは1リクエスト1取引なので、V1では
transaction単位です。通知の集約・重複排除はAI Company側のidempotencyで行います。

## AI Company 側の設計

AI Company は取引を取り込んで再分類しません。分類の正は Flow+ 側です。

- Flow+ の集計を取得して表示・通知する
- 要確認の修正は Flow+ の本来UIへ誘導する（件数とリンクのみ）
- 取得した集計は Vault にキャッシュしてよい（Flow+ が落ちていても通知が届くように）

## 変更時の注意

このAPIは外部リポジトリが依存します。レスポンスのフィールドを
削除・改名する場合は、AI Company 側の追従とセットで進めてください。
追加は後方互換なので自由に行えます。
