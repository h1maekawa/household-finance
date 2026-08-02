'use client'
// ホーム — 今日なにを判断すればよいかだけを見る場所。
//
// 以前はここに今月の支出・AIコーチ・予算・目標・資産・負債・カテゴリ分析・
// 固定費/変動費・直近取引まで並べていて、家計簿・予定・資産のどのページとも
// 内容が重複していた。同じ数字が複数の画面に出ると「どれが本当か」が分からなくなる。
//
// 情報の「本来の居場所」を1つに決め、ホームには判断に要る分だけを置く:
//   取引履歴・カテゴリ分析 → 家計簿   (ホームは直近3件のみ)
//   固定費・カード請求     → 予定     (ホームは次の支払いのみ)
//   口座残高・投資詳細     → 資産     (ホームは合計と不足口座のみ)
//
// 数字は各APIが返す値をそのまま読むだけで、ここで新しい計算はしない。
import useSWR from 'swr'
import Link from 'next/link'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import CoachCard from '@/components/CoachCard'
import SignOutButton from '@/components/SignOutButton'
import CreditCardMonthlyPrompt from '@/components/CreditCardMonthlyPrompt'
import { fetcher } from '@/lib/fetcher'
import { useCategories } from '@/lib/useCategories'
import type { BudgetSummary } from '@/types/budget'
import type { CashflowResponse } from '@/types/cashflow'
import type { TransactionsResponse } from '@/types/transaction'

