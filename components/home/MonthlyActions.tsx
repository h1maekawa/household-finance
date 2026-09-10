'use client'
// 今月やること（スペック §7 Home 5 / §35 / §36）。
//
// **何を出すか・どの順で出すかはサーバー（action-planner.ts）が決める。**
// 以前はこの判断が Home の JSX に条件分岐として書かれていた。
// ここは受け取った一覧を並べるだけで、条件を足さない。
import useSWR from 'swr'
import Link from 'next/link'
import { ArrowRight, CircleAlert } from 'lucide-react'
import { fetcher } from '@/lib/fetcher'
import { ICON_STROKE } from '@/lib/nav'
import { HOME_ACTION_LIMIT, type MonthlyAction } from '@/lib/services/action-planner'

type ActionsResponse = { month: string; actions: MonthlyAction[] }

const TONE: Record<MonthlyAction['severity'], string> = {
  action: 'text-danger',
  warning: 'text-warning',
  info: 'text-primary',
}

export default function MonthlyActions({ limit = HOME_ACTION_LIMIT }: { limit?: number }) {
  const { data, isLoading } = useSWR<ActionsResponse>('/api/actions', fetcher)

  if (isLoading) {
    return (
      <section className="card p-4">
        <h2 className="text-[13px] font-bold">今月やること</h2>
        <div className="skeleton mt-2.5 h-16 w-full rounded-xl" />
      </section>
    )
  }

  const actions = (data?.actions ?? []).slice(0, limit)
  if (actions.length === 0) return null

  return (
    <section className="card p-4">
      <h2 className="text-[13px] font-bold">今月やること</h2>
      <ol className="mt-2.5 space-y-2.5">
        {actions.map(action => (
          <li key={action.id}>
            <Link
              href={action.href}
              className="flex items-start gap-2.5 transition-base active:opacity-80"
            >
              <CircleAlert
                size={16}
                strokeWidth={ICON_STROKE}
                className={`mt-0.5 shrink-0 ${TONE[action.severity]}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{action.title}</span>
                {action.detail && (
                  <span className="block text-[11px] leading-relaxed text-muted">
                    {action.detail}
                  </span>
                )}
              </span>
              <ArrowRight
                size={14}
                strokeWidth={ICON_STROKE}
                className="mt-1 shrink-0 text-muted"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
