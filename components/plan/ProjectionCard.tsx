'use client'
// 将来資産の予測。利回りを見込まない単純積立であることを必ず明示する。
// 金額は projection が出した値をそのまま表示し、ここで積み上げ直さない。
import { yen, NotAvailable } from '@/components/home/AmountBlock'
import type { AssetPlanningResult } from '@/lib/services/asset-planning'

export default function ProjectionCard({ plan }: { plan: AssetPlanningResult }) {
  if (plan.projection.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-bold">将来の資産</h2>
        <div className="mt-2.5">
          <NotAvailable
            hint="総資産が分からないため、まだ予測できません"
            href="/investments?tab=accounts"
            cta="口座残高を登録する"
          />
        </div>
      </section>
    )
  }

  const max = Math.max(...plan.projection.map(p => p.projectedAssets), 1)

  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold">将来の資産</h2>
      <p className="mt-1 text-[11px] text-muted">
        利回り0%の単純積立シミュレーションです。運用成果を示すものではありません。
      </p>

      <ul className="mt-3 space-y-2.5">
        {plan.projection.map(point => (
          <li key={point.years}>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px]">{point.years}年後</span>
              <span className="text-[15px] font-bold tabular-nums">
                {yen(point.projectedAssets)}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 rounded-full bg-border"
              role="img"
              aria-label={`${point.years}年後 ${yen(point.projectedAssets)}`}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(point.projectedAssets / max) * 100}%` }}
              />
            </div>
            <p className="mt-0.5 text-[10px] text-muted">うち積立 {yen(point.contributed)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
