'use client'
// カテゴリ別の支出分析。
//
// 金額と判定は expense-intelligence（サーバーの純関数）が出したものをそのまま表示する。
// 「削るべき」とは言わず「見直し候補」として、判断はユーザーに委ねる。
import useSWR from 'swr'
import { yen } from '@/components/home/AmountBlock'
import { fetcher } from '@/lib/fetcher'
import {
  REVIEW_REASON_LABEL,
  VALUE_TAG_LABEL,
  type CategoryExpense,
} from '@/lib/services/expense-intelligence'

type Response = { month: string; categories: CategoryExpense[] }

export default function CategoryAnalysis({ month }: { month?: string }) {
  const { data, error } = useSWR<Response>(
    `/api/expense-intelligence${month ? `?month=${month}` : ''}`,
    fetcher
  )

  if (error) {
    return (
      <section className="card p-4">
        <p className="text-[13px] text-muted">データを取得できませんでした</p>
      </section>
    )
  }
  if (!data) {
    return <div className="card p-4"><div className="skeleton h-48 w-full rounded-xl" /></div>
  }

  const spent = data.categories.filter(row => row.currentMonth > 0)
  const candidates = spent.filter(row => row.reviewCandidate)

  if (spent.length === 0) {
    return (
      <section className="card p-4">
        <p className="text-[13px] text-muted">まだ今月の支出がありません</p>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {candidates.length > 0 && (
        <section className="card p-4">
          <h2 className="text-[13px] font-bold">見直し候補</h2>
          <p className="mt-1 text-[11px] text-muted">
            普段と違う動きがあったカテゴリです。減らすかどうかはご自身で決めてください。
          </p>
          <ul className="mt-2.5 space-y-2">
            {candidates.map(row => (
              <li key={row.category} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-[13px]">{row.category}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {row.candidateReason.map(r => REVIEW_REASON_LABEL[r]).join(' / ')}
                  </span>
                </span>
                <span className="shrink-0 text-[14px] font-medium tabular-nums">
                  {yen(row.currentMonth)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h2 className="text-[13px] font-bold">カテゴリ別</h2>
        <ul className="mt-2.5 divide-y divide-border">
          {spent.map(row => (
            <li key={row.category} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-[13px]">{row.category}</span>
                  {row.valueTag && (
                    <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">
                      {VALUE_TAG_LABEL[row.valueTag]}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[15px] font-bold tabular-nums">
                  {yen(row.currentMonth)}
                </span>
              </div>
              <dl className="mt-1 grid grid-cols-4 gap-1 text-[10px] text-muted">
                <div>
                  <dt>先月</dt>
                  <dd className="tabular-nums">{yen(row.previousMonth)}</dd>
                </div>
                <div>
                  <dt>3ヶ月平均</dt>
                  <dd className="tabular-nums">{yen(row.threeMonthAverage)}</dd>
                </div>
                <div>
                  <dt>予算</dt>
                  <dd className="tabular-nums">
                    {row.budget === null ? '未設定' : yen(row.budget)}
                  </dd>
                </div>
                <div>
                  <dt>年間換算</dt>
                  <dd className="tabular-nums">{yen(row.annualized)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
