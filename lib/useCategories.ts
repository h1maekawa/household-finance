'use client'
import useSWR from 'swr'
import { CATEGORIES, INCOME_CATEGORIES, Category } from '@/types/transaction'

const fetcher = (url: string) => fetch(url).then(r => r.json())

/**
 * 既定カテゴリ + チャットボット等で追加したカスタムカテゴリのマージ済み一覧。
 * 取得完了まで(または未ログイン時)は既定カテゴリでフォールバックする。
 */
export function useCategories() {
  const { data, mutate } = useSWR<{ expense: Category[]; income: Category[] }>('/api/categories', fetcher)

  const expense: readonly Category[] = Array.isArray(data?.expense) ? data.expense : CATEGORIES
  const income: readonly Category[] = Array.isArray(data?.income) ? data.income : INCOME_CATEGORIES

  function iconOf(name: string): string {
    return (
      expense.find(c => c.name === name)?.icon ??
      income.find(c => c.name === name)?.icon ??
      '📦'
    )
  }

  return { expense, income, iconOf, mutate }
}
