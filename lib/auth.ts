import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export function getBearerToken(request: NextRequest) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

/**
 * リクエストからログイン中のユーザーを取得する。
 * 1. Authorization: Bearer <token> ヘッダー(外部クライアント・テスト用)
 * 2. Cookie ベースのセッション(ブラウザからの通常の fetch() 呼び出し)
 * のどちらでも認証できるようにする。ブラウザの fetch() は明示的に
 * ヘッダーを付けない限り Authorization を送らないため、2 が実運用の主経路。
 */
export async function getAuthenticatedUser(request: NextRequest) {
  const token = getBearerToken(request)
  if (token) {
    const { data, error } = await supabase.auth.getUser(token)
    if (!error && data.user) return data.user
  }

  try {
    const serverSupabase = await createSupabaseServerClient()
    const { data, error } = await serverSupabase.auth.getUser()
    if (error || !data.user) return null
    return data.user
  } catch {
    return null
  }
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
