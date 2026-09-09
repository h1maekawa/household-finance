// lib/services/scheduled-payments-loader.ts
//
// 固定費・予定支払いの解決(I/O)。
// 引落日・円換算・引落口座名の解決ルールは fixed-costs.ts が正で、ここでは
// データを集めて当てはめるだけ。同じ解決を画面やAPIごとに書かないための入口。
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadFxRates } from '@/lib/repositories/fx-rates'
import { resolveAmountYen, resolveDueDate } from './fixed-costs'
import type { ResolvedScheduledPayment, ScheduledPayment } from '@/types/cashflow'

export async function loadResolvedScheduledPayments(
  userId: string,
  month: string,
  client?: SupabaseClient
): Promise<ResolvedScheduledPayment[]> {
  const supabase = client ?? (await createSupabaseServerClient())

  const [paymentsRes, accountsRes, fx] = await Promise.all([
    supabase
      .from('scheduled_payments')
      .select('*')
      .eq('user_id', userId)
      .order('due_day', { ascending: true }),
    // 口座テーブル(migration 018)が未適用でも固定費一覧は出せるようにする
    supabase.from('accounts').select('id, name').eq('user_id', userId),
    loadFxRates(),
  ])

  // 取得失敗を「予定なし」と混同しない。0円の予定として計算へ流さない
  if (paymentsRes.error) {
    throw new Error(`scheduled_payments の取得に失敗しました: ${paymentsRes.error.message}`)
  }

  const accountNames = new Map(
    (accountsRes.data ?? []).map(a => [a.id as string, a.name as string])
  )

  return ((paymentsRes.data ?? []) as ScheduledPayment[]).map(payment => ({
    ...payment,
    resolvedDueDate: resolveDueDate(payment, month),
    resolvedAmountYen: resolveAmountYen(payment, fx),
    debitAccountName: payment.debit_account_id
      ? accountNames.get(payment.debit_account_id) ?? null
      : null,
  }))
}
