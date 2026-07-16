// PATCHリクエストボディから許可済みフィールドだけを抜き出す。
// supabaseAdmin(service role key)はRLSを完全にバイパスするため、
// リクエストボディをそのまま .update() に渡すと user_id 等の
// 意図しないカラムまで上書きされてしまう(マスアサインメント)。
export function pickAllowed<T extends object, K extends keyof T>(
  body: Partial<Record<K, unknown>>,
  keys: readonly K[]
): Partial<T> {
  const result: Partial<T> = {}
  for (const key of keys) {
    if (key in body) result[key] = body[key] as T[K]
  }
  return result
}
