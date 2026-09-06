# Flow+

Personal Finance OS

Flow+ は、収入・支出・固定費・資産・目標を一元管理し、
「今月あといくら使えるか」
「いくら貯められるか」
「いくら資産形成へ回せるか」
「このペースで目標を達成できるか」
を見える化する個人向け金融OSです。

支出を記録するだけの家計簿ではありません。記録したお金の状態から、
貯金・資産形成・人生目標へどう配分すべきかまで判断できることを目的にしています。

> リポジトリ名は歴史的経緯で `household-finance` ですが、プロダクト名は **Flow+** です。

## 設計の芯

**金額計算をAIに任せない。** 金融計算はすべて決定論的な純関数で行い、同じ入力からは必ず同じ額が出ます。
AIは計算済みの値を受け取って、説明・要約・注意喚起・改善候補の提示だけを担当します。
AI自身に「あなたなら50,000円投資できます」のような金額を生成させません。

**お金の流れは1本の滝として扱う。**

```
収入 → 生活固定費 → 目標貯金 → 投資・資産形成 → 予備費 → 自由に使えるお金
```

この流れは `lib/services/money-plan.ts` が正であり、画面ごとに別の計算式を持ちません。

詳しくは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## セットアップ

```bash
npm install
cp .env.example .env.local   # 値を埋める
npm run dev
```

Supabase のマイグレーションは `supabase/migrations/` にあります。番号順に SQL Editor で実行してください。

### 必要な環境変数

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Auth・RLS経由のDBアクセス |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhook・サーバー間連携など限られた処理のみ（[docs/SECURITY.md](docs/SECURITY.md)） |
| `GEMINI_API_KEY` | チャット入力の解析・取込補助。金額計算には使いません |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` | 課金（[docs/BILLING.md](docs/BILLING.md)） |
| `NEXT_PUBLIC_APP_URL` | Checkout の戻り先 |

## スクリプト

```bash
npm run dev         # 開発サーバー
npm run typecheck   # tsc --noEmit
npm test            # lib/**/*.test.ts を node --test で実行
npm run build       # 本番ビルド
npm run lint        # eslint
```

## ディレクトリ

```
app/            画面とAPIルート（App Router）
  api/          RESTエンドポイント。I/Oと認可だけを持つ
lib/
  services/     決定論的な金融エンジン（純関数・テスト対象）
  repositories/ Supabaseアクセス
supabase/
  migrations/   スキーマとRLSポリシー
types/          ドメイン型
docs/           設計ドキュメント
```

計算は `lib/services/`、I/Oは `app/api/` と `lib/repositories/` に置きます。
API ルートに計算式を書かないでください。

## ドキュメント

| | |
|---|---|
| [PRODUCT_VISION.md](docs/PRODUCT_VISION.md) | 何を作っているか・何を作らないか |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 金融エンジンの構成と計算の正の所在 |
| [SECURITY.md](docs/SECURITY.md) | 認証・RLS・service_role・Integration Token |
| [BILLING.md](docs/BILLING.md) | プランと Stripe 連携 |
| [AI_COMPANY_INTEGRATION.md](docs/AI_COMPANY_INTEGRATION.md) | AI Company との read-only 連携 |
