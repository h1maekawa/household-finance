// lib/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai'
import { ParsedTransaction, CATEGORIES, PAYMENT_METHODS } from '@/types/transaction'
import { format } from 'date-fns'

const apiKey = process.env.GEMINI_API_KEY || 'placeholder-gemini-key'
const genAI = new GoogleGenerativeAI(apiKey)

const categoryNames = CATEGORIES.map((c) => c.name).join(', ')
const paymentNames = PAYMENT_METHODS.map((p) => p.name).join(', ')

const SYSTEM_PROMPT = `あなたは家計簿の入力アシスタントです。
ユーザーの自然言語入力から取引情報をJSON形式で抽出してください。

カテゴリの選択肢：${categoryNames}
支払方法の選択肢：${paymentNames}

日付が省略された場合は今日の日付（{{today}}）を使用してください。

必ずJSON形式のみで返答してください。余分なテキストは不要です。コードブロックも不要です。

出力スキーマ：
{
  "date": "YYYY-MM-DD",
  "amount": 数値（整数、円）,
  "category": "カテゴリ名",
  "payment_method": "支払方法名",
  "memo": "メモ（簡潔に）",
  "confidence": "high" | "medium" | "low"
}

confidenceの基準：
- high: 金額・カテゴリ・支払方法すべて明確
- medium: 一部推測あり
- low: 金額不明またはカテゴリが不明瞭

入力：{{user_input}}`

export async function parseChatInput(text: string): Promise<ParsedTransaction> {
  const today = format(new Date(), 'yyyy-MM-dd')
  const prompt = SYSTEM_PROMPT
    .replace('{{today}}', today)
    .replace('{{user_input}}', text)

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const result = await model.generateContent(prompt)
  const responseText = result.response.text().trim()

  // JSON部分だけ抽出（コードブロック対応）
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Geminiの応答からJSONを抽出できませんでした')
  }

  const parsed = JSON.parse(jsonMatch[0]) as ParsedTransaction

  // バリデーション
  if (!parsed.date || !parsed.amount || !parsed.category || !parsed.payment_method) {
    throw new Error('必須フィールドが欠落しています')
  }

  // カテゴリ・支払方法の検証
  const validCategories = CATEGORIES.map((c) => c.name)
  const validPayments = PAYMENT_METHODS.map((p) => p.name)

  if (!validCategories.includes(parsed.category)) {
    parsed.category = 'その他'
    parsed.confidence = 'low'
  }

  if (!validPayments.includes(parsed.payment_method)) {
    parsed.payment_method = '現金'
    parsed.confidence = 'low'
  }

  return parsed
}
