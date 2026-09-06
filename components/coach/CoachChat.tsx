'use client'
// AI Coach の対話。
//
// AIは金額を作らない。サーバー側で計算済みの結果だけを渡し、
// ここは送受信と表示に徹する。履歴はページ滞在中のstateのみ。
import { useState } from 'react'
import { Send } from 'lucide-react'
import { ICON_STROKE } from '@/lib/nav'

type Message = { role: 'user' | 'assistant'; text: string }

const QUICK_PROMPTS = [
  '今月使いすぎ？',
  '貯金目標は達成できる？',
  '固定費で気になるところは？',
  '今月注意する支払いは？',
]

export default function CoachChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const json = (await res.json()) as { answer?: string; error?: string }
      if (!res.ok || !json.answer) {
        setError(json.error ?? '回答を取得できませんでした')
        return
      }
      setMessages(prev => [...prev, { role: 'assistant', text: json.answer as string }])
    } catch {
      setError('通信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card p-4">
      <h2 className="text-[13px] font-bold">相談する</h2>
      <p className="mt-1 text-[11px] text-muted">
        Flow+ が計算した数字をもとに答えます。金額は計算結果のみを使います。
      </p>

      {messages.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map(prompt => (
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
            <li
              key={i}
              className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <span
                className={`max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3 py-2 text-[13px] leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-primary text-white'
                    : 'bg-surface text-foreground'
                }`}
              >
                {message.text}
              </span>
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
