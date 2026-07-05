// lib/supabase/server.ts
// サーバー側(Route Handler / Server Component)専用の Supabase クライアント。
// next/headers の cookies() 経由でユーザーのセッション Cookie を読み書きする。
// Route Handler は Cookie を書き換えられない場合があるため、setAll は
// 失敗しても無視してよい(Proxy 側でセッションのリフレッシュを行う)。
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Component からは Cookie を書き換えられない。
          // セッションのリフレッシュは proxy.ts が担当するので無視してよい。
        }
      },
    },
  })
}
