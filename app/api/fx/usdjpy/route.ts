import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { getUsdToJpyCached } from '@/lib/repositories/fx-rates'

/**
 * 外貨建て固定費(ジブラルタ生命 105 USD 等)の円換算プレビュー用。
 * 実際の請求額はサーバー側の resolveAmountYen が引き落とし日のレートで再計算する。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  try {
    const rate = await getUsdToJpyCached()
    return Response.json(rate)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
