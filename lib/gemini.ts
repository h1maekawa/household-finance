// lib/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai'
import { ParsedTransaction, CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS, Category, Kind } from '@/types/transaction'
import { format } from 'date-fns'

const apiKey = process.env.GEMINI_API_KEY || 'placeholder-gemini-key'
const genAI = new GoogleGenerativeAI(apiKey)

const paymentNames = PAYMENT_METHODS.map((p) => p.name).join(', ')

export interface CategoryLists {
  expense: Category[]
  income: Category[]
}

const DEFAULT_LISTS: CategoryLists = {
  expense: [...CATEGORIES],
  income: [...INCOME_CATEGORIES],
}

const TRANSACTION_PROMPT = `あなたは家計簿の入力アシスタントです。
ユーザーの自然言語入力、またはカード利用通知・給与振込などのメール本文から取引情報をJSON形式で抽出してください。

まず支出(kind: "expense")か収入(kind: "income")かを判定してください。給与・賞与・ボーナス・振込入金などは収入です。

支出カテゴリの選択肢：{{expense_categories}}
収入カテゴリの選択肢：{{income_categories}}
支払方法の選択肢：${paymentNames}

kindが"expense"の場合は支出カテゴリから、"income"の場合は収入カテゴリから選んでください。

日付が省略された場合は今日の日付（{{today}}）を使用してください。

必ずJSON形式のみで返答してください。余分なテキストは不要です。コードブロックも不要です。

出力スキーマ：
{
  "date": "YYYY-MM-DD",
  "amount": 数値（整数、円）,
  "category": "カテゴリ名",
  "payment_method": "支払方法名",
  "memo": "メモ（簡潔に）",
  "kind": "income" | "expense",
  "confidence": "high" | "medium" | "low"
}

confidenceの基準：
- high: 金額・カテゴリ・支払方法すべて明確
- medium: 一部推測あり
- low: 金額不明またはカテゴリが不明瞭

入力：{{user_input}}`

const ASSISTANT_PROMPT = `あなたは家計簿アプリの操作アシスタントです。
ユーザーの入力を読み、まず何をしたいのか（intent）を判定して、JSON形式のみで返答してください。

## intent の種類

1. "transaction" — 支出や収入の記録（例：「コーヒー 500円 現金」「給料 30万円入った」）
2. "add_category" — カテゴリ（項目）の追加指示
   （例：「支出の項目にサブスクを追加して」「カテゴリに『ペット』を作って」「収入カテゴリに副業を追加」）
3. "remove_category" — カテゴリ（項目）の削除指示
   （例：「カテゴリ『テスト』を削除して」「支出の項目からペットを消して」）

## intent: "transaction" の場合の出力スキーマ

{
  "intent": "transaction",
  "date": "YYYY-MM-DD",
  "amount": 数値（整数、円）,
  "category": "カテゴリ名",
  "payment_method": "支払方法名",
  "memo": "メモ（簡潔に）",
  "kind": "income" | "expense",
  "confidence": "high" | "medium" | "low"
}

- 支出カテゴリの選択肢：{{expense_categories}}
- 収入カテゴリの選択肢：{{income_categories}}
- 支払方法の選択肢：${paymentNames}
- 日付が省略された場合は今日（{{today}}）
- confidence: high=金額・カテゴリ・支払方法すべて明確 / medium=一部推測 / low=金額不明かカテゴリ不明瞭

## intent: "add_category" の場合の出力スキーマ

{
  "intent": "add_category",
  "name": "カテゴリ名（10文字以内、『』などの引用符は除く）",
  "icon": "カテゴリに合う絵文字1つ",
  "kind": "expense" | "income",
  "is_fixed": true | false
}

- kind はユーザーが収入の項目と明言しない限り "expense"
- is_fixed は家賃・サブスク・保険のような毎月定額の固定費なら true、それ以外は false
- icon はカテゴリ内容に最も合う絵文字を1つ選ぶ（例：ペット→🐕 サブスク→🔁 美容→💇）

## intent: "remove_category" の場合の出力スキーマ

{
  "intent": "remove_category",
  "name": "カテゴリ名（引用符は除く）",
  "kind": "expense" | "income"
}

必ずJSON形式のみで返答してください。余分なテキストやコードブロックは不要です。

入力：{{user_input}}`

