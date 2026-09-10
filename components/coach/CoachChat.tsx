'use client'
// AI FP の対話（スペック §32 / §33）。
//
// AIは金額を作らない。サーバーが決定論で計算した結果を渡し、AIはそれを
// 説明するだけ。条件比較の数字は **AIの文章ではなくサーバーの値** を出す。
import { useState } from 'react'
import useSWR from 'swr'
import { Send } from 'lucide-react'
import { fetcher } from '@/lib/fetcher'
import { ICON_STROKE } from '@/lib/nav'
import { yen } from '@/components/home/AmountBlock'
import { QUICK_QUESTIONS, expenseCutQuestion } from '@/lib/services/ai-fp-intent'
import { formatMonthsDuration, type ScenarioComparison } from '@/lib/services/scenario-engine'
import type { CategoryExpense } from '@/lib/services/expense-intelligence'

type ScenarioResult = {
  label: string
  targetAssets: number | null
  comparison: ScenarioComparison
}

type Message = {
  role: 'user' | 'assistant'
  text: string
  scenario?: ScenarioResult | null
}

const duration = (months: number | null): string =>
  months === null ? '到達せず' : formatMonthsDuration(months)

export default function CoachChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 「◯◯を半分にしたら？」のカテゴリはユーザーの実データから取る。
  // システムが「タバコ」等を決め打ちしない
  const { data: intelligence } = useSWR<{ categories: CategoryExpense[] }>(
    '/api/expense-intelligence',
    fetcher
  )
  const cutTarget = (intelligence?.categories ?? []).find(
    category => category.reviewCandidate && category.currentMonth > 0
  )
  const prompts = [
    ...QUICK_QUESTIONS,
    ...(cutTarget ? [expenseCutQuestion(cutTarget.category)] : []),
  ]

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || sending) return

    setMessages(prev => [...prev, { role: 'user', text: trimmed }])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      })
      const json = (await res.json()) as {
        answer?: string
        scenario?: ScenarioResult | null
        error?: string
      }
      if (!res.ok || !json.answer) {
        setError(json.error ?? '回答を取得できませんでした')
        return
      }
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: json.answer as string, scenario: json.scenario ?? null },
      ])
    } catch {
      setError('通信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card p-4">
      <h2 className="text-[13px] font-bold">相談する</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Flow+ が計算した数字をもとに答えます。条件を変えた場合の比較も計算します。
        利回りは想定で、運用成果を示すものではありません。
      </p>

      {messages.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {prompts.map(prompt => (
            <button
              key={prompt}
              type="button"
              onClick={() => ask(prompt)}
              disabled={sending}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] transition-base active:opacity-70 disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {messages.map((message, i) => (
            <li key={i}>
              <div className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <span
                  className={`max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3 py-2 text-[13px] leading-relaxed ${
                    message.role === 'user' ? 'bg-primary text-white' : 'bg-surface text-foreground'
                  }`}
                >
                  {message.text}
                </span>
              </div>
              {message.scenario && <ScenarioResultCard scenario={message.scenario} />}
            </li>
          ))}
          {sending && (
            <li className="flex justify-start">
              <span className="skeleton h-9 w-40 rounded-[14px]" />
            </li>
          )}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2.5 rounded-[10px] bg-danger/10 p-2.5 text-[12px] text-danger">
          {error}
        </p>
      )}

      <form
        onSubmit={e => {
          e.preventDefault()
          ask(input)
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="お金について質問する"
          aria-label="質問"
          className="min-w-0 flex-1 rounded-[12px] border border-border bg-card px-3 py-2.5 text-[13px] outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="送信"
          className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-primary text-white transition-base active:opacity-80 disabled:opacity-40"
        >
          <Send size={17} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </form>
    </section>
  )
}

/**
 * 条件比較の数字。**AIの文章ではなくサーバーが計算した値** を出す。
 * AIが金額を言い違えても、ここの数字は決定論のまま残る。
 */
function ScenarioResultCard({ scenario }: { scenario: ScenarioResult }) {
  const { baseline, adjusted, monthsSaved } = scenario.comparison

  return (
    <div className="ml-0 mt-2 rounded-[14px] border border-border p-3">
      <p className="text-[11px] leading-relaxed text-muted">{scenario.label}</p>
      {scenario.targetAssets !== null && (
        <p className="mt-0.5 text-[11px] text-muted">目標 {yen(scenario.targetAssets)}</p>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface px-3 py-2.5">
          <p className="text-[10px] text-muted">現在のペース</p>
          <p className="mt-0.5 text-[12px] tabular-nums">
            {baseline.monthlyContribution === null
              ? '—'
              : `毎月 ${yen(baseline.monthlyContribution)}`}
          </p>
          <p className="mt-1 text-[14px] font-bold tabular-nums">
            {duration(baseline.monthsToTarget)}
          </p>
        </div>
        <div className="rounded-xl bg-primary/5 px-3 py-2.5">
          <p className="text-[10px] text-muted">変更後</p>
          <p className="mt-0.5 text-[12px] tabular-nums">
            {adjusted.monthlyContribution === null
              ? '—'
              : `毎月 ${yen(adjusted.monthlyContribution)}`}
          </p>
          <p className="mt-1 text-[14px] font-bold tabular-nums">
            {duration(adjusted.monthsToTarget)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {monthsSaved === null
          ? '片方が到達しないため、短縮期間は出せません'
          : monthsSaved <= 0
            ? '到達時期は変わりません'
            : `${duration(monthsSaved)}早くなる想定です`}
        {' ・ '}
        想定利回り {Number((scenario.comparison.annualReturnRate * 100).toFixed(3))}%
      </p>
    </div>
  )
}
