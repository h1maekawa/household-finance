/**
 * 家計簿アプリ Gmail 取り込みスクリプト (Google Apps Script)
 *
 * このスクリプトは「あなた自身のGoogleアカウント」の中だけで完結します。
 * アプリ(Vercel/Supabase)側にはGmailへのアクセス権限を一切渡さず、
 * カード会社ごとの正規表現パーサーで抽出した構造化データ(日付・金額・
 * カテゴリなど)だけを認証付きAPIエンドポイントに送信します。
 * 正規表現で解析できなかったメールだけ、件名+本文のテキストをそのまま送り、
 * サーバー側のGemini解析にフォールバックします(processCardEmails内の分岐)。
 *
 * セットアップ手順は docs/gmail-import-setup.md を参照してください。概要:
 *
 * 1. https://script.google.com で新規プロジェクトを作成し、このファイルの
 *    内容をまるごと貼り付ける
 * 2. 左メニュー「プロジェクトの設定」→「スクリプト プロパティ」で以下を追加:
 *      API_URL      : https://<あなたのドメイン>/api/transactions/import
 *      API_SECRET   : Vercelに設定した GAS_IMPORT_SECRET と同じ値
 *      SEARCH_QUERY : 例) (label:三井住友クレジット OR label:楽天カード) -in:trash -in:spam
 *      LABEL_NAME   : kakeibo-processed (省略可)
 * 3. スクリプトエディタで sendTestTransaction を一度実行して疎通確認
 * 4. installTrigger を一度実行して15分おきの自動実行を開始
 */

const DEFAULT_LABEL_NAME = 'kakeibo-processed'
const MAX_THREADS_PER_RUN = 30
const MAX_BODY_LENGTH = 3000

// =========================================================================
// カテゴリ自動マッピング辞書
// キーワードにマッチしたら { category, kind } を返す。
// 「給与・賞与」系だけ収入(income)、それ以外は支出(expense)として扱う。
// カテゴリ名はアプリ側の types/transaction.ts の CATEGORIES / INCOME_CATEGORIES
// と一致させること(一致しない場合はサーバー側で「その他」に丸められる)。
// =========================================================================
const CATEGORY_MAP = [
  { keywords: ['uber', '出前館', 'menu'], category: '外食', kind: 'expense' },
  { keywords: ['ファミマ', 'ファミリーマート', 'セブン', 'ローソン', 'ミニストップ'], category: '日用品', kind: 'expense' },
  { keywords: ['jr', 'メトロ', '都営', 'suica', 'pasmo', 'タクシー'], category: '交通費', kind: 'expense' },
  { keywords: ['マクドナルド', 'マック', 'スタバ', 'スターバックス', 'ガスト', 'サイゼリヤ', '壱角家'], category: '外食', kind: 'expense' },
  { keywords: ['ディズニー', 'シネマ', '映画', 'netflix', 'spotify', 'カラオケ', 'ﾏﾈｷﾈｺ'], category: '娯楽', kind: 'expense' },
  { keywords: ['病院', 'クリニック', '調剤', '薬局', '歯科'], category: '医療', kind: 'expense' },
  { keywords: ['給与', '給料', '賞与', 'ボーナス'], category: '給与', kind: 'income' },
]

// カード利用通知の利用先名は半角カタカナ(ﾐﾆｽﾄﾂﾌﾟ 等)で来ることが多く、
// CATEGORY_MAP は全角(ミニストップ)で書いているため、NFKCで正規化してから
// 比較する(NFKCは半角カタカナ→全角、全角英数→半角なども統一してくれる)。
function normalizeText_(text) {
  return (text || '').normalize('NFKC')
}

function getAutoCategory_(merchantName) {
  if (!merchantName) return { category: 'その他', kind: 'expense' }
  const norm = normalizeText_(merchantName).toLowerCase().replace(/[\s　]/g, '')
  for (const item of CATEGORY_MAP) {
    for (const kw of item.keywords) {
      if (norm.includes(kw)) {
        return { category: item.category, kind: item.kind }
      }
    }
  }
  return { category: 'その他', kind: 'expense' }
}

