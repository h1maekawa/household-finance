# Billing

## プラン

| プラン | 内容 |
|---|---|
| `free` | 基本家計簿・収支管理・簡易Dashboard |
| `pro` | 資産管理・Goals・資産形成プラン・AI Coach・外部連携・将来シミュレーション |
| `legacy_pro` | fail-closed 化以前からの既存ユーザー。現在の機能を維持し Subscription 不要 |

Feature 判定では `pro` と `legacy_pro` を Pro 相当として扱います。

料金はコードにハードコードせず **Stripe Price ID** で管理します。

## Authorization Layer

課金判定を各APIに `if` で散らかさず、共通関数へ寄せます（`lib/authorization.ts`、未実装）。

```ts
await requireFeature(userId, 'asset_planning')
```

用意する関数: `requirePlan()` / `requireFeature()` / `hasFeature()`。
内部でプランを判定し、機能名とプランの対応表を1箇所で持ちます。

## fail-closed

課金チェックは必ず fail-closed にします。

- サーバー専用の `BILLING_REQUIRED` を使う。`NEXT_PUBLIC_` は使わない
- Production では `BILLING_REQUIRED` が**未設定でも課金チェックは有効**
- 「未設定 = 全機能開放」には絶対にしない

### 現状（未対応）

`lib/entitlements.ts` は次のようになっており、**fail-open** です。

```ts
if (process.env.NEXT_PUBLIC_BILLING_REQUIRED !== 'true') return true
```

未設定なら全ユーザーが全機能を通過します。加えて `NEXT_PUBLIC_` 接頭辞のため
値がクライアントへ露出します。最優先で修正する項目です。

## 既存ユーザーの救済

fail-closed 化で既存利用者を突然 Free へ落とさないため、Migration 実行時点で
存在するユーザーには `legacy_pro` を付与します。

- 現在利用できる機能を維持する
- Subscription を要求しない
- 新規課金ユーザーとは区別し、将来的に管理側で移行できるようにする

新規ユーザーから `free` / `pro` を正式適用します。

## Stripe

### Subscription 化

現在は買い切り（Checkout の `mode: 'payment'`、`user_entitlements.plan = 'pro_lifetime'`）です。
`mode: 'subscription'` へ移行します。

### 公式SDKへの移行

現在の Webhook は独自HMAC実装です。`stripe` パッケージを導入し、
`stripe.webhooks.constructEvent()` へ移行します。公式検証は署名に加えて
**timestamp tolerance** も見るため、現在のリプレイ耐性の欠如が構造的に解決します。

### 扱うイベント

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

### Idempotency

Stripe の Event ID を保存し、同一 Event を二重処理しません（`024_stripe_events.sql`）。

```
event_id UNIQUE
event_type
processed_at
created_at
```

## データ構造

### 移行後（`023_subscriptions.sql`）

```
stripe_customer_id
stripe_subscription_id
stripe_price_id
status
current_period_end
cancel_at_period_end
```

### 既存テーブルの扱い

`user_entitlements` は Migration で削除しません。
Subscription の状態から Entitlement を算出する仕組みへ段階的に移行し、
既存データを破壊しないようにします。

## 環境変数

| 変数 | 用途 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API |
| `STRIPE_PRICE_ID` | Checkout に渡す Price |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名検証 |
| `BILLING_REQUIRED` | 課金チェックの有効化。**サーバー専用**。Production では未設定でも有効 |
| `NEXT_PUBLIC_APP_URL` | Checkout の戻り先 |

`NEXT_PUBLIC_BILLING_REQUIRED` は廃止予定です。

## アカウント削除との関係

削除前に Subscription の状態を確認し、必要なら解約してからデータを削除します。

```
契約状態確認 → 必要なら Stripe 解約 → ユーザーデータ削除 → Auth削除
```

## テスト

課金は壊れても気づきにくいので、状態ごとにテストを置きます。

- Entitlement: `free` / `pro` / `legacy_pro` / `cancelled` / `past_due` / `expired`
- Stripe: 無効な署名 / 期限切れ・リプレイされた Webhook / 同一 `event_id` の重複 /
  subscription の更新・削除 / invoice の支払い失敗
