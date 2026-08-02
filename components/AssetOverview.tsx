'use client'
// 「資産 → 資産全体」タブ。
//
// 総資産を「流動資産(すぐ動かせる)」と「投資資産(すぐには使えない)」に分けて出す。
// この2つを合算した数字だけを見ていると、支払いに使えないお金を
// 使えるものと錯覚するため、必ず分けて表示する。
//
// 数字は既存APIが返す値をそのまま使い、ここで新しい計算はしない。
import useSWR from 'swr'
import Link from 'next/link'
import { fetcher } from '@/lib/fetcher'
import { useAccounts } from '@/lib/useAccounts'

type AssetHistoryResponse = {
  current: { cash: number; investment: number; total: number }
}

export default function AssetOverview() {
  const { data: history } = useSWR<AssetHistoryResponse>('/api/assets/history?months=6', fetcher)
  const { data: investments } = useSWR('/api/investments', fetcher)
  const { accounts, total: accountTotal, isLoading } = useAccounts()

  const cash = Number(history?.current.cash ?? accountTotal ?? 0)
  const investment = Number(
    history?.current.investment ?? investments?.summary?.investmentValue ?? 0
  )
  const total = cash + investment
  const ratio = total > 0 ? Math.round((investment / total) * 100) : 0

  if (isLoading && !history) {
    return (
      <div className="card p-4">
        <div className="skeleton mb-3 h-10 w-48 rounded" />
        <div className="skeleton h-24 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <p className="text-xs text-muted">総資産</p>
        <p className="mt-1 text-3xl font-bold">
          {total.toLocaleString()}
          <span className="ml-1 text-base font-normal">円</span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface p-3">
            <p className="text-[11px] text-muted">流動資産</p>
            <p className="mt-1 text-lg font-bold text-success">{cash.toLocaleString()}円</p>
            <p className="mt-0.5 text-[11px] text-muted">支払いに使えるお金</p>
          </div>
          <div className="rounded-xl bg-surface p-3">
            <p className="text-[11px] text-muted">投資資産</p>
            <p className="mt-1 text-lg font-bold text-primary">{investment.toLocaleString()}円</p>
            <p className="mt-0.5 text-[11px] text-muted">すぐには使えないお金</p>
          </div>
        </div>

        {total > 0 && (
          <>
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-surface">
              <div className="bg-success" style={{ width: `${100 - ratio}%` }} />
              <div className="bg-primary" style={{ width: `${ratio}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-muted">投資比率 {ratio}%</p>
          </>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">お金の置き場所</h2>
          <Link href="/investments?tab=accounts" scroll={false} className="text-xs font-bold text-primary">
            口座を管理 ›
          </Link>
        </div>
        {accounts.length === 0 ? (
          <p className="text-xs text-muted">口座がまだ登録されていません。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {accounts.map(account => (
              <div key={account.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{account.name}</span>
                <span className="shrink-0 font-mono font-bold">
                  {account.balance.toLocaleString()}円
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
