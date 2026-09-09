// lib/api-errors.ts
//
// DBやライブラリの詳細をクライアントへ返さないための共通ハンドラ。
//
// Session Client + RLS へ移行すると、権限で弾かれたときに
// "new row violates row-level security policy for table ..." のような
// スキーマ内部が読めるメッセージが返る。ユーザーには一般的な文言だけを返し、
// 原因はサーバーログにだけ残す。

type SupabaseLikeError = { message?: string; code?: string; details?: string }

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  const e = error as SupabaseLikeError | null
  if (e && typeof e === 'object') {
    return [e.code, e.message, e.details].filter(Boolean).join(' / ') || String(error)
  }
  return String(error)
}

/** 読み取り失敗。詳細はログへ、クライアントへは一般文言 */
export function readFailed(context: string, error: unknown): Response {
  console.error(`[${context}] 読み取りに失敗:`, describe(error))
  return Response.json({ error: 'データの取得に失敗しました' }, { status: 500 })
}

/** 書き込み失敗。詳細はログへ、クライアントへは一般文言 */
export function writeFailed(context: string, error: unknown): Response {
  console.error(`[${context}] 処理に失敗:`, describe(error))
  return Response.json({ error: '処理に失敗しました' }, { status: 500 })
}