// =========================================================================
// メインエントリーポイント(時間主導トリガーで実行)
// =========================================================================
function processCardEmails() {
  const props = PropertiesService.getScriptProperties()
  const apiUrl = props.getProperty('API_URL')
  const apiSecret = props.getProperty('API_SECRET')
  const searchQuery = props.getProperty('SEARCH_QUERY')
  const labelName = props.getProperty('LABEL_NAME') || DEFAULT_LABEL_NAME

  if (!apiUrl || !apiSecret || !searchQuery) {
    Logger.log('スクリプトプロパティ(API_URL / API_SECRET / SEARCH_QUERY)が未設定です。プロジェクトの設定から追加してください。')
    return
  }

  const processedLabel = getOrCreateLabel_(labelName)
  const fullQuery = `${searchQuery} -label:${labelName}`
  const threads = GmailApp.search(fullQuery, 0, MAX_THREADS_PER_RUN)
  Logger.log(`検索クエリ: ${fullQuery}`)
  Logger.log(`今回処理するスレッド数: ${threads.length}件`)

  if (threads.length === 0) return

  for (const thread of threads) {
    const messages = thread.getMessages()
    let allSucceeded = true

    for (const message of messages) {
      const messageId = message.getId()
      const subject = message.getSubject()
      const from = message.getFrom()
      const body = message.getPlainBody()

      Logger.log(`処理中メール: ${subject} / ${from} (ID: ${messageId})`)

      // 速報版(詳細情報が欠けた先行通知)は無視して安全にスキップする
      if (subject.includes('【速報版】')) {
        Logger.log('スキップ: 速報版のため無視します')
        continue
      }

      // パーサーの振り分けは件名だけでなく送信元アドレスも見る。
      // Oliveなど三井住友の一部ブランドは件名に「三井住友カード」を含まないことがあるため、
      // statement@vpass.ne.jp / rakuten-card.co.jp といった実際の送信元で判定する方が確実。
      let parsedData = null
      if (from.includes('vpass.ne.jp') || subject.includes('三井住友カード') || subject.includes('Olive')) {
        parsedData = parseSmbcCard_(body)
      } else if (from.includes('rakuten-card.co.jp') || subject.includes('カード利用のお知らせ') || subject.includes('楽天カード')) {
        parsedData = parseRakutenCard_(body)
      } else if (from.toLowerCase().includes('paypay') || subject.includes('PayPay')) {
        parsedData = parsePayPay_(body)
      }

      let ok
      if (parsedData) {
        // --- 正規表現パース成功: 構造化データをそのまま送信(高速・無料) ---
        const merchant = normalizeText_(parsedData.merchant)
        const auto = getAutoCategory_(merchant)
        ok = sendStructured_(apiUrl, apiSecret, {
          date: parsedData.date,
          amount: parsedData.amount,
          category: auto.category,
          kind: auto.kind,
          payment_method: parsedData.paymentMethod,
          memo: `${parsedData.paymentMethod}自動連携 (${merchant})`,
          external_id: messageId,
        })
      } else {
        // --- 正規表現で解析できなかった: 件名+本文をそのまま送り、
        //     サーバー側のGemini解析にフォールバックする ---
        Logger.log('正規表現パース失敗。Geminiフォールバックに送信します')
        ok = sendRawText_(apiUrl, apiSecret, `件名: ${subject}\n\n${body.slice(0, MAX_BODY_LENGTH)}`, messageId)
      }

      if (!ok) allSucceeded = false
    }

    // スレッド内の全メッセージが処理できた場合だけラベルを付けて「処理済み」にする。
    // 一部失敗した場合は次回また対象になり、再送を試みる。
    if (allSucceeded) {
      thread.addLabel(processedLabel)
    }
  }
}

/**
 * 動作確認用。API接続とサーバー側の登録処理を1件だけテストする。
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

  const ok = sendStructured_(apiUrl, apiSecret, {
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    amount: 1280,
    category: '食費',
    kind: 'expense',
    payment_method: 'クレジットカード',
    memo: 'テスト用取引(sendTestTransactionから送信)',
    external_id: `test-${Date.now()}`,
  })
  Logger.log(ok ? 'テスト送信に成功しました。履歴タブを確認してください。' : 'テスト送信に失敗しました。ログを確認してください。')
}

/**
 * processCardEmails を15分おきに実行する時間主導型トリガーを作成する。
 * 既存の同名トリガーがあれば一度削除してから作り直すので、複数回実行しても重複しない。
 */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processCardEmails')
    .forEach(t => ScriptApp.deleteTrigger(t))

  ScriptApp.newTrigger('processCardEmails')
    .timeBased()
    .everyMinutes(15)
    .create()

  Logger.log('15分おきのトリガーを作成しました。')
}

// =========================================================================
// 各カード会社のパーサーモジュール
// =========================================================================

