'use client'
// components/CoachCard.tsx
// 「毎日開くと進捗と一言」の中心。今日の洞察を1本だけ大きく見せ、残りは折りたたむ。
// 文言・金額は全て API(決定的エンジン)が出したものをそのまま表示する。
import { useState } from 'react'
import useSWR from 'swr'
import type { CoachInsightRow } from '@/types/coach'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SEVERITY_STYLE: Record<CoachInsightRow['severity'], { badge: string; ring: string; label: string }> = {
  action: { badge: 'bg-danger/10 text-danger', ring: 'border-danger/30', label: '要対応' },
  warning: { badge: 'bg-warning/10 text-warning', ring: 'border-warning/30', label: '注意' },
  info: { badge: 'bg-primary/10 text-primary', ring: 'border-primary/20', label: 'お知らせ' },
}

export default function CoachCard() {
  const { data } = useSWR<{ insights: CoachInsightRow[] }>('/api/coach/insights', fetcher)
  const [expanded, setExpanded] = useState(false)

  const insights = data?.insights ?? []
  if (!data) {
    return <div className="card p-4"><div className="skeleton h-20 w-full rounded-xl" /></div>
  }
  if (insights.length === 0) return null

  const [primary, ...rest] = insights
  const style = SEVERITY_STYLE[primary.severity]

  return (
    <div className={`card border ${style.ring} p-4`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">🤖</span>
        <p className="text-sm font-bold">今日のひとこと</p>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>
          {style.label}
        </span>
      </div>

      <p className="text-[15px] font-bold leading-relaxed">{primary.title}</p>
      {primary.body && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{primary.body}</p>
      )}

      {rest.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="mt-3 text-xs font-bold text-primary"
          >
            {expanded ? '閉じる' : `ほか ${rest.length}件のお知らせ`}
          </button>
          {expanded && (
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
              {rest.map(insight => {
                const s = SEVERITY_STYLE[insight.severity]
                return (
                  <div key={insight.id} className="flex items-start gap-2">
                    <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${s.badge}`}>
                      {s.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{insight.title}</p>
                      {insight.body && <p className="text-xs text-muted">{insight.body}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
