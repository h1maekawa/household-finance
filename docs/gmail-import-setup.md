# Gmail取り込み(GAS連携)セットアップ手順

カード利用通知メール・給与振込メールを検知して家計簿に自動登録する仕組みです。Google Apps Script (GAS) があなたのGoogleアカウント内でGmailを検索し、カード会社ごとの正規表現パーサーで抽出した構造化データ(日付・金額・カテゴリなど)だけをアプリのAPIに送信します。アプリ側はGmailのアクセス権限やOAuthトークンを一切保持しません。

## なぜこの構成か(セキュリティ・費用の要点)

- Gmailへの長期アクセス権限(リフレッシュトークン)をアプリのDBに保存しない。万一SupabaseのDBやservice roleキーが漏れても、Gmail自体への影響はない。
- GASは個人アカウントの無料枠で十分動く(1日あたりの実行回数・通信回数に家計簿用途で困らない余裕がある)。Vercel側で高頻度のcronを組むとProプランが必要になりがちだが、その費用が発生しない。
- `gmail.readonly` のような制限付きスコープをアプリのOAuthクライアントとして本格運用する場合に必要になるGoogleの審査(CASA等)が不要。

## 解析方式: 正規表現を優先し、Geminiにフォールバック

1. GAS側でカード会社ごとの正規表現パーサー(三井住友カード・楽天カード・PayPay)を試す。マッチすれば日付・金額・利用先を確実に抽出でき、Gemini APIは呼ばれない(無料・決定的)。
2. どのパーサーにもマッチしなかったメールだけ、件名+本文のテキストをそのままAPIに送り、サーバー側(`lib/gemini.ts`)のGemini解析にフォールバックする。confidenceが`low`と判定された場合は登録せずスキップする(誤ったデータが紛れ込むより取りこぼしを優先)。

## 収入(給与など)にも対応

`transactions` テーブルに `kind`(`income` / `expense`)列を追加しました。カテゴリ自動判定で「給与・給料・賞与・ボーナス」に該当するメールは `kind: income` として登録されます。それ以外はすべて `kind: expense` です。

## 重複防止

メールのMessage IDを `external_id` として送信し、DB側でユーザーごとに一意制約をかけています。同じメールを再送しても2重登録されず、`{ duplicate: true }` が返るだけです。GAS側はこれも「処理済み」として扱い、スレッドにラベルを付けます。

## 実装済みのもの

- `supabase/migrations/002_transactions_kind_and_external_id.sql` … `kind` 列・`external_id` 列・重複防止用インデックスを追加するマイグレーション(Supabase SQL Editorで実行が必要)。
- `supabase/migrations/004_transaction_review_queue.sql` … 自動分類できなかった取引を「確認待ち」として表示するための列を追加するマイグレーション(Supabase SQL Editorで実行が必要)。
- `app/api/transactions/import/route.ts` … GASからの取り込み専用エンドポイント。共有シークレット(`x-import-secret` ヘッダー)で認証。`date/amount/category` が揃っていればそのまま登録(モードA)、`text` だけならGeminiで解析(モードB)。`external_id` の重複は200 `{duplicate:true}` で返す。
- `gas/gmail-import.gs` … GAS側のスクリプト本体。三井住友カード・楽天カード・PayPayの正規表現パーサー、カテゴリ自動判定、時間主導トリガー、重複防止ラベル付けを実装。

## セットアップ手順

### 1. マイグレーションを実行

Supabaseダッシュボード → SQL Editor で以下の内容を実行してください。

- `supabase/migrations/002_transactions_kind_and_external_id.sql`
- `supabase/migrations/004_transaction_review_queue.sql`

### 2. 共有シークレットを決める

以下のランダム文字列を使ってください(前回のセットアップ用に生成済みです。まだVercelに設定していなければこれを使ってください)。

```
9b81a698906390738a2b9e59cf9192ec352036d516487d42fb154cb1a7a6627f
```

### 3. あなたのSupabase user_id を調べる