// 三井住友カード
function parseSmbcCard_(body) {
  // パターン1: 新フォーマット
  const regex1 = /ご利用日時：\s*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})[^\n]*\n([^\n]+?)\s+([\d,]+)\s*円/
  const match1 = body.match(regex1)
  if (match1) {
    let merchant = match1[2].trim()
    merchant = merchant.replace(/（[^）]+）$/, '').trim()
    return {
      date: match1[1].replace(/\//g, '-'),
      amount: parseInt(match1[3].replace(/,/g, ''), 10),
      merchant: merchant || '三井住友カード利用',
      paymentMethod: 'クレジットカード',
    }
  }

  // パターン2: 旧フォーマットや崩れたテキストへの安全策
  const dateRegex = /ご利用日時.*?([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})/
  const amountRegex = /ご利用金額.*?([\d,]+)\s*円/
  const merchantRegex = /ご利用加盟店.*?([^\r\n]+)/

  const dMatch = body.match(dateRegex)
  const aMatch = body.match(amountRegex)
  const mMatch = body.match(merchantRegex)

  if (dMatch && aMatch) {
    return {
      date: dMatch[1].replace(/\//g, '-'),
      amount: parseInt(aMatch[1].replace(/,/g, ''), 10),
      merchant: mMatch ? mMatch[1].trim() : '三井住友カード利用',
      paymentMethod: 'クレジットカード',
    }
  }
  return null
}

// 楽天カード
function parseRakutenCard_(body) {
  // パターン1: 表形式フォーマット
  const regex1 = /([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})\s+([^\n]+?)\s+([\d,]+)\s*円/
  const match1 = body.match(regex1)
  if (match1) {
    return {
      date: match1[1].replace(/\//g, '-'),
      amount: parseInt(match1[3].replace(/,/g, ''), 10),
      merchant: match1[2].trim(),
      paymentMethod: 'クレジットカード',
    }
  }

  // パターン2: 旧フォーマット
  const dateRegex = /利用日.*?([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})/
  const amountRegex = /利用金額.*?([\d,]+)\s*円/
  const merchantRegex = /利用先.*?([^\r\n]+)/

  const dMatch = body.match(dateRegex)
  const aMatch = body.match(amountRegex)
  const mMatch = body.match(merchantRegex)

  if (dMatch && aMatch) {
    return {
      date: dMatch[1].replace(/\//g, '-'),
      amount: parseInt(aMatch[1].replace(/,/g, ''), 10),
      merchant: mMatch ? mMatch[1].trim() : '楽天カード利用',
      paymentMethod: 'クレジットカード',
    }
  }
  return null
}

// PayPay
function parsePayPay_(body) {
  const dateRegex = /決済日時：([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日\s*([0-9:]{5})/
  const amountRegex = /決済金額：([\d,]+)円/
  const merchantRegex = /決済先：([^\r\n]+)/

  const dateMatch = body.match(dateRegex)
  const amountMatch = body.match(amountRegex)
  const merchantMatch = body.match(merchantRegex)

  if (dateMatch && amountMatch && merchantMatch) {
    const y = dateMatch[1]
    const m = String(dateMatch[2]).padStart(2, '0')
    const d = String(dateMatch[3]).padStart(2, '0')
    return {
      date: `${y}-${m}-${d}`,
      amount: parseInt(amountMatch[1].replace(/,/g, ''), 10),
      merchant: merchantMatch[1].trim(),
      paymentMethod: 'PayPay',
    }
  }
  return null
}

// =========================================================================
// アプリAPIとの通信
// =========================================================================

/**
 * 正規表現で抽出済みの構造化データを送る(高速・無料。Geminiは呼ばれない)。
 */
function sendStructured_(apiUrl, apiSecret, fields) {
  return postToApi_(apiUrl, apiSecret, fields)
}

/**
 * 正規表現で解析できなかった場合のフォールバック。
 * サーバー側でGeminiが解析する(confidenceが低い場合は登録されずスキップされる)。
 */
function sendRawText_(apiUrl, apiSecret, text, externalId) {
  return postToApi_(apiUrl, apiSecret, { text: text, external_id: externalId })
}

function postToApi_(apiUrl, apiSecret, payload) {
  try {
    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-import-secret': apiSecret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    })

    const code = response.getResponseCode()
    const text = response.getContentText()

    // 200/201はもちろん、duplicate:true(重複で未登録)も「処理済み」として成功扱いにする
    if (code >= 200 && code < 300) {
      Logger.log(`登録OK (${code}): ${text}`)
      return true
    }

    Logger.log(`登録失敗 (status ${code}): ${text}`)
    return false
  } catch (e) {
    Logger.log(`通信エラー: ${e}`)
    return false
  }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name)
}
