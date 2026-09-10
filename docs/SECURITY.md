# Security

金融データを扱うため、「壊れたときに閉じる」側へ倒す設計を原則とします。
本書は現状と目標を分けて書きます。未対応のものを対応済みとして書きません。

## 認証

ユーザー認証は Supabase Auth です。`lib/auth.ts` の `getAuthenticatedUser()` が
2経路を受け付けます。

1. `Authorization: Bearer <token>` — 外部クライアント・テスト用
2. Cookie ベースのセッション — ブラウザからの通常の `fetch()`。実運用の主経路

サーバー間連携（GAS取込・AI Company）はセッションを持たないため、
`lib/server-auth.ts` の `resolveIntegrationUserId()` が `x-import-secret` ヘッダーを
`user_import_secrets` と突き合わせて対象ユーザーを決めます。
シークレットは SHA-256 ハッシュで保存し、平文は保持しません。

ルートの `proxy.ts`（Next.js 16 の Proxy。旧 `middleware.ts`）が、ログイン必須ページへの
未ログインアクセスを `/flow/setup` へ寄せます。ただしこれは楽観的な最初の防御線で、
matcher は `/api` を除外しています。**実際のデータ保護は各 API の `getAuthenticatedUser()` と
RLS が担います。** Proxy を唯一の防御手段にしないでください。

新規APIには必ず認証を付けてください。認証の無いエンドポイントを作らないこと。

## Row Level Security

全ユーザー所有テーブルで、`SELECT` / `INSERT` / `UPDATE` / `DELETE` それぞれに
`auth.uid() = user_id` を基本としたポリシーを置きます。

- `001_multi_user_rls.sql` が主要テーブルへ動的に4種のポリシーを付与
- `016` / `018` / `019` が後から追加したテーブル（`custom_categories` / `accounts` /
  `account_balances` / `budgets` / `budget_categories` / `life_goals` / `ai_insights` /
  `ai_user_memory`）へ明示的にポリシーを付与

**RLS を有効にしてポリシーが無いテーブルは、service_role 以外から0件に見えます。**
静かに壊れるので、テーブルを追加したら必ず4操作すべてのポリシーを書いてください。

### 書き込みを関数経由に限るテーブル

行をまたいだ不変条件があるテーブルは、4種のポリシーでは守れません。
authenticated から `INSERT` / `UPDATE` / `DELETE` を剥奪し、`SECURITY DEFINER`
関数（`set search_path = public`）だけが書き込みます。

| テーブル | 不変条件 | 書き込み関数 |
|---|---|---|
| `transaction_items` (029) | items が1件以上なら合計 = `transactions.amount` | `replace_transaction_items` |
| `goal_milestones` (031) | 目標が本人のもの / 金額の重複なし / `position` は金額の昇順 | `replace_goal_milestones` |

いずれも対象ユーザーを `auth.uid()` で決め、`user_id` をクライアントから
受け取りません。1件ずつの行トリガーでは合計や並び順を検査できないため、
「全消し → 一括INSERT → 検査」を1トランザクションにまとめます。

`expense_preferences` (030) と `fire_settings` (032) は行ごとの `check` 制約で
足りるので、通常の4ポリシーです。

## service_role の使用範囲

`supabaseAdmin`（`SUPABASE_SERVICE_ROLE_KEY`）は RLS を完全にバイパスします。
使用してよいのは次の処理だけです。

- Stripe Webhook
- 信頼された Server-to-Server Integration（`/api/integrations/*`）
- 管理処理
- Cron / Background Job

通常のユーザー操作API（`transactions` / `accounts` / `goals` / `budgets` /
`scheduled_payments` / `stocks` / `funds` 等）は
「セッション → Supabase User Client → RLS」を基本とします。

### 現状

`supabaseAdmin` を使う API ルートは **3本**です（25本から削減）。

| route | 理由 |
|---|---|
| `billing/webhook` | Stripe 署名で認証。セッションが存在しない |
| `integrations/investment-capacity` | Integration Token で user_id を解決。セッションが存在しない |
| `transactions/import` | 同上（GAS取込） |

これは `lib/security/api-ownership.test.ts` が許可リストとして固定しており、
ユーザー起点のAPIに `supabaseAdmin` が戻ると失敗します。

`lib/` 側で service_role が残るのは次の3つです。

