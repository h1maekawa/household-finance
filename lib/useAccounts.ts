'use client'
import useSWR from 'swr'
import type { AccountWithBalance } from '@/lib/repositories/accounts'

const fetcher = (url: string) => fetch(url).then(r => r.json())

/**
 * 口座マスタ + 最新残高。
 *
 * 引き落とし口座の select や資産合計はここを唯一の供給源にする。
 * (以前は app/settings/page.tsx に銀行名がハードコードされていた)
 *
 * migration 018 が未適用なら API がエラーを返すので、空配列にフォールバックして
 * 「口座がまだ無い」状態として扱う。画面ごと落とさない。
 */
export function useAccounts() {
  const { data, error, isLoading, mutate } = useSWR<AccountWithBalance[] | { error: string }>(
    '/api/accounts',
    fetcher
  )

  const accounts: AccountWithBalance[] = Array.isArray(data) ? data : []
  const total = accounts.reduce((sum, account) => sum + account.balance, 0)

  return {
    accounts,
    total,
    isLoading,
    /** 口座テーブルが無い / 取得に失敗した */
    unavailable: Boolean(error) || (data !== undefined && !Array.isArray(data)),
    mutate,
  }
}

export const ACCOUNT_TYPE_LABELS: Record<AccountWithBalance['type'], string> = {
  bank: '銀行',
  emoney: '電子マネー',
  cash: '現金',
  securities: '証券',
}
