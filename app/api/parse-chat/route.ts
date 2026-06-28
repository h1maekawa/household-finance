// app/api/parse-chat/route.ts
import { NextRequest } from 'next/server'
import { parseChatInput } from '@/lib/gemini'

export async function POST(request: NextRequest) {
  const { text } = await request.json()

  if (!text || typeof text !== 'string') {
    return Response.json({ error: 'テキストが必要です' }, { status: 400 })
  }

  try {
    const parsed = await parseChatInput(text)
    return Response.json({ parsed, confidence: parsed.confidence })
  } catch (err) {
    const message = err instanceof Error ? err.message : '解析に失敗しました'
    return Response.json({ error: message }, { status: 500 })
  }
}
