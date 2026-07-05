/**
 * 家計簿アプリ Gmail 取り込みスクリプト (Google Apps Script)
 *
 * このスクリプトは「あなた自身のGoogleアカウント」の中だけで完結します。
 * アプリ(Vercel/Supabase)側にはGmailへのアクセス権限を一切渡さず、
 * このスクリプトが抽出した「メールの件名+本文テキスト」だけを
 * 認証付きAPIエンドポイントに送信します。
 *
 * セットアップ手順は docs/gmail-import-setup.md を参照してください。
 * ここでは概要だけ書いておきます。
 *
 * 1. https://script.google.com で新規プロジェクトを作成し、このファイルの
 *    内容をまるごと貼り付ける
 * 2. 左メニュー「プロジェクトの設定」→「スクリプト プロパティ」で以下を追加:
 *      API_URL      : https://<あなたのドメイン>/api/transactions/import
 *      API_SECRET   : Vercelに設定した GAS_IMPORT_SECRET と同じ値
 *      SEARCH_QUERY : 例) (from:mail@rakuten-card.co.jp OR from:statement@vpass.ne.jp) newer_than:2d
 *      LABEL_NAME   : 家計簿取込済み  (省略可。取り込み済みメールに付けるラベル名)
 * 3. スクリプトエディタで installTrigger を一度実行する
 *    (「時間主導型トリガーを15分おきに作成」を自動で行います)
 * 4. sendTestTransaction を実行して、API疎通とテスト取引の登録を確認する
 */

const DEFAULT_LABEL_NAME = '家計簿取込済み'
const MAX_THREADS_PER_RUN = 20
const MAX_BODY_LENGTH = 3000

/**
 * メインの処理。時間主導型トリガーからこの関数を呼び出す。
 */
function checkCardEmails() {
  const props = PropertiesService.getScriptProperties()
  const apiUrl = props.getProperty('API_URL')
  const apiSecret = props.getProperty('API_SECRET')
  const searchQuery = props.getProperty('SEARCH_QUERY')
  const labelName = props.getProperty('LABEL_NAME') || DEFAULT_LABEL_NAME

  if (!apiUrl || !apiSecret || !searchQuery) {
    Logger.log('スクリプトプロパティ(API_URL / API_SECRET / SEARCH_QUERY)が未設定です。プロジェクトの設定から追加してください。')
    return
  }

  const label = getOrCreateLabel_(labelName)
  // 取り込み済みラベルが付いていないメールだけを対象にする(重複登録防止)
  const fullQuery = `${searchQuery} -label:${labelName}`
  const threads = GmailApp.search(fullQuery, 0, MAX_THREADS_PER_RUN)

  Logger.log(`検索クエリ: ${fullQuery}`)
  Logger.log(`${threads.length}件のスレッドが対象です`)

  threads.forEach(thread => {
    const messages = thread.getMessages()
    let allSucceeded = true

    messages.forEach(message => {
      const text = buildMessageText_(message)
      const ok = sendToApi_(apiUrl, apiSecret, text)
      if (!ok) allSucceeded = false
    })

    // スレッド内の全メッセージが送信成功した場合だけラベルを付けて「処理済み」にする。
    // 一部失敗した場合は次回また対象になり、再送を試みる。
    if (allSucceeded) {
      thread.addLabel(label)
    }
  })
}

/**
 * 動作確認用。API接続とGemini解析〜登録までを1件だけテストする。
 * 実行後、アプリの「履歴」タブに「テスト用取引」が増えていれば成功。
 */
function sendTestTransaction() {
  const props = PropertiesService.getScriptProperties()
  const apiUrl = props.getProperty('API_URL')
  const apiSecret = props.getProperty('API_SECRET')

  if (!apiUrl || !apiSecret) {
    Logger.log('API_URL / API_SECRET が未設定です。')
    return
  }

  const sampleText = '件名: カードご利用のお知らせ\n\n本日、スーパー丸伊にて1,280円のお支払いがありました。'
  const ok = sendToApi_(apiUrl, apiSecret, sampleText)
  Logger.log(ok ? 'テスト送信に成功しました。履歴タブを確認してください。' : 'テスト送信に失敗しました。ログを確認してください。')
}

/**
 * checkCardEmails を15分おきに実行する時間主導型トリガーを作成する。
 * 既存の同名トリガーがあれば一度削除してから作り直すので、複数回実行しても重複しない。
 */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkCardEmails')
    .forEach(t => ScriptApp.deleteTrigger(t))

  ScriptApp.newTrigger('checkCardEmails')
    .timeBased()
    .everyMinutes(15)
    .create()

  Logger.log('15分おきのトリガーを作成しました。')
}

function buildMessageText_(message) {
  const subject = message.getSubject()
  const body = message.getPlainBody().slice(0, MAX_BODY_LENGTH)
  return `件名: ${subject}\n\n${body}`
}

function sendToApi_(apiUrl, apiSecret, text) {
  try {
    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-import-secret': apiSecret },
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true,
    })

    const code = response.getResponseCode()
    if (code >= 200 && code < 300) {
      Logger.log(`登録成功 (${code}): ${response.getContentText()}`)
      return true
    }

    Logger.log(`登録失敗 (status ${code}): ${response.getContentText()}`)
    return false
  } catch (e) {
    Logger.log(`通信エラー: ${e}`)
    return false
  }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name)
}
