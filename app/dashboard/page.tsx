'use client'
// app/dashboard/page.tsx
//
// ホーム。役割は「今日・今月のお金について何を判断すべきか」。
//
// 数字はすべて API(決定的エンジン)が出した値をそのまま読む。
// ここで income - fixed のような金融計算をしない。UI がやってよいのは
// 整形・並び順・割合表示・座標変換まで。
//
// 情報の優先順:
//   今月あと使える → 配分 → 総資産 → 今やること → 目標 → コーチ
import useSWR from 'swr'
import Link from 'next/link'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { ArrowRight, CircleAlert, Landmark, Target } from 'lucide-react'
import AccountMenu from '@/components/AccountMenu'
import CoachCard from '@/components/CoachCard'
import CreditCardMonthlyPrompt from '@/components/CreditCardMonthlyPrompt'
import MoneyFlow from '@/components/MoneyFlow'
import SpendingPace from '@/components/home/SpendingPace'
import { NotAvailable, Skeleton, StatCard, yen } from '@/components/home/AmountBlock'
import { fetcher } from '@/lib/fetcher'
import { ICON_STROKE } from '@/lib/nav'
import type { AssetPlanningResult } from '@/lib/services/asset-planning'
import type { AssetSummary } from '@/lib/services/asset-summary-loader'
import type { CashflowResponse } from '@/types/cashflow'
import type { TransactionsResponse } from '@/types/transaction'

type PlanResponse = AssetPlanningResult & { assets: AssetSummary }