function buildPrompt(template: string, text: string, lists: CategoryLists) {
  return template
    .replace('{{today}}', format(new Date(), 'yyyy-MM-dd'))
    .replace('{{expense_categories}}', lists.expense.map(c => c.name).join(', '))
    .replace('{{income_categories}}', lists.income.map(c => c.name).join(', '))
    .replace('{{user_input}}', text)
}

async function generateJson(prompt: string): Promise<Record<string, unknown>> {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const result = await model.generateContent(prompt)
  const responseText = result.response.text().trim()

  // JSON部分だけ抽出（コードブロック対応）
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Geminiの応答からJSONを抽出できませんでした')
  }
  return JSON.parse(jsonMatch[0]) as Record<string, unknown>
}

function validateTransaction(parsed: ParsedTransaction, lists: CategoryLists): ParsedTransaction {
  if (!parsed.date || !parsed.amount || !parsed.category || !parsed.payment_method) {
    throw new Error('必須フィールドが欠落しています')
  }

  if (parsed.kind !== 'income') parsed.kind = 'expense'

  const validCategories = (parsed.kind === 'income' ? lists.income : lists.expense).map((c) => c.name)
  const validPayments = PAYMENT_METHODS.map((p) => p.name)

  if (!validCategories.includes(parsed.category)) {
    parsed.category = parsed.kind === 'income' ? 'その他収入' : 'その他'
    parsed.confidence = 'low'
  }

  if (!(validPayments as string[]).includes(parsed.payment_method)) {
    parsed.payment_method = parsed.kind === 'income' ? '口座振込' : '現金'
    parsed.confidence = 'low'
  }

  return parsed
}

/** 取引テキスト専用の解析（Gmail取込などから利用） */
export async function parseChatInput(text: string, lists: CategoryLists = DEFAULT_LISTS): Promise<ParsedTransaction> {
  const raw = await generateJson(buildPrompt(TRANSACTION_PROMPT, text, lists))
  return validateTransaction(raw as unknown as ParsedTransaction, lists)
}

export interface ParsedCategoryAdd {
  name: string
  icon: string
  kind: Kind
  is_fixed: boolean
}

export interface ParsedCategoryRemove {
  name: string
  kind: Kind
}

export type AssistantParseResult =
  | { type: 'transaction'; parsed: ParsedTransaction }
  | { type: 'add_category'; category: ParsedCategoryAdd }
  | { type: 'remove_category'; category: ParsedCategoryRemove }

/**
 * チャットボット用の解析。取引の記録に加えて
 * 「支出の項目に◯◯を追加して」のようなカテゴリ追加指示も理解する。
 */
export async function parseAssistantInput(text: string, lists: CategoryLists = DEFAULT_LISTS): Promise<AssistantParseResult> {
  const raw = await generateJson(buildPrompt(ASSISTANT_PROMPT, text, lists))

  if (raw.intent === 'remove_category') {
    const name = String(raw.name ?? '').replace(/[「」『』"']/g, '').trim()
    if (!name) throw new Error('削除するカテゴリ名を読み取れませんでした')
    return {
      type: 'remove_category',
      category: { name, kind: raw.kind === 'income' ? 'income' : 'expense' },
    }
  }

  if (raw.intent === 'add_category') {
    const name = String(raw.name ?? '').replace(/[「」『』"']/g, '').trim()
    if (!name) throw new Error('追加するカテゴリ名を読み取れませんでした')
    return {
      type: 'add_category',
      category: {
        name: name.slice(0, 10),
        icon: String(raw.icon ?? '').trim() || '📦',
        kind: raw.kind === 'income' ? 'income' : 'expense',
        is_fixed: Boolean(raw.is_fixed),
      },
    }
  }

  const parsed = validateTransaction(raw as unknown as ParsedTransaction, lists)
  return { type: 'transaction', parsed }
}
