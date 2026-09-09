'use client'
// 総資産とその内訳。
//
// 金額は asset-summary-loader が出した値をそのまま表示する。Home と Assets で
// 総資産の計算式を別に持たないための共通カード。
//
// Debt を引いていないので「総資産」と呼び、純資産 / Net Worth とは呼ばない。
import useSWR from 'swr'
import { NotAvailable, Skeleton, yen } from '@/components/home/AmountBlock'
import { fetcher } from '@/lib/fetcher'
import type { AssetSummary } from '@/lib/services/asset-summary-loader'
import type { AssetPlanningResult } from '@/lib/services/asset-planning'

type PlanResponse = AssetPlanningResult & { assets: AssetSummary }

const BAR_COLOR = ['bg-primary', 'bg-success', 'bg-warning', 'bg-muted']

export default function TotalAssetsCard() {
  const { data, error } = useSWR<PlanResponse>('/api/asset-planning', fetcher)
  const assets = data?.assets

  if (error) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-bold">総資産</h2>
        <div className="mt-2.5">
          <NotAvailable hint="データを取得できませんでした" />
        </div>
      </section>
    )
  }

  if (!assets) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-bold">総資産</h2>
        <Skeleton className="mt-2 h-9 w-48" />
      </section>
    )
  }

  const rows = [
    { label: '現金・預金', amount: assets.liquidCash },
    { label: '株式', amount: assets.stockValue },
    { label: '投資信託', amount: assets.fundValue },
    { label: 'その他', amount: assets.otherAssets },
  ]
  const total = assets.totalAssets

  return (
    <section className="card p-4">
      <h2 className="text-[12px] text-muted">総資産</h2>
      {total === null ? (
        <div className="mt-2">
          <NotAvailable
            hint="口座残高が未登録のため、総資産をまだ計算できません"
            href="/investments?tab=accounts"
            cta="口座残高を登録する"
          />
        </div>
      ) : (
        <p className="mt-0.5 text-[32px] font-bold tabular-nums leading-tight">{yen(total)}</p>
      )}

      {/* 割合は棒で示すが、意味は必ず金額一覧でも伝える */}
      {total !== null && total > 0 && (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-border" aria-hidden>
          {rows.map((row, i) => (
            <span
              key={row.label}
              className={BAR_COLOR[i]}
              style={{ width: `${((row.amount ?? 0) / total) * 100}%` }}
            />
          ))}
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {rows.map((row, i) => (
          <li key={row.label} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className={`size-2 shrink-0 rounded-full ${BAR_COLOR[i]}`} aria-hidden />
              {row.label}
            </span>
            <span className="shrink-0 text-[14px] font-medium tabular-nums">
              {row.amount === null ? (
                <span className="text-[12px] font-normal text-muted">未登録</span>
              ) : (
                yen(row.amount)
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