Supabaseダッシュボード → Authentication → Users を開き、ログインに使っているGoogleアカウントの行にある `UID` をコピーします(`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` の形式)。

### 4. Vercelに環境変数を追加

プロジェクト設定 → Environment Variables に追加し、再デプロイしてください(前回すでに設定済みの場合はスキップ)。

```
GAS_IMPORT_SECRET=9b81a698906390738a2b9e59cf9192ec352036d516487d42fb154cb1a7a6627f
GAS_IMPORT_USER_ID=(手順3でコピーしたUID)
```

### 5. Gmail検索クエリを決める

パーサーの振り分け(三井住友/楽天/PayPayのどれで解析するか)は送信元アドレスと件名の両方で判定するので、`SEARCH_QUERY` はラベルではなく送信元アドレスで直接絞り込むのが一番確実です。実際に確認できた送信元アドレスを使うと以下のようになります。

```
from:(info@mail.rakuten-card.co.jp OR statement@vpass.ne.jp OR SMBC_service@dn.smbc.co.jp) newer_than:3d
```

他のカードやPayPayも使っている場合は `OR` で送信元アドレスを追加してください。すでにGmailのフィルタでラベル分けをしている場合は、代わりに `(label:三井住友クレジット OR label:楽天カード) -in:trash -in:spam` のようにラベルベースの条件を使っても構いません。

### 6. Google Apps Scriptを作成

1. https://script.google.com を開き、「新しいプロジェクト」を作成
2. デフォルトの `Code.gs` の中身を全部削除し、リポジトリの `gas/gmail-import.gs` の内容をそのまま貼り付け
3. 左メニューの歯車アイコン →「スクリプト プロパティ」を開き、以下を追加:

   | プロパティ | 値 |
   |---|---|
   | `API_URL` | `https://household-finance-smoky.vercel.app/api/transactions/import` |
   | `API_SECRET` | 手順2の共有シークレット(Vercelと同じ値) |
   | `SEARCH_QUERY` | 手順5で決めた検索クエリ |
   | `LABEL_NAME` | `kakeibo-processed`(省略可。処理済みメールに付けるラベル名) |

4. スクリプトエディタの関数選択で `sendTestTransaction` を選び、実行(初回は権限の承認を求められるので許可する)。実行ログに「テスト送信に成功しました」と出て、アプリの「履歴」タブに1,280円の食費テスト取引が増えていれば成功。同じ日に何度実行しても重複登録されません。
5. 関数選択で `installTrigger` を実行。これで `processCardEmails` が15分おきに自動実行されるようになる。

### 7. 動作確認

トリガー作成後、実際にカードを使って通知メールが届いたら、15分以内に「履歴」タブに `source: gmail` の取引として自動登録されるか確認してください。うまく登録されない場合は、GASの「実行数」ログ(script.google.com の左メニュー)でエラー内容を確認できます。

### 8. 過去の利用履歴をまとめて取り込む

通常の `processCardEmails` は、日々の運用向けに `SEARCH_QUERY` の条件だけを処理します。直近3日だけにしている場合、過去分は対象外です。過去分を取り込むときは、GASの関数選択で `backfillCardEmails` を手動実行してください。

必要に応じて、GASのスクリプトプロパティに以下を追加します。

| プロパティ | 値の例 |
|---|---|
| `BACKFILL_SEARCH_QUERY` | `from:(info@mail.rakuten-card.co.jp OR statement@vpass.ne.jp OR SMBC_service@dn.smbc.co.jp) after:2026/01/01 -in:trash -in:spam` |
| `BACKFILL_LABEL_NAME` | `kakeibo-backfill-processed` |

`BACKFILL_SEARCH_QUERY` を未設定にした場合は、`SEARCH_QUERY` から `newer_than:3d` のような相対日付条件を外して検索します。対象が多い場合は1回で最大100スレッドまで処理します。まだ未処理のメールが残っている場合は、`backfillCardEmails` を複数回実行してください。

