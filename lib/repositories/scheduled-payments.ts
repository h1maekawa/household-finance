// lib/repositories/scheduled-payments.ts
//
// 固定費(scheduled_payments)の Supabase アクセスを1箇所に集約する
// (docs/v3-architecture-review.md §3)。user_id フィルタはここに閉じ込め、
// API 側の書き忘れ事故を構造的に防ぐ。
//
// migration 018(debit_account_id) / 020(payment_method 他) が未適用の環境でも
// 動くように、未知の列を検出したら落として再試行する。PostgREST は未知の列が
// 1つでもあるとクエリ全体を弾くため、これが無いと固定費画面ごと落ちる。
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { ScheduledPayment, ScheduledPaymentInput } from '@/types/cashflow'

/** migration 018 / 020 で追加した列。未適用環境では落として再試行する */
const OPTIONAL_COLUMNS = [
  'debit_account_id',
  'payment_method',
  'credit_card_id',
  'start_date',
  'end_date',
  'recurrence',
  'business_day_rule',
  'currency',
  'foreign_amount',
] as const

/** API が書き込みを許す列。body の丸ごと spread は禁止(user_id 等を書けてしまう) */
const WRITABLE_COLUMNS = [
  'name',
  'amount',
  'due_day',
  'category',
  'type',
  'is_active',
  'memo',
  'bank_account',
  'last_paid_month',
  'scheduled_date',
  'external_id',
  ...OPTIONAL_COLUMNS,
] as const

type WritableColumn = (typeof WRITABLE_COLUMNS)[number]

function isMissingColumnError(message: string, column: string): boolean {
  // PostgREST: PGRST204 / Postgres: 42703。どちらも列名がメッセージに含まれる
  return message.includes(column)
}

/**
 * body から書き込み可能な列だけを取り出す。
 * undefined は「変更しない」、null は「明示的に消す」として扱う。
 */
export function pickWritableFields(
  body: Record<string, unknown>
): Partial<Record<WritableColumn, unknown>> {
  const result: Partial<Record<WritableColumn, unknown>> = {}
  for (const column of WRITABLE_COLUMNS) {
    if (body[column] !== undefined) result[column] = body[column]
  }
  return result
}

export async function listScheduledPayments(userId: string): Promise<ScheduledPayment[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('scheduled_payments')
    .select('*')
    .eq('user_id', userId)
    .order('due_day', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ScheduledPayment[]
}

export async function createScheduledPayment(
  userId: string,
  input: Partial<ScheduledPaymentInput> & Record<string, unknown>
): Promise<ScheduledPayment> {
  const supabase = await createSupabaseServerClient()
  let record: Record<string, unknown> = { ...pickWritableFields(input), user_id: userId }

  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const { data, error } = await supabase
      .from('scheduled_payments')
      .insert([record])
      .select()
      .single()

    if (!error) return data as unknown as ScheduledPayment

    const missing = OPTIONAL_COLUMNS.find(col => col in record && isMissingColumnError(error.message, col))
    if (!missing) throw new Error(error.message)

    record = { ...record }
    delete record[missing]
  }

  throw new Error('固定費を保存できませんでした')
}

export async function updateScheduledPayment(
  userId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<ScheduledPayment> {
  const supabase = await createSupabaseServerClient()
  let record: Record<string, unknown> = pickWritableFields(patch)

  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const { data, error } = await supabase
      .from('scheduled_payments')
      .update(record)
      .eq('user_id', userId)
      .eq('id', id)
      .select()
      .single()

    if (!error) return data as unknown as ScheduledPayment

    const missing = OPTIONAL_COLUMNS.find(col => col in record && isMissingColumnError(error.message, col))
    if (!missing) throw new Error(error.message)

    record = { ...record }
    delete record[missing]
  }

  throw new Error('固定費を更新できませんでした')
}

export async function deleteScheduledPayment(userId: string, id: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('scheduled_payments')
    .delete()
    .eq('user_id', userId)
    .eq('id', id)

  if (error) throw new Error(error.message)
}

/** 同名の固定費が既にあるか(テンプレート一括登録を冪等にするため) */
export async function findExistingNames(userId: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('scheduled_payments')
    .select('name')
    .eq('user_id', userId)
    .in('name', names)

  if (error) throw new Error(error.message)
  return new Set((data ?? []).map(row => row.name as string))
}
