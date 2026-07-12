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
const DEFAULT_BACKFILL_LABEL_NAME = 'kakeibo-backfill-processed'
const MAX_THREADS_PER_RUN = 30
const MAX_BACKFILL_THREADS_PER_RUN = 100
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
  { keywords: ['ファミマ', 'ファミリーマート', 'セブン', 'ローソン', 'ミニストップ', 'ministop', 'trialgo', 'trial'], category: '日用品', kind: 'expense' },
  { keywords: ['jr', 'メトロ', '都営', 'suica', 'pasmo', 'タクシー', 'luup'], category: '交通費', kind: 'expense' },
  { keywords: ['マクドナルド', 'マック', 'スタバ', 'スターバックス', 'ガスト', 'サイゼリヤ', '壱角家', 'すき家', 'sukiya'], category: '外食', kind: 'expense' },
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

  processCardEmailsByQuery_(apiUrl, apiSecret, searchQuery, labelName, MAX_THREADS_PER_RUN)
}

/**
 * 過去分のカード利用通知をまとめて取り込む手動実行用。
 * スクリプトプロパティ BACKFILL_SEARCH_QUERY があればそれを使い、
 * なければ SEARCH_QUERY の newer_than 条件を外した検索にする。
 */
function backfillCardEmails() {
  const props = PropertiesService.getScriptProperties()
  const apiUrl = props.getProperty('API_URL')
  const apiSecret = props.getProperty('API_SECRET')
  const baseSearchQuery = props.getProperty('SEARCH_QUERY')
  const backfillSearchQuery = props.getProperty('BACKFILL_SEARCH_QUERY') || stripRelativeDateQuery_(baseSearchQuery)
  const labelName = props.getProperty('BACKFILL_LABEL_NAME') || DEFAULT_BACKFILL_LABEL_NAME

  processCardEmailsByQuery_(apiUrl, apiSecret, backfillSearchQuery, labelName, MAX_BACKFILL_THREADS_PER_RUN)
}

/**
 * 過去取り込み用の検索条件で、Gmail上に何件見えているかだけ確認する。
 * 登録やラベル付けは行わない。
 */
function diagnoseBackfillEmails() {
  const props = PropertiesService.getScriptProperties()
  const baseSearchQuery = props.getProperty('SEARCH_QUERY')
  const backfillSearchQuery = props.getProperty('BACKFILL_SEARCH_QUERY') || stripRelativeDateQuery_(baseSearchQuery)
  const labelName = props.getProperty('BACKFILL_LABEL_NAME') || DEFAULT_BACKFILL_LABEL_NAME

  if (!backfillSearchQuery) {
    Logger.log('BACKFILL_SEARCH_QUERY または SEARCH_QUERY が未設定です。')
    return
  }

  const fullQuery = `${backfillSearchQuery} -label:${labelName}`
  const threads = GmailApp.search(fullQuery, 0, MAX_BACKFILL_THREADS_PER_RUN)
  let messageCount = 0
  Logger.log(`過去取り込み検索クエリ: ${fullQuery}`)
  Logger.log(`検索結果: ${threads.length}スレッド`)

  for (const thread of threads) {
    const messages = thread.getMessages()
    messageCount += messages.length
    for (const message of messages.slice(0, 3)) {
      Logger.log(`候補: ${message.getDate()} / ${message.getSubject()} / ${message.getFrom()}`)
    }
  }

  Logger.log(`検索結果内のメール数: ${messageCount}件`)
}

