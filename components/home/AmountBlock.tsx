'use client'
// 金額表示の共通部品。
// null（まだ計算できない）と 0円（本当に0円）を混同しないための入口でもある。
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ICON_STROKE } from '@/lib/nav'

export const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`

/** 未計算・エラーを 0円 で代替しない */
export function NotAvailable({ hint, href, cta }: { hint: string; href?: string; cta?: string }) {
  return (
    <div className="rounded-[12px] bg-surface p-3">
      <p className="text-[12px] text-muted">{hint}</p>
      {href && cta && (
        <Link
          href={href}
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-primary"
        >
          {cta}
          <ArrowRight size={13} strokeWidth={ICON_STROKE} aria-hidden />
        </Link>
      )}
    </div>
  )
}

export function Skeleton({ className = 'h-8 w-40' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />
}

/** 見出し + 金額 + 補足の小カード */
export function StatCard({
  label,
  amount,
  note,
  href,
}: {
  label: string
  amount: number | null | undefined
  note?: string
  href?: string
}) {
  const body = (
    <>
      <p className="text-[12px] text-muted">{label}</p>
      {amount === undefined ? (
        <Skeleton className="mt-1.5 h-6 w-24" />
      ) : amount === null ? (
        <p className="mt-1 text-[13px] text-muted">まだ計算できません</p>
      ) : (
        <p className="mt-0.5 text-[22px] font-bold tabular-nums leading-tight">{yen(amount)}</p>
      )}
      {note && amount !== null && amount !== undefined && (
        <p className="mt-0.5 text-[11px] text-muted">{note}</p>
      )}
    </>
  )
  return href ? (
    <Link href={href} className="card block p-4 transition-base active:opacity-80">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  )
}
