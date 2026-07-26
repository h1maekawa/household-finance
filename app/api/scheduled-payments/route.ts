import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import {
  createScheduledPayment,
  listScheduledPayments,
} from '@/lib/repositories/scheduled-payments'
import { listAccounts } from '@/lib/repositories/accounts'
import { loadFxRates } from '@/lib/repositories/fx-rates'
import { resolveAmountYen, resolveDueDate } from '@/lib/services/fixed-costs'
import type { ResolvedScheduledPayment } from '@/types/cashflow'

/**
 * 固定費の一覧。日付・金額・口座名の解決はサーバー側の純関数で行い、
 * 解決済みの値を添えて返す(クライアントで再計算しない)。
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const month = request.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7)

  try {
    const [payments, accounts, fx] = await Promise.all([
      listScheduledPayments(user.id),
      // 口座テーブル(migration 018)が未適用でも固定費一覧は出せるようにする
      listAccounts(user.id).catch(() => []),
      loadFxRates(),
    ])

    const accountNames = new Map(accounts.map(a => [a.id, a.name]))

    const resolved: ResolvedScheduledPayment[] = payments.map(payment => ({
      ...payment,
      resolvedDueDate: resolveDueDate(payment, month),
      resolvedAmountYen: resolveAmountYen(payment, fx),
      debitAccountName: payment.debit_account_id
        ? accountNames.get(payment.debit_account_id) ?? null
        : null,
    }))

    return Response.json(resolved)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return Response.json({ error: '名称を入力してください' }, { status: 400 })

  try {
    // pickWritableFields が許可列だけを通すので、user_id 等は body から書けない
    const payment = await createScheduledPayment(user.id, {
      ...body,
      name,
      is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
    })
    return Response.json(payment, { status: 201 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
