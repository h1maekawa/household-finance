// lib/repositories/accounts.ts
//
// 新規テーブルの Supabase アクセスはここに集約する(v3-architecture-review §3)。
// - RLS が効くユーザーセッションクライアントを使う(service_role を使わない)
// - user_id フィルタをリポジトリに閉じ込め、API 側の書き忘れ事故を構造的に防ぐ
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { yen } from '@/lib/services/money'

export type AccountRow = {
  id: string
  name: string
  type: 'bank' | 'emoney' | 'cash' | 'securities'
  institution: string | null
  is_primary: boolean
  display_order: number
}

export type AccountWithBalance = AccountRow & {
  balance: number
  recorded_at: string | null
}

export type AccountInput = {
  name: string
  type?: AccountRow['type']
  institution?: string | null
  is_primary?: boolean
  display_order?: number
  /** 指定すると初期残高スナップショットも記録する */
  balance?: number
}

export async function listAccounts(userId: string): Promise<AccountRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, type, institution, is_primary, display_order')
    .eq('user_id', userId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as AccountRow[]
}

/** 口座 + 最新残高。コーチの「どの口座にいくら残すか」の入力になる。 */
export async function listAccountsWithBalances(userId: string): Promise<AccountWithBalance[]> {
  const supabase = await createSupabaseServerClient()
  const accounts = await listAccounts(userId)
  if (accounts.length === 0) return []

  const { data, error } = await supabase
    .from('account_balances')
    .select('account_id, balance, recorded_at')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })

  if (error) throw new Error(error.message)

  // account_id ごとの最新1件だけ残す(降順で最初に現れたものが最新)
  const latest = new Map<string, { balance: number; recorded_at: string }>()
  for (const row of data ?? []) {
    if (latest.has(row.account_id)) continue
    latest.set(row.account_id, { balance: yen(row.balance), recorded_at: row.recorded_at })
  }

  return accounts.map(account => ({
    ...account,
    balance: latest.get(account.id)?.balance ?? 0,
    recorded_at: latest.get(account.id)?.recorded_at ?? null,
  }))
}

export async function createAccount(userId: string, input: AccountInput): Promise<AccountRow> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('accounts')
    .insert([{
      user_id: userId,
      name: input.name,
      type: input.type ?? 'bank',
      institution: input.institution ?? null,
      is_primary: input.is_primary ?? false,
      display_order: input.display_order ?? 0,
    }])
    .select('id, name, type, institution, is_primary, display_order')
    .single()

  if (error) throw new Error(error.message)

  if (input.balance !== undefined) {
    await recordBalance(userId, data.id, input.balance)
  }
  return data as AccountRow
}

export async function updateAccount(
  userId: string,
  accountId: string,
  patch: Partial<AccountInput>
): Promise<AccountRow> {
  const supabase = await createSupabaseServerClient()
  const { balance, ...rest } = patch
  const { data, error } = await supabase
    .from('accounts')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', accountId)
    .select('id, name, type, institution, is_primary, display_order')
    .single()

  if (error) throw new Error(error.message)

  if (balance !== undefined) {
    await recordBalance(userId, accountId, balance)
  }
  return data as AccountRow
}

export async function deleteAccount(userId: string, accountId: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('user_id', userId)
    .eq('id', accountId)

  if (error) throw new Error(error.message)
}

/** 残高は上書きせずスナップショットとして積む(時系列を壊さない) */
export async function recordBalance(
  userId: string,
  accountId: string,
  balance: number
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('account_balances')
    .insert([{ user_id: userId, account_id: accountId, balance: yen(balance) }])

  if (error) throw new Error(error.message)
}
