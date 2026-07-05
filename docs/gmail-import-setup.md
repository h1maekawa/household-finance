# Gmail取り込み(GAS連携)セットアップ手順

カード利用通知メールを検知して家計簿に自動登録する仕組みです。Google Apps Script (GAS) があなたのGoogleアカウント内でGmailを検索し、メールの件名・本文だけをアプリのAPIに送信します。アプリ側はGmailのアクセス権限やOAuthトークンを一切保持しません。

## なぜこの構成か(セキュリティ・費用の要点)

- Gmailへの長期アクセス権限(リフレッシュトークン)をアプリのDBに保存しない。万一SupabaseのDBやservice roleキーが漏れても、Gmail自体への影響はない。
- GASは個人アカウントの無料枠で十分動く(1日あたりの実行回数・通信回数に家計簿用途で困らない余裕がある)。Vercel側で高頻度のcronを組むとProプランが必要になりがちだが、その費用が発生しない。
- `gmail.readonly` のような制限付きスコープをアプリのOAuthクライアントとして本格運用する場合に必要になるGoogleの審査(CASA等)が不要。

## 実装済みのもの

- `app/api/transactions/import/route.ts` … GASからの取り込み専用エンドポイント。共有シークレット(`x-import-secret` ヘッダー)で認証し、既存のGemini解析(`lib/gemini.ts`)でメール本文からdate/amount/category/payment_methodを抽出、`transactions` テーブルに `source: 'gmail'` で登録する。confidenceが`low`の場合は登録せずスキップする。
- `gas/gmail-import.gs` … GAS側のスクリプト本体。時間主導トリガーでGmailを検索し、未処理メールをAPIに送信、成功したらラベルを付けて重複防止する。

## セットアップ手順

### 1. 共有シークレットを決める

以下のランダム文字列を使ってください(今回のセットアップ用に生成済みです)。

```
9b81a698906390738a2b9e59cf9192ec352036d516487d42fb154cb1a7a6627f
```

### 2. あなたのSupabase user_id を調べる

Supabaseダッシュボード → Authentication → Users を開き、ログインに使っているGoogleアカウントの行にある `UID` をコピーします(`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` の形式)。

### 3. Vercelに環境変数を追加

プロジェクト設定 → Environment Variables に追加し、再デプロイしてください。

```
GAS_IMPORT_SECRET=9b81a698906390738a2b9e59cf9192ec352036d516487d42fb154cb1a7a6627f
GAS_IMPORT_USER_ID=(手順2でコピーしたUID)
```

### 4. Google Apps Scriptを作成

1. https://script.google.com を開き、「新しいプロジェクト」を作成
2. デフォルトの `Code.gs` の中身を全部削除し、リポジトリの `gas/gmail-import.gs` の内容をそのまま貼り付け
3. 左メニューの歯車アイコン →「スクリプト プロパティ」を開き、以下を追加:

   | プロパティ | 値 |
   |---|---|
   | `API_URL` | `https://household-finance-smoky.vercel.app/api/transactions/import` |
   | `API_SECRET` | 手順1の共有シークレット(Vercelと同じ値) |
   | `SEARCH_QUERY` | 下記「検索クエリの例」を参照して、ご自身のカードの通知メールに合わせたものを設定 |
   | `LABEL_NAME` | `家計簿取込済み`(省略可) |

4. スクリプトエディタの関数選択で `sendTestTransaction` を選び、実行(初回は権限の承認を求められるので許可する)。実行ログに「テスト送信に成功しました」と出て、アプリの「履歴」タブにテスト取引が増えていれば成功。
5. 関数選択で `installTrigger` を実行。これで `checkCardEmails` が15分おきに自動実行されるようになる。

### 検索クエリの例

`SEARCH_QUERY` はGmailの検索構文がそのまま使えます。まずGmailの検索窓でご自身のカード通知メールがどんな条件で絞り込めるか(送信元アドレスなど)を確認してから設定してください。

```
(from:mail@rakuten-card.co.jp OR from:statement@vpass.ne.jp) newer_than:2d
```

送信元アドレスが分からない場合は、実際の通知メールを開いて送信者名をクリックすると確認できます。

### 5. 動作確認

トリガー作成後、実際にカードを使って通知メールが届いたら、15分以内に「履歴」タブに `source: gmail` の取引として自動登録されるか確認してください。うまく登録されない場合は、GASの「実行数」ログ(script.google.com の左メニュー)でエラー内容を確認できます。

## 運用上の注意

- `GAS_IMPORT_SECRET` はこのエンドポイント専用の秘密情報です。他の用途で使い回さず、コードに直書きせず必ずスクリプトプロパティ/環境変数に保存してください。
- Geminiのconfidenceが `low` と判定されたメールは自動登録されずスキップされます(誤った金額が紛れ込むより取りこぼす方を優先する設計)。定期的に「履歴」タブを見て、登録されていないはずのメールがないか確認することをおすすめします。
- 将来この家計簿アプリを他の人にも使ってもらう場合、GASは各自のGoogleアカウントで個別にセットアップしてもらう必要があります(このスクリプトはアカウントをまたいで共有できません)。
