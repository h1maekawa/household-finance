// proxy.ts (Next.js 16 の Proxy。旧 middleware.ts に相当)
// ログイン必須ページを未ログインユーザーから守るための「楽観的チェック」。
// 実際のデータ保護は各 API Route Handler 側の getAuthenticatedUser() が担う
// (Proxy はあくまで最初の防御線であり、唯一の防御手段にしてはいけない)。
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// ログインしないと使えないページ
const protectedPaths = [
  '/dashboard',
  '/transactions',
  '/cashflow',
  '/investments',
  '/input',
  '/assets',
]

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  const { pathname } = request.nextUrl
  const isProtected = protectedPaths.some(
    path => pathname === path || pathname.startsWith(`${path}/`)
  )

  if (isProtected && !user) {
    const redirectUrl = new URL('/flow/setup', request.url)
    redirectUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // api, 静的ファイル, 画像最適化, favicon 以外の全パスで実行
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)',
  ],
}