function processCardEmailsByQuery_(apiUrl, apiSecret, searchQuery, labelName, maxThreads) {
  if (!apiUrl || !apiSecret || !searchQuery) {
    Logger.log('スクリプトプロパティ(API_URL / API_SECRET / SEARCH_QUERY)が未設定です。プロジェクトの設定から追加してください。')
    return
  }

  const processedLabel = getOrCreateLabel_(labelName)
  const fullQuery = `${searchQuery} -label:${labelName}`
  const threads = GmailApp.search(fullQuery, 0, maxThreads)
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
      if (from.includes('dn.smbc.co.jp') || subject.includes('三井住友銀行')) {
        parsedData = parseSmbcBankTransfer_(body)
      } else if (from.includes('ac.rakuten-bank.co.jp') || subject.includes('楽天銀行')) {
        parsedData = parseRakutenBank_(body)
      } else if (from.includes('vpass.ne.jp') || subject.includes('三井住友カード') || subject.includes('Olive')) {
        parsedData = parseSmbcCard_(body)
        if (parsedData && !Array.isArray(parsedData)) parsedData.cardIssuer = '三井住友カード'
      } else if (from.includes('rakuten-card.co.jp') || subject.includes('カード利用のお知らせ') || subject.includes('楽天カード')) {
        parsedData = parseRakutenCard_(body)
        if (parsedData && !Array.isArray(parsedData)) parsedData.cardIssuer = '楽天カード'
      } else if (from.toLowerCase().includes('paypay') || subject.includes('PayPay')) {
        parsedData = parsePayPay_(body)
      }

      let ok
      if (parsedData && parsedData.skip) {
        Logger.log(`スキップ: ${parsedData.reason}`)
        ok = true
      } else if (parsedData) {
        // --- 正規表現パース成功: 構造化データをそのまま送信(高速・無料) ---
        const parsedItems = Array.isArray(parsedData) ? parsedData : [parsedData]
        ok = true

        parsedItems.forEach((item, index) => {
          const merchant = normalizeText_(item.merchant)
          const auto = getAutoCategory_(merchant)
          const needsReview = auto.category === 'その他' || auto.category === 'その他収入'
          const itemExternalId = parsedItems.length > 1 ? `${messageId}-${index + 1}` : messageId
          const payload = {
            date: item.date,
            amount: item.amount,
            category: item.category || auto.category,
            kind: auto.kind,
            payment_method: item.paymentMethod,
            memo: item.memo || `${item.paymentMethod}自動連携 (${merchant})`,
            card_issuer: item.cardIssuer || null,
            needs_review: needsReview,
            review_reason: needsReview ? `分類確認: ${merchant}` : null,
            external_id: itemExternalId,
          }

          if (item.importTarget === 'scheduled_payment') {
            payload.import_target = 'scheduled_payment'
            payload.name = item.merchant || '口座引落予定'
          }

          if (!sendStructured_(apiUrl, apiSecret, payload)) ok = false
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

function stripRelativeDateQuery_(query) {
  return String(query || '')
    .replace(/\bnewer_than:\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  const ok = sendStructured_(apiUrl, apiSecret, {
    date: today,
    amount: 1280,
    category: '食費',
    kind: 'expense',
    payment_method: 'クレジットカード',
    memo: 'テスト用取引(sendTestTransactionから送信)',
    external_id: `test-send-transaction-${today}`,
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

/**
 * 取り込みが止まっている場所を調べるための診断関数。
 * APIへの登録は行わず、Gmail検索結果・送信元・件名・パーサー判定だけをログに出す。
 */
function diagnoseCardEmails() {
  const props = PropertiesService.getScriptProperties()
  const apiUrl = props.getProperty('API_URL')
  const apiSecret = props.getProperty('API_SECRET')
  const searchQuery = props.getProperty('SEARCH_QUERY')
  const labelName = props.getProperty('LABEL_NAME') || DEFAULT_LABEL_NAME

  Logger.log(`API_URL: ${apiUrl ? '設定済み' : '未設定'}`)
  Logger.log(`API_SECRET: ${apiSecret ? '設定済み' : '未設定'}`)
  Logger.log(`SEARCH_QUERY: ${searchQuery || '未設定'}`)
  Logger.log(`LABEL_NAME: ${labelName}`)

  if (!searchQuery) {
    Logger.log('SEARCH_QUERY が未設定のため、Gmail検索を実行できません。')
    return
  }

  const fullQuery = `${searchQuery} -label:${labelName}`
  const threads = GmailApp.search(fullQuery, 0, 10)
  Logger.log(`検索クエリ: ${fullQuery}`)
  Logger.log(`検索結果: ${threads.length}スレッド`)

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      const subject = message.getSubject()
      const from = message.getFrom()
      const body = message.getPlainBody()
      let parserName = '未判定'
      let parsedData = null

      if (from.includes('dn.smbc.co.jp') || subject.includes('三井住友銀行')) {
        parserName = '三井住友銀行'
        parsedData = parseSmbcBankTransfer_(body)
      } else if (from.includes('ac.rakuten-bank.co.jp') || subject.includes('楽天銀行')) {
        parserName = '楽天銀行'
        parsedData = parseRakutenBank_(body)
      } else if (from.includes('vpass.ne.jp') || subject.includes('三井住友カード') || subject.includes('Olive')) {
        parserName = '三井住友カード'
        parsedData = parseSmbcCard_(body)
      } else if (from.includes('rakuten-card.co.jp') || subject.includes('カード利用のお知らせ') || subject.includes('楽天カード')) {
        parserName = '楽天カード'
        parsedData = parseRakutenCard_(body)
      } else if (from.toLowerCase().includes('paypay') || subject.includes('PayPay')) {
        parserName = 'PayPay'
        parsedData = parsePayPay_(body)
      }

      Logger.log(`---`)
      Logger.log(`件名: ${subject}`)
      Logger.log(`送信元: ${from}`)
      Logger.log(`受信日時: ${message.getDate()}`)
      Logger.log(`パーサー: ${parserName}`)
      Logger.log(parsedData ? `解析OK: ${JSON.stringify(parsedData)}` : '解析NG: 正規表現に一致しません。Geminiフォールバック対象です。')
      if (!parsedData) {
        Logger.log(`本文先頭: ${body.slice(0, 700).replace(/\s+/g, ' ')}`)
      }
    }
  }
}

// =========================================================================
// 各カード会社のパーサーモジュール
// =========================================================================

// 三井住友銀行: 振込受付完了 / 口座出金
function parseSmbcBankTransfer_(body) {
  const normalizedBody = normalizeText_(body)

  if (!normalizedBody.includes('振込') && !normalizedBody.includes('出金') && !normalizedBody.includes('引落')) return null

  const scheduledDateRegex = /口座引落予定日\s*[:：]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/
  const scheduledDateMatch = normalizedBody.match(scheduledDateRegex)
  if (scheduledDateMatch) {
    const y = scheduledDateMatch[1]
    const m = String(scheduledDateMatch[2]).padStart(2, '0')
    const d = String(scheduledDateMatch[3]).padStart(2, '0')
    const date = `${y}-${m}-${d}`
    const items = []
    const detailRegex = /◆明細\d+([\s\S]*?)(?=◆明細\d+|―――|$)/g
    let detailMatch

    while ((detailMatch = detailRegex.exec(normalizedBody)) !== null) {
      const detail = detailMatch[1]
      const amountMatch = detail.match(/引落金額\s*[:：]\s*(\d{1,3}(?:,\d{3})*|\d+)\s*円/)
      const merchantMatch = detail.match(/内容\s*[:：]\s*([^\r\n]+)/)
      if (!amountMatch) continue

      const merchant = merchantMatch ? cleanMerchantName_(merchantMatch[1]) : '口座引落予定'
      items.push({
        importTarget: 'scheduled_payment',
        date: date,
        amount: parseInt(amountMatch[1].replace(/,/g, ''), 10),
        merchant: merchant || '口座引落予定',
        paymentMethod: '口座引落',
        category: 'その他',
        memo: `三井住友銀行 口座引落予定 (${merchant || '内容未設定'})`,
      })
    }

    if (items.length > 0) return items
  }

  const transferDateRegex = /受付日時\s*[:：]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2})時\s*(\d{1,2})分/
  const withdrawalDateRegex = /(?:出金日|引落日|取引日)\s*[:：]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/
  const amountRegex = /(?:振込金額|お振込金額|金額|出金金額|出金額|引落金額|引落額|取引金額)\s*[:：]?\s*(\d{1,3}(?:,\d{3})*|\d+)\s*円/
  const merchantRegex = /(?:振込先|お振込先|受取人名|受取人|振込先口座名義|内容|摘要)\s*[:：]\s*([^\r\n]+)/

  const dMatch = normalizedBody.match(transferDateRegex) || normalizedBody.match(withdrawalDateRegex)
  const aMatch = normalizedBody.match(amountRegex)
  const mMatch = normalizedBody.match(merchantRegex)

  if (dMatch && aMatch) {
    const y = dMatch[1]
    const m = String(dMatch[2]).padStart(2, '0')
    const d = String(dMatch[3]).padStart(2, '0')
    const merchant = mMatch ? cleanMerchantName_(mMatch[1]) : '三井住友銀行出金'
    return {
      date: `${y}-${m}-${d}`,
      amount: parseInt(aMatch[1].replace(/,/g, ''), 10),
      merchant: merchant || '三井住友銀行出金',
      paymentMethod: '口座振込',
    }
  }

  return null
}

// 三井住友カード
function parseSmbcCard_(body) {
  const normalizedBody = normalizeText_(body)

  // パターン1: 新フォーマット
  const regex1 = /ご利用日時[:：]\s*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})[^\n]*\n([^\n]+?)\s+([\d,]+)\s*円/
  const match1 = normalizedBody.match(regex1)
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
  const dateRegex = /(?:ご利用日時|ご利用日|利用日時|利用日|ご利用年月日)[^\d]*(\d{4}[\/年.-]\d{1,2}[\/月.-]\d{1,2})/
  const amountRegex = /(?:ご利用金額|利用金額|金額|ご利用額|利用額)[^\d]*(\d{1,3}(?:,\d{3})*|\d+)\s*円/
  const merchantRegex = /(?:ご利用先|利用先|ご利用加盟店|利用加盟店|加盟店名|ご利用店名|利用店名|ご利用店舗|利用店舗|店舗名|ショップ名)[:：\s]*([^\r\n]+)/

  const dMatch = normalizedBody.match(dateRegex)
  const aMatch = normalizedBody.match(amountRegex)
  const mMatch = normalizedBody.match(merchantRegex)

  if (dMatch && aMatch) {
    const merchant = mMatch ? cleanMerchantName_(mMatch[1]) : '三井住友カード利用'
    return {
      date: normalizeDate_(dMatch[1]),
      amount: parseInt(aMatch[1].replace(/,/g, ''), 10),
      merchant: merchant || '三井住友カード利用',
      paymentMethod: 'クレジットカード',
    }
  }
  return null
}

function normalizeDate_(value) {
  const match = String(value || '').match(/(\d{4})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/)
  if (!match) return value
  const y = match[1]
  const m = String(match[2]).padStart(2, '0')
  const d = String(match[3]).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function cleanMerchantName_(value) {
  return String(value || '')
    .replace(/^[\s:：]+/, '')
    .replace(/（[^）]+）$/, '')
    .replace(/\s+(?:ご利用金額|利用金額|金額|ご利用額|利用額).*$/, '')
    .trim()
}

// 楽天カード
function parseRakutenCard_(body) {
  const normalizedBody = normalizeText_(body)

  const paymentAmountRegex = /(?:確定|お支払い金額)[\s\S]{0,80}?(\d{1,3}(?:,\d{3})*|\d+)\s*円/
  const paymentDateRegex = /お支払い日\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
  const cardRegex = /ご利用カード\s*([^\r\n]+)/
  const paymentAmountMatch = normalizedBody.match(paymentAmountRegex)
  const paymentDateMatch = normalizedBody.match(paymentDateRegex)

  if (paymentAmountMatch && paymentDateMatch && normalizedBody.includes('お支払い金額')) {
    const y = paymentDateMatch[1]
    const m = String(paymentDateMatch[2]).padStart(2, '0')
    const d = String(paymentDateMatch[3]).padStart(2, '0')
    const cardMatch = normalizedBody.match(cardRegex)
    const cardName = cardMatch ? cleanMerchantName_(cardMatch[1]) : '楽天カード'

    return {
      importTarget: 'scheduled_payment',
      date: `${y}-${m}-${d}`,
      amount: parseInt(paymentAmountMatch[1].replace(/,/g, ''), 10),
      merchant: '楽天カード請求',
      paymentMethod: '口座振替',
      category: 'その他',
      memo: `${cardName || '楽天カード'} お支払い金額`,
    }
  }

  // パターン1: 表形式フォーマット
  const regex1 = /([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})\s+([^\n]+?)\s+([\d,]+)\s*円/
  const match1 = normalizedBody.match(regex1)
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

  const dMatch = normalizedBody.match(dateRegex)
  const aMatch = normalizedBody.match(amountRegex)
  const mMatch = normalizedBody.match(merchantRegex)

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

function parseRakutenBank_(body) {
  const normalizedBody = normalizeText_(body)
  if (!normalizedBody.includes('口座振替') && !normalizedBody.includes('自動引落')) return null

  const amountRegex = /(?:引落金額|支払金額|金額)\s*[:：]?\s*(\d{1,3}(?:,\d{3})*|\d+)\s*円/
  const dateRegex = /支払い日時\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
  const amountMatch = normalizedBody.match(amountRegex)
  const dateMatch = normalizedBody.match(dateRegex)

  if (!amountMatch) {
    return {
      skip: true,
      reason: '楽天銀行の自動引落メールに金額がないため、楽天カードのお支払い金額メールを優先します',
    }
  }

  if (dateMatch) {
    const y = dateMatch[1]
    const m = String(dateMatch[2]).padStart(2, '0')
    const d = String(dateMatch[3]).padStart(2, '0')
    return {
      importTarget: 'scheduled_payment',
      date: `${y}-${m}-${d}`,
      amount: parseInt(amountMatch[1].replace(/,/g, ''), 10),
      merchant: '楽天銀行 口座振替',
      paymentMethod: '口座振替',
      category: 'その他',
      memo: '楽天銀行 口座振替',
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
