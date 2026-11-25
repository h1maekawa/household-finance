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
    "negative_balance_risk": false,
    "negative_balance_risk_known": true,
    "negative_balance_risk_caveat": null
  },

  "confidence": "high"
}
```

`negative_balance_risk` は後方互換のため boolean のままです。口座残高が未登録で資金繰りを予測できないときは `false` になりますが「リスクなし」ではないため、`negative_balance_risk_known` が `false` のときは、利用側でリスクを不明として扱ってください。

`negative_balance_risk_known` が `true` になるのは、**開始残高が既知 かつ 最も古い口座の残高記録が7日（168時間）以内**のときだけです（鮮度は `investment-capacity` の `balance_freshness` と同じ `judgeBalanceFreshness` で判定）。記録が7日を超えているとき、記録日時が不明なとき、残高が未登録のときは `false` です。`false` のとき AI Company は「判定不可」と表示し、`negative_balance_risk: false` を「不足なし」と読まないでください。Flow+ の画面も同じ条件で「口座残高が7日以上更新されていないため、資金繰りの不足を判定できません」と表示し、不足見込みを判定しません。

資金繰りの予測（`negative_balance_risk` の元になる30日予測）は、今日を起点に、各口座の最新残高を合計した額から始めます。口座ごとの記録日から今日までの引き落としは、予測には反映していません（Phase 3 で対応予定）。

`negative_balance_risk_caveat`（追加項目）は、予測に赤字日が無くても「不足なし」と断定できないときの注意書きです。最も古い口座の残高記録日（JST）が今日より前なら「不足見込みは検出されていません（残高記録日 M/D 以降の引落は予測に未反映のため、不足なしとは断定できません）」を返し、記録日が今日のとき、または残高が未登録のときは `null` です。`negative_balance_risk: false` を「不足なし」と読む前にこの項目を確認してください。

`investment-capacity` の `emergency_fund` は、`allocation.emergency_fund`（支払い後の原資から確保できた額）を `currentReserve` とする値です。口座残高の総額ではありません。フィールドは変わらず、値の基準だけ資産計画の表示と揃えています。原資が分からないときは `currentReserve`・`reserveGap`・`fundedRatio` は `null`、`status` は `unknown` です。

### 給与の二重加算の扱い（投資可能額・30日予測）

給与はプロフィール（`users_profile.monthly_income` / `income_day`、予算の `income_planned`）から合成します。同じ給与が予定入金（`scheduled_payments` の `type:'income'`）にも登録されているときは、投資可能額（`expected_income`）と30日予測（`negative_balance_risk`）の両方で、同じ1つの判定（`lib/services/salary-duplicate.ts` の `detectSalaryDuplicate`）により二重に足さないようにします。判定は月ごとに、その月に入金日が解決される有効な予定入金とプロフィール給与（予定額 > 0）の両方があるときだけ行います。

- **一致**：予定入金の名前またはカテゴリに「給与」「給料」「役員報酬」「salary」を含む、または（入金日が給料日の±3日以内 **かつ** 金額が予定額の±10%以内）→ 予定入金の行だけを使い、合成した給与は足しません。投資可能額の内訳には「給与（予定入金を使用・プロフィール月収と重複のため合成分は除外）」と表示します。
- **あいまい**：一致しないが、入金日が給料日の±3日以内の予定入金がある → 予定入金の行だけを使い（少ない側）、`missing_data`（30日予測は画面の `missing`）に「給与が予定入金とプロフィールの月収の両方に登録されている可能性があります。どちらか一方にしてください」を追加します。AI Company はこの項目がある間、新規購入の提案を停止してください。
- **それ以外**（給料日から離れ、名前も給与でない入金）→ 別の収入として、給与と予定入金の両方を数えます（従来どおり）。

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