export default function HomePage() {
  const now = new Date()

  const { data: plan, error: planError } = useSWR<PlanResponse>('/api/asset-planning', fetcher)
  const { data: cashflow } = useSWR<CashflowResponse>('/api/cashflow', fetcher)
  const { data: transactionData } = useSWR<TransactionsResponse>(
    `/api/transactions?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    fetcher
  )

  const loading = !plan && !planError
  const cashflowRows = cashflow?.projectedDays ?? []
  const negativeDay = cashflowRows.find(day => day.isNegative)
  const unassigned = cashflow?.unassignedCardUsage
  const reviewCount = (transactionData?.transactions ?? []).filter(tx => tx.needs_review).length
  const goal = plan?.goals[0]
  const emergency = plan?.emergencyFund

  return (
    <div className="mx-auto max-w-xl">
      <CreditCardMonthlyPrompt />

      <header className="flex items-center justify-between px-4 pt-5">
        <div>
          <p className="text-lg font-bold leading-none">
            Flow<span className="text-primary">+</span>
          </p>
          <p className="mt-1 text-[12px] text-muted">
            {format(now, 'M月d日 EEEE', { locale: ja })}
          </p>
        </div>
        <div className="hidden lg:block">
          <AccountMenu />
        </div>
      </header>

      <div className="space-y-3 p-4">
        {/* 今月あと使える。ホームで最初に見る数字 */}
        <section className="card p-5">
          <p className="text-[12px] text-muted">今月あと使える</p>
          {loading ? (
            <Skeleton className="mt-2 h-10 w-48" />
          ) : planError ? (
            <ErrorState />
          ) : (
            <>
              <p className="mt-0.5 text-[36px] font-bold tabular-nums leading-tight">
                {yen(plan!.cashflow.freeToSpend)}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                残り{plan!.cashflow.daysLeft}日 ・ 1日あたり {yen(plan!.cashflow.dailyAllowance)}
              </p>
              <div className="mt-4 border-t border-border pt-3">
                <SpendingPace pace={plan!.cashflow.pace} />
              </div>
            </>
          )}
        </section>

        {/* 配分。「余力」ではなく「今月いくらをどこへ充てるか」 */}
        <section className="grid grid-cols-2 gap-3">
          <StatCard label="貯金へ確保" amount={loading ? undefined : plan?.allocation.savings ?? null} href="/plan" />
          <StatCard
            label="資産形成へ配分"
            amount={loading ? undefined : plan?.allocation.assetBuilding ?? null}
            href="/plan"
          />
        </section>

        {/* 総資産 */}
        <Link href="/investments" className="card flex items-center gap-3 p-4 transition-base active:opacity-80">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Landmark size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted">総資産</p>
            {loading ? (
              <Skeleton className="mt-1 h-6 w-32" />
            ) : plan?.assets.totalAssets === null || plan?.assets.totalAssets === undefined ? (
              <p className="mt-0.5 text-[13px] text-muted">口座残高を登録すると計算できます</p>
            ) : (
              <p className="mt-0.5 text-[22px] font-bold tabular-nums leading-tight">
                {yen(plan.assets.totalAssets)}
              </p>
            )}
          </div>
          <ArrowRight size={16} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" aria-hidden />
        </Link>

        {/* 今月のお金の配分。Money Flow は既存コンポーネントを再利用 */}
        {plan && <MoneyFlow plan={plan.moneyPlan} />}

        {/* 今やること */}
        {(negativeDay ||
          emergency?.status === 'underfunded' ||
          (unassigned?.count ?? 0) > 0 ||
          reviewCount > 0 ||
          plan?.missingData.length) && (
          <section className="card p-4">
            <h2 className="text-[13px] font-bold">今やること</h2>
            <div className="mt-2.5 space-y-2.5">
              {negativeDay && (
                <ActionRow
                  href="/plan?tab=payments"
                  tone="danger"
                  title="残高が不足する見込みです"
                  detail={`${format(new Date(negativeDay.date), 'M月d日', { locale: ja })}に ${yen(negativeDay.balance)}`}
                />
              )}
              {emergency?.status === 'underfunded' && emergency.reserveGap! > 0 && (
                <ActionRow
                  href="/plan"
                  tone="warning"
                  title={`防衛資金があと ${yen(emergency.reserveGap!)} 必要です`}
                  detail={`現在 ${yen(emergency.currentReserve!)} / 目安 ${yen(emergency.requiredReserve!)}（生活費を安全側に見た目安）`}
                />
              )}
              {(unassigned?.count ?? 0) > 0 && (
                <ActionRow
                  href="/plan?tab=payments"
                  tone="warning"
                  title="カード請求に未割当の利用があります"
                  detail={`${unassigned!.count}件 ${yen(unassigned!.total)}`}
                />
              )}
              {reviewCount > 0 && (
                <ActionRow
                  href="/transactions"
                  tone="info"
                  title="カテゴリが未確定の取引があります"
                  detail={`${reviewCount}件`}
                />
              )}
              {plan?.missingData.map(item => (
                <ActionRow key={item} href="/settings" tone="info" title={item} detail="設定する" />
              ))}
            </div>
          </section>
        )}

        {/* 目標は主目標だけ。判定は goal-progress のものを表示するだけ */}
        {goal && (
          <Link href="/plan?tab=goals" className="card block p-4 transition-base active:opacity-80">
            <div className="flex items-center gap-2">
              <Target size={15} strokeWidth={ICON_STROKE} className="text-primary" aria-hidden />
              <h2 className="text-[13px] font-bold">{goal.title}</h2>
              <span className="ml-auto text-[11px] text-muted">{goal.statusLabel}</span>
            </div>
            <p className="mt-2 text-[12px] text-muted">
              残り {yen(goal.remainingAmount)}
              {goal.requiredMonthly !== null && ` ・ 毎月あと ${yen(goal.requiredMonthly)}`}
            </p>
            {goal.projectedAchievementMonth && (
              <p className="mt-0.5 text-[11px] text-muted">
                現在のペースでの達成予測 {goal.projectedAchievementMonth.replace('-', '年')}月
              </p>
            )}
          </Link>
        )}

        <CoachCard />
      </div>
    </div>
  )
}

function ErrorState() {
  return (
    <NotAvailable
      hint="データを取得できませんでした"
      href="/dashboard"
      cta="再読み込み"
    />
  )
}

function ActionRow({
  href,
  title,
  detail,
  tone,
}: {
  href: string
  title: string
  detail: string
  tone: 'danger' | 'warning' | 'info'
}) {
  const color =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-primary'
  return (
    <Link href={href} className="flex items-start gap-2.5 transition-base active:opacity-80">
      <CircleAlert size={16} strokeWidth={ICON_STROKE} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[11px] text-muted">{detail}</span>
      </span>
      <ArrowRight size={14} strokeWidth={ICON_STROKE} className="mt-1 shrink-0 text-muted" aria-hidden />
    </Link>
  )
}