| 場所 | 理由 |
|---|---|
| `lib/server-auth.ts` | Integration Token の照合。認証前なのでセッションが無い |
| `lib/repositories/fx-rates.ts` | `fx_rates` は全ユーザー共有で書き込みポリシーを持たない |
| `lib/billing/*` | Webhook と、セッションの無い経路からの権限判定で共用。Phase 5 の `requireFeature()` 再設計とあわせて整理する |

新しくテーブルを追加したときは、4操作すべてのポリシーを書いてから
Session Client で使ってください。RLS違反は例外ではなく **0件** として
表面化するため、GET / INSERT / UPDATE / DELETE を個別に確認します。

## Mass Assignment

`lib/patch.ts` の `pickAllowed()` を正式な共通方式とします。
リクエストボディをそのまま `.update()` / `.insert()` に渡さないでください。

クライアントから書き換えさせないカラム:

```
user_id / id / created_at / updated_at
entitlement / stripe_customer_id / scope
```

現在 `pickAllowed()` を使っているのは `transactions` / `transactions/[id]` /
`debts/[id]` / `funds/[id]` / `stocks/[id]` の5ルートです。
未対応の更新系APIへ展開していきます。

## Integration Token

サーバー間連携（GAS取込・AI Company）は `x-import-secret` ヘッダーで認証します。
Token は用途（integration）と権限（scopes）を持ち、**認証できただけでは
何も呼べません**。必ず scope の確認を通します。

### テーブル

`user_import_secrets` が Integration Token registry です。名前はGAS時代の
名残で、実体は汎用の Token テーブルです（rename は影響範囲が広いため別Phase）。

```
id / user_id / secret_hash / label
integration      gas | ai_company | other
scopes           text[]
is_active / revoked_at / created_at / last_used_at
```

`integration` に DB の CHECK は置いていません。連携先が増えるたびに
Migration が必要になるためで、妥当性は `lib/integrations/scopes.ts` の
allowlist が担保します。

### Scope

| scope | 用途 |
|---|---|
| `transactions:write` | 取引の登録（GAS取込） |
| `finance-summary:read` | 家計サマリの参照 |
| `investment-capacity:read` | 投資可能額の参照 |
| `assets:read` | 資産の参照 |

| 発行先 | 付与される scope |
|---|---|
| GAS | `transactions:write` のみ |
| AI Company | `finance-summary:read` / `investment-capacity:read` / `assets:read` のみ |

**AI Company のTokenに `transactions:write` を付けません。**
GAS のTokenに読み取り系を付けません（Least Privilege）。

scope はクライアントから受け取らず、`integration` からサーバー側で決めます。

**これは API だけでなく DB でも守ります。** 以前は authenticated ロールが
`user_import_secrets` を直接 UPDATE できたため、Supabase の REST を叩いて
自分の Token の `scopes` を書き換えられました。027 で次のようにしています。

- authenticated から INSERT / UPDATE / DELETE の権限とポリシーを剥奪（SELECT のみ残す）
- 発行・失効は `SECURITY DEFINER` の関数（`issue_integration_token` /
  `revoke_integration_token`）経由のみ
- 関数は `auth.uid()` で対象ユーザーを決める。`user_id` をクライアントから受け取らない
- 発行関数は `scopes` を引数に取らず、`integration` から決める

さらに認証側でも二重に絞ります。`resolveIntegrationAuth()` が返す scope は

```
保存値 ∩ 既知scope ∩ ALLOWED_SCOPES[integration]
```

です。DBが何らかの理由で書き換わっていても、`integration='gas'` の Token が
`assets:read` を持つことはありません。未知の `integration` は権限ゼロとして
fail-closed に扱います。

### 認証と認可

```
Authentication → Token解決 → Scope確認 → Resource処理
```

`resolveIntegrationAuth()` が `IntegrationAuthContext`（userId / tokenId /
integration / scopes / legacy）を返し、`requireIntegrationScope()` が
scope を確認します。各ルートへ比較ロジックを書き写さないでください。

| コード | 意味 |
|---|---|
| 401 | Token が無い・不正・失効・無効 |
| 403 | Token は正しいが必要な scope が無い |

`resolveIntegrationUserId()` は後方互換のラッパーとして残していますが、
scope を見ないので単体で認可に使ってはいけません。新規コードは
`requireIntegrationScope()` を使います。

### Rotation と Revocation

1ユーザー1Tokenではありません。新しいTokenを発行してから古い方を失効させる
入れ替えができます。

```
Token A 有効 → B を発行（A と併存）→ 切替確認 → A を revoke
```