export default function HomePage() {
  const { iconOf } = useCategories()
  const now = new Date()

  const { data: budget } = useSWR<BudgetSummary>('/api/budget', fetcher)
  const { data: cashflow } = useSWR<CashflowResponse>('/api/cashflow', fetcher)
  const { data: transactionData } = useSWR<TransactionsResponse>(
    `/api/transactions?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    fetcher
  )

  const variable = budget?.variable
  const incomeMissing = (budget?.income.planned ?? 0) <= 0
  const reserved = (budget?.savings.target ?? 0) + (budget?.buffer ?? 0)
  const liquid = Number(cashflow?.currentBalance?.balance ?? 0)

  // 予測期間に出ていく額。projectCashflow が返した支払いを足すだけ
  const scheduledOutflow = (cashflow?.projectedDays ?? []).reduce(
    (sum, day) =>
      sum +
      day.payments
        .filter(payment => payment.type !== 'income')
        .reduce((daySum, payment) => daySum + payment.amount, 0),
    0
  )

  // 要対応: 残高がマイナスになる日と、請求から抜け落ちたカード利用
  const negativeDay = (cashflow?.projectedDays ?? []).find(day => day.isNegative)
  const unassigned = cashflow?.unassignedCardUsage
  const reviewCount = (transactionData?.transactions ?? []).filter(tx => tx.needs_review).length

  // 次の支払い: 締めサイクル単位で直近3件だけ
  const nextPayments = (cashflow?.cardCycles ?? []).slice(0, 3)
  const recentTransactions = (transactionData?.transactions ?? []).slice(0, 3)

  return (
    <div className="mx-auto max-w-xl">
      <CreditCardMonthlyPrompt />

      <div className="flex items-center justify-between px-4 pt-5">
        <div>
          <p className="text-lg font-bold leading-none">
            Flow<span className="text-muted">+</span>
          </p>
          <p className="mt-1 text-xs text-muted">{format(now, 'M月d日 EEEE', { locale: ja })}</p>
        </div>
        <SignOutButton />
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {/* 1. 今月あと使える金額 — この画面で一番大きい数字 */}
        <section className="card p-4">
          <p className="text-xs text-muted">今月あと使える金額</p>
          {!budget ? (
            <div className="skeleton mt-2 h-10 w-48 rounded" />
          ) : incomeMissing ? (
            <>
              <p className="mt-2 text-base font-bold">まだ計算できません</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                今月の手取り収入を登録すると、あといくら使えるかが出ます。
              </p>
              <Link href="/plan" className="mt-3 inline-block text-xs font-bold text-primary">
                収入を登録する ›
              </Link>
            </>
          ) : (
            <>
              <p className={`mt-1 text-4xl font-bold ${(variable?.remaining ?? 0) < 0 ? 'text-danger' : ''}`}>
                {(variable?.remaining ?? 0).toLocaleString()}
                <span className="ml-1 text-base font-normal">円</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                残り{variable?.daysLeft ?? 0}日・1日あたり約
                {(variable?.dailyAllowance ?? 0).toLocaleString()}円
              </p>
              {reserved > 0 && (
                <div className="mt-3 rounded-xl bg-surface px-3 py-2.5">
                  <p className="text-[11px] text-muted">貯金・予備費（今月使わずに残す）</p>
                  <p className="mt-0.5 text-sm font-bold">{reserved.toLocaleString()}円</p>
                </div>
              )}
            </>
          )}
        </section>

        {/* 2. 要対応 — 今すぐ手を打つべきこと */}
        {(negativeDay || (unassigned?.count ?? 0) > 0 || reviewCount > 0) && (
          <section className="card border border-danger/25 bg-danger/5 p-4">
            <h2 className="text-sm font-bold">要対応</h2>
            <div className="mt-2 flex flex-col gap-2.5">
              {negativeDay && (
                <ActionRow
                  href="/plan?tab=payments"
                  title={`${negativeDay.date.slice(5).replace('-', '月')}日に残高が不足します`}
                  detail={`${Math.abs(negativeDay.balance).toLocaleString()}円 足りません`}
                />
              )}
              {(unassigned?.count ?? 0) > 0 && (
                <ActionRow
                  href="/transactions"
                  title={`カード請求に含まれていない利用が${unassigned!.count}件`}
                  detail={`${unassigned!.total.toLocaleString()}円。実際の請求はこの分だけ多くなります`}
                />
              )}
              {reviewCount > 0 && (
                <ActionRow
                  href="/transactions"
                  title={`カテゴリ未確定の取引が${reviewCount}件`}
                  detail="確定すると使い道の内訳が正確になります"
                />
              )}
            </div>
          </section>
        )}

        {/* 3. 次の支払い — 詳細は「予定」が持つ */}
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">次の支払い</h2>
            <Link href="/plan?tab=payments" className="text-xs font-bold text-primary">
              すべて見る ›
            </Link>
          </div>
          {!cashflow ? (
            <div className="skeleton h-16 w-full rounded-xl" />
          ) : nextPayments.length === 0 ? (
            <p className="text-xs text-muted">予定されている支払いはありません。</p>
          ) : (
            <div className="flex flex-col gap-2">
              {nextPayments.map(cycle => (
                <div
                  key={`${cycle.cardId}-${cycle.paymentDate}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{cycle.paymentDate.slice(5).replace('-', '/')}</span>
                    <span className="ml-2">{cycle.cardName}</span>
                    <span className="ml-1.5 text-[10px] text-muted">
                      {cycle.confirmedAmount !== null ? '確定' : cycle.open ? '増加中' : '見込み'}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono font-bold text-danger">
                    {(cycle.confirmedAmount ?? cycle.amount).toLocaleString()}円
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. 今月の状況 — 数字の関係を1箇所で示す */}
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold">今月の状況</h2>
          <div className="flex flex-col gap-2 text-sm">
            <SummaryRow label="流動資産" amount={liquid} href="/investments" />
            <SummaryRow label="支払い予定" amount={-scheduledOutflow} href="/plan?tab=payments" />
            {reserved > 0 && <SummaryRow label="貯金・予備費" amount={-reserved} href="/plan" />}
            {!incomeMissing && (
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2.5">
                <span className="font-bold">今月あと使える金額</span>
                <span className={`font-mono font-bold ${(variable?.remaining ?? 0) < 0 ? 'text-danger' : 'text-success'}`}>
                  {(variable?.remaining ?? 0).toLocaleString()}円
                </span>
              </div>
            )}
          </div>
        </section>

        {/* 5. AIの一言 — 詳細な分析は各詳細画面が持つ */}
        <CoachCard />

        {/* 6. 直近の取引 — 一覧と分析は家計簿が持つ */}
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">直近の取引</h2>
            <Link href="/transactions" className="text-xs font-bold text-primary">
              家計簿を見る ›
            </Link>
          </div>
          {!transactionData ? (
            <div className="skeleton h-16 w-full rounded-xl" />
          ) : recentTransactions.length === 0 ? (
            <p className="text-xs text-muted">今月の取引はまだありません。</p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentTransactions.map(tx => (
                <div key={tx.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{tx.date.slice(5).replace('-', '/')}</span>
                    <span className="ml-2">{iconOf(tx.category)}</span>
                    <span className="ml-1">{tx.memo || tx.category}</span>
                  </span>
                  <span className={`shrink-0 font-mono ${tx.kind === 'income' ? 'text-success' : ''}`}>
                    {tx.kind === 'income' ? '+' : '-'}
                    {tx.amount.toLocaleString()}円
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ActionRow({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link href={href} className="block active:opacity-80">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </Link>
  )
}

function SummaryRow({ label, amount, href }: { label: string; amount: number; href: string }) {
  return (
    <Link href={href} className="flex items-baseline justify-between gap-3 active:opacity-80">
      <span className="text-muted">{label}</span>
      <span className="font-mono">
        {amount < 0 ? '-' : ''}
        {Math.abs(amount).toLocaleString()}円
      </span>
    </Link>
  )
}
