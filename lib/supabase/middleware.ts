// lib/supabase/middleware.ts
// proxy.ts から呼び出す、セッション Cookie のリフレッシュ処理。
// Supabase 公式の Next.js SSR 連携パターンに準拠。
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // getUser() はトークンを Supabase Auth サーバーに問い合わせて検証する
  // (getSession() だけだとローカルの Cookie を信用してしまい、失効済み
  // セッションを見逃す可能性があるため)。
  // Supabase が未設定(プレースホルダーURL)の環境では通信自体が失敗しうるので、
  // その場合は「未ログイン」として扱う。
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    user = null
  }

  return { supabaseResponse, user }
}