revoke は物理削除しません。`is_active = false` と `revoked_at = now()` を立て、
行は監査のために残します。認証が通るのは `is_active` かつ
`revoked_at is null` のTokenだけです。

**失効は不可逆です。** トリガー `user_import_secrets_no_revival` が
`revoked_at` を null に戻す更新と `is_active` の再有効化を拒否します。
権限を剥がしただけでは service_role 経由やSQL Editorでの手作業で復活できて
しまうため、DB 側で保証しています。失効した Token は戻さず、新しい Token を
発行してください。

### last_used_at

**認証に成功した時点で更新します。** この後 scope 不足で 403 になっても
更新済みのままにします。「そのTokenが使われた」事実自体を追跡したいためで、
権限が足りなかったことは `last_used_at` ではなくログで分かります。

### Secret の扱い

平文はDBに保存しません。SHA-256 のハッシュだけを保存し、平文は発行直後の
レスポンスで一度だけ返します（再表示不可）。

接頭辞（`flow_gas_` / `flow_aic_`）はログや利用者が種別を見分けるためのもので、
**認証の根拠にはしません**。照合は `secret_hash` の完全一致です。既存の
`gas_...` Token もそのまま認証できます。

`secret_hash` はAPIのレスポンスに含めません。RLS で自分の行が読めることと、
APIから出してよいことは別です。

ログに `x-import-secret` / secret / secret_hash を出さないでください。

### Legacy 環境変数 Secret

`GAS_IMPORT_SECRET` / `GAS_IMPORT_USER_ID` はまだ受け付けます（Stage A）。
これで認証した場合は `legacy: true`、`tokenId: null`、scope は
`transactions:write` のみとして扱います。**以前のように、通れば全ての
Integration API を呼べる状態にはしません。**

使用時は `[deprecated] Legacy GAS integration secret used` をサーバーログへ出します。
Token 本文・ハッシュ・userId は出しません。

```
Stage A  DB Token + Legacy Env Secret を併存        実装済み
Stage B  Legacy 使用時に Warning Log                実装済み
Stage C  Legacy Secret の完全停止                   保留
```

**Legacy Secret removal: Pending consumer migration.**

Stage C は、GAS 側が新しい Token へ移行済みであることを確認できるまで
実施しません（移行前に止めると取込が壊れます）。判断は Phase 7 の
Production Release Checklist で行います。移行が済んだかは
`user_import_secrets` の `integration='gas'` な Token の `last_used_at` と、
Legacy 使用時の deprecated ログの有無で確認できます。

## Rate Limit

**未実装です。** `proxy.ts` はありますが matcher が `/api` を除外しているため、
API はそもそも通っていません。導入時は Proxy だけに責務を集中させず、Rate Limit
ユーティリティを用意して必要なルートから使える設計にします。

最低対象: `/api/coach/*` / `/api/integrations/*` / `/api/billing/*` / 認証関連 /
AI解析 / Import。

## セキュリティヘッダー

**未設定です。** 最低限、次を設定・確認します。

```
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
frame-ancestors
```

アプリを壊す過剰な CSP を一度に入れず、Report Only から始めて Enforcement へ移す方法も取れます。

## エラー情報

Supabase・Stripe・内部例外の `error.message` をそのまま一般ユーザーへ返しません。

```
サーバーログ  詳細エラー
ユーザー      処理に失敗しました
```

## ログに出さない値

```
銀行残高 / クレジットカード明細 / メール本文
Integration Secret / Supabase Token / Stripe Secret
個人情報
```

## 外部AIへ渡すデータ

金融計算は Flow+ 内部で完結させ、外部AIへは原則として**計算済みのサマリのみ**を送ります。
生の取引履歴やカード明細を外部へ渡しません。

現在 Gemini を使っているのは `app/api/parse-chat/` と `app/api/transactions/import/` の2箇所で、
いずれも入力の解釈が目的です。AI Coach（`/api/coach/insights`）は
`coach-rules.ts` のルールベースで、AIを通していません。

## ユーザーデータ

- **Export**（未実装）: `transactions` / `accounts` / `budgets` / `goals` /
  `scheduled_payments` / `investments` を JSON・CSV で取り出せるようにします
- **アカウント削除**（未実装）: Subscription の状態を確認し、必要なら解約してから
  ユーザーデータを削除し、最後に Auth を削除します

## 既知の未対応

| 項目 | 内容 |
|---|---|
| Rate Limit / ヘッダー | 未実装。`proxy.ts` は `/api` を対象外 |
