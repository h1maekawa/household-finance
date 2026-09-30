export type CardActivityRow = {
  id: unknown
  date: unknown
  memo?: unknown
  amount: unknown
  card_issuer?: unknown
  payment_method?: unknown
  category?: unknown
  needs_review?: unknown
}

function merchantLabel(value: string): string {
  const normalized = value.normalize('NFKC')
  const match = normalized.match(/自動連携\s*\(([^)]+)\)/)
  return (match?.[1] ?? normalized).trim()
}

/** Raw email/body/external IDを外部レスポンスへ含めない最小化境界。 */
export function minimizeCardActivity(row: CardActivityRow) {
  const memo = typeof row.memo === 'string' ? row.memo : ''
  return {
    id: String(row.id),
    date: String(row.date).slice(0, 10),
    merchant: (merchantLabel(memo) || '未確認').slice(0, 160),
    amount: Math.abs(Math.round(Number(row.amount) || 0)),
    card: String(row.card_issuer || row.payment_method || '未確認').slice(0, 80),
    category: String(row.category || '未分類').slice(0, 80),
    review_status: row.needs_review === true ? 'unreviewed' as const : 'reviewed' as const,
  }
}

export function encodeCardActivityCursor(row: { date: string; id: string }): string {
  return Buffer.from(`${row.date}\n${row.id}`, 'utf8').toString('base64url')
}

export function decodeCardActivityCursor(value: string | null): { date: string; id: string } | null {
  if (!value) return null
  try {
    const [date, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('\n')
    if (rest.length || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-f-]{36}$/i.test(id)) return null
    return { date, id }
  } catch {
    return null
  }
}