過去分もメールのMessage IDを `external_id` として保存するため、同じメールを再実行しても重複登録されません。過去取り込みが終わったら、日常運用は `installTrigger` で作成した15分おきの `processCardEmails` に任せて大丈夫です。

過去分が思ったより少ない場合は、先に `diagnoseBackfillEmails` を実行してください。登録やラベル付けはせず、過去取り込み用の検索条件で何スレッド・何メール見えているかだけログに出します。ログの検索クエリに `newer_than:3d` が残っている場合は、通常取り込み用の条件を見ているので、`BACKFILL_SEARCH_QUERY` を追加してください。

ダッシュボードには「カード明細取り込み」カードがあります。ここで `受け口` `保存先` `DB接続` がOKになっていない場合、GASから送信してもアプリ側で保存できません。特に以下を確認してください。

- `受け口` がNG: Vercelの `GAS_IMPORT_SECRET` が未設定、またはGASの `API_SECRET` と一致していません。
- `保存先` がNG: Vercelの `GAS_IMPORT_USER_ID` が未設定、または現在ログインしているSupabaseユーザーのUIDと違います。
- `DB接続` がNG: Vercelの `SUPABASE_SERVICE_ROLE_KEY` が未設定です。
- `AI解析` がNG: 正規表現で読めないメールだけGemini解析できません。三井住友・楽天・PayPayの定型メールだけなら必須ではありません。

GAS側でメールが拾えているか確認するには、関数選択で `diagnoseCardEmails` を実行してください。この関数はアプリへの登録を行わず、Gmail検索結果・送信元・件名・カード会社パーサーの成功/失敗だけをログに出します。

よくある止まり方:

- `検索結果: 0スレッド`: `SEARCH_QUERY` が実際のカード通知メールと合っていません。Gmailで同じ検索語を入力し、メールが出る条件に直してください。
- `解析NG`: メールは拾えていますが、カード会社のメール形式が現在の正規表現と違います。この場合はログの件名・送信元・本文フォーマットに合わせて `gas/gmail-import.gs` のパーサーを調整します。
- `登録失敗 (status 401)`: GASの `API_SECRET` とVercelの `GAS_IMPORT_SECRET` が違います。
- `登録失敗 (status 503)`: Vercelの `GAS_IMPORT_SECRET` または `GAS_IMPORT_USER_ID` が未設定です。設定後に再デプロイしてください。

## カテゴリ自動判定のカスタマイズ

`gas/gmail-import.gs` の `CATEGORY_MAP` に、利用先(加盟店名)に含まれるキーワードとカテゴリの対応表があります。ご自身のよく使うお店に合わせて追記してください。カテゴリ名はアプリの支出カテゴリ(`食費` `交通費` `日用品` `外食` `娯楽` `医療` `通信費` `水道光熱費` `その他`)または収入カテゴリ(`給与` `その他収入`)と一致させてください。一致しないカテゴリ名を指定した場合はサーバー側で自動的に「その他」「その他収入」に丸められます。

自動判定できず `その他` になった取引は、アプリ上で「確認が必要な取引」として表示されます。履歴画面の上部に金額・日付・連携元メモが出るので、タップしてカテゴリやメモを入力してください。保存すると確認待ちから外れます。

## 運用上の注意

- `GAS_IMPORT_SECRET` はこのエンドポイント専用の秘密情報です。他の用途で使い回さず、コードに直書きせず必ずスクリプトプロパティ/環境変数に保存してください。
- 正規表現パーサーはカード会社側のメールフォーマット変更に弱いです。ある日から急に取り込まれなくなった場合は、まずメールのフォーマットが変わっていないか確認してください(フォールバックのGemini解析が効くので完全に取りこぼすわけではありません)。
- 将来この家計簿アプリを他の人にも使ってもらう場合、GASは各自のGoogleアカウントで個別にセットアップしてもらう必要があります(このスクリプトはアカウントをまたいで共有できません)。
