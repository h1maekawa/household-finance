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

### 実装

`lib/billing/plan.ts` の `isBillingEnforced()` が判定します。

```ts
if (env.NODE_ENV === 'production') return true   // 設定に関わらず必ず有効
return env.BILLING_REQUIRED !== 'false'          // 開発・テストのみ明示的に外せる
```

`NEXT_PUBLIC_BILLING_REQUIRED` は廃止済みです。`/api/billing/status` が返す
`billingRequired` はサーバー側で算出した値で、環境変数をクライアントへ出しません。

## 既存ユーザーの救済

fail-closed 化で既存利用者を突然 Free へ落とさないため、Migration 実行時点で
存在するユーザーには `legacy_pro` を付与します。

- 現在利用できる機能を維持する
- Subscription を要求しない
- 新規課金ユーザーとは区別し、将来的に管理側で移行できるようにする

新規ユーザーから `free` / `pro` を正式適用します。

付与は `024_legacy_pro_entitlements.sql` が行います。切替時刻を
`billing_legacy_cutoff` に1行だけ記録し、それ以前に作成されたユーザーだけを
対象にします。Migration を後から再実行しても、切替後にサインアップした
ユーザーへは付与されません。`user_entitlements.user_id` は主キーなので
`on conflict do nothing` で二重データにもなりません。

## Stripe

### Subscription 化

Checkout は現時点で買い切り（`mode: 'payment'`）のままです。DBとWebhookは
Subscription を扱える状態になっており、Phase 5 で `mode` と Price を差し替えます。

### 公式SDK

`stripe.webhooks.constructEvent()` で検証します（`lib/billing/stripe.ts`）。
独自のHMAC実装は残していません。公式検証は署名に加えて **timestamp tolerance**
も見るため、古い署名の再送はここで弾かれます。

検証には Stripe が送ってきた **raw body** を使います。`JSON.parse()` して
再度 stringify したものでは署名が一致しません。

`app/api/billing/webhook/route.ts` は署名検証・受理・振り分け・レスポンスだけを持ち、
イベントごとの処理は `lib/billing/handlers.ts` にあります。

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

Stripe の Event ID を保存し、同一 Event を二重処理しません（`023_stripe_events.sql`）。

```
event_id   主キー
event_type
status     processing / processed / failed
attempts
last_error
received_at
processed_at
```

`event_id` の一意性だけでは「受理はしたが業務処理に失敗したイベントが二度と
処理されない」状態が起きます。受理と完了を分けて記録し、業務処理が成功して
初めて `processed` にします。`failed` と、放置された `processing` は
Stripe の再送で拾い直します。

受理はアプリ側で「SELECT → 判定 → UPSERT」に分けません。同じイベントが
ほぼ同時に2つ届くと両方が「未登録」と判定して処理へ進むためです。
判定ごと `claim_stripe_event`（`025_claim_stripe_event.sql`）の1文の
`INSERT ... ON CONFLICT DO UPDATE ... WHERE` に閉じ込め、一意インデックス上で
直列化させます。処理権を取れるのは必ず1ワーカーだけです。
この関数は `service_role` だけが実行できます。

DB更新の失敗を成功として扱わないため、`lib/billing/` の全DB I/O は
`error` を確認します。特に `processed` への更新が失敗した場合は Webhook を
200で返しません（Stripe が再送しなくなるため）。再送でハンドラが
再実行されるので、各ハンドラは冪等（UPSERT と固定値の UPDATE のみ）です。

## データ構造

### Subscription（`022_subscriptions.sql`）

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
権限判定は「Subscription → 無ければ user_entitlements」の順で解決します
（`lib/billing/plan.ts` の `resolvePlan()`）。買い切りの `pro_lifetime` と
`legacy_pro` はどちらも Pro 相当として扱われ、既存データを壊しません。

## 環境変数

| 変数 | 用途 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API |
| `STRIPE_PRICE_ID` | Checkout に渡す Price |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名検証 |
| `BILLING_REQUIRED` | 課金チェックの有効化。**サーバー専用**。Production では未設定でも有効 |
| `NEXT_PUBLIC_APP_URL` | Checkout の戻り先 |

`NEXT_PUBLIC_BILLING_REQUIRED` は廃止済みです。

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
