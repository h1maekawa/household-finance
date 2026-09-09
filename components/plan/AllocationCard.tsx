'use client'
// 今月のお金の配分。4つは同じ原資を分けたもので、別々の財布ではない。
// 金額は asset-planning が出した値をそのまま表示する。
import { yen, NotAvailable } from '@/components/home/AmountBlock'
import type { AssetPlanningResult } from '@/lib/services/asset-planning'

const ROWS: { key: keyof AssetPlanningResult['allocation']; label: string; hint?: string }[] = [
  { key: 'emergencyFund', label: '防衛資金へ確保', hint: '手元の現金の振り替え' },
  { key: 'savings', label: '通常貯金へ配分' },
  { key: 'assetBuilding', label: '資産形成へ配分' },
  { key: 'unallocatedCash', label: '未配分余力' },
]

export default function AllocationCard({ plan }: { plan: AssetPlanningResult }) {
  if (plan.allocatableCash === null) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-bold">今月のお金の配分</h2>
        <div className="mt-2.5">
          <NotAvailable
            hint="口座残高が未登録のため、配分をまだ計算できません"
            href="/investments?tab=accounts"
            cta="口座残高を登録する"
          />
        </div>
      </section>
    )
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold">今月のお金の配分</h2>
      <div className="mt-3 flex items-baseline justify-between border-b border-border pb-2.5">
        <span className="text-[13px] text-muted">再配分できる現金</span>
        <span className="text-[17px] font-bold tabular-nums">{yen(plan.allocatableCash)}</span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {ROWS.map(row => (
          <li key={row.key} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-[13px]">
              {row.label}
              {row.hint && <span className="ml-1.5 text-[10px] text-muted">{row.hint}</span>}
            </span>
            <span className="shrink-0 text-[14px] font-medium tabular-nums">
              {yen(plan.allocation[row.key] ?? 0)}
            </span>
          </li>
        ))}
      </ul>
      {plan.monthlyAssetContribution !== null && (
        <p className="mt-3 border-t border-border pt-2.5 text-[11px] text-muted">
          毎月の積立は 通常貯金＋資産形成 の {yen(plan.monthlyAssetContribution)}。
          防衛資金は手元の現金を振り替えるものなので含めていません。
        </p>
      )}
    </section>
  )
}
