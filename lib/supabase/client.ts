// lib/supabase/client.ts
// ブラウザ(クライアントコンポーネント)専用の Supabase クライアント。
// @supabase/ssr の createBrowserClient を使うことで、セッションが
// Cookie に保存され、proxy.ts やサーバー側(Route Handler)からも
// 同じセッションを読み取れるようになる。
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
