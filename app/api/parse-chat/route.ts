// app/api/parse-chat/route.ts
import { NextRequest } from 'next/server'
import { parseAssistantInput } from '@/lib/gemini'
import { getMergedCategories } from '@/lib/categories'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { text } = await request.json()

  if (!text || typeof text !== 'string') {
    return Response.json({ error: 'テキストが必要です' }, { status: 400 })
  }

  try {
    const merged = await getMergedCategories(user.id)
    const result = await parseAssistantInput(text, { expense: merged.expense, income: merged.income })

    if (result.type === 'add_category' || result.type === 'remove_category') {
      return Response.json({ type: result.type, category: result.category })
    }
    // 後方互換: 従来のレスポンス形 (parsed / confidence) を維持しつつ type を付与
    return Response.json({ type: 'transaction', parsed: result.parsed, confidence: result.parsed.confidence })
  } catch (err) {
    const message = err instanceof Error ? err.message : '解析に失敗しました'
    return Response.json({ error: message }, { status: 500 })
  }
}
