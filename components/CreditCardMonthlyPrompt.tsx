'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { CreditCardSetting } from '@/types/cashflow'
import { useToast } from '@/components/Toast'

import { fetcher } from '@/lib/fetcher'

const DEFAULT_CARDS = [
  { name: '楽天カード', paymentDay: 27, cardType: 'rakuten', cardPlan: 'rakuten_standard' },
  { name: '三井住友カード', paymentDay: 26, cardType: 'smbc', cardPlan: 'smbc_26th' },
]

function cardPayload(defaultCard: (typeof DEFAULT_CARDS)[number], paymentDay: number) {
  return {
    name: defaultCard.name,
    closing_day_int: 31,
    payment_day_int: paymentDay,
    payment_month_offset: 1,
    card_type: defaultCard.cardType,
    card_plan: defaultCard.cardPlan,
  }
}

function thisMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function shouldShowThisMonth() {
  const now = new Date()
  return now.getDate() <= 7
}

export default function CreditCardMonthlyPrompt() {
  const { showToast } = useToast()
  const { data: cards, mutate } = useSWR<CreditCardSetting[]>('/api/credit-cards', fetcher)
  const [saving, setSaving] = useState(false)
  const [monthKey] = useState(() => thisMonthKey())
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(`flow-credit-card-confirmed:${thisMonthKey()}`) === 'done'
  })
  const [paymentDays, setPaymentDays] = useState<Record<string, string>>({
    '楽天カード': '27',
    '三井住友カード': '26',
  })

  const storageKey = `flow-credit-card-confirmed:${monthKey}`
  const hasMissingCard = DEFAULT_CARDS.some(defaultCard => {
    const card = cards?.find(item => item.name === defaultCard.name)
    return !card || !card.payment_day_int || card.closing_day_int !== 31
  })
  const open = Boolean(cards && shouldShowThisMonth() && !dismissed && hasMissingCard)

  if (!open) return null

  function handleSkip() {
    window.localStorage.setItem(storageKey, 'done')
    setDismissed(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      for (const defaultCard of DEFAULT_CARDS) {
        const existing = cards?.find(card => card.name === defaultCard.name)
        const paymentDay = Number(paymentDays[defaultCard.name] || defaultCard.paymentDay)

        const res = await fetch(existing ? `/api/credit-cards/${existing.id}` : '/api/credit-cards', {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cardPayload(defaultCard, paymentDay)),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error)
        }
      }

      window.localStorage.setItem(storageKey, 'done')
      await mutate()
      setDismissed(true)
      showToast('カード引き落とし設定を保存しました', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
      role="presentation"
      onClick={handleSkip}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-4">
          <h2 className="text-base font-bold">今月のカード引き落とし確認</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            締め日は毎月月末として扱います。月初だけ確認しておくと、キャッシュフロー予測に反映されます。
          </p>
        </div>

        <div className="grid gap-3 px-4 py-4">
          {DEFAULT_CARDS.map(card => (
            <div key={card.name} className="rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-bold">{card.name}</p>
                <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-muted">月末締め</span>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">翌月の引き落とし日</span>
                <span className="relative block">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={paymentDays[card.name] ?? String(card.paymentDay)}
                    onChange={event => setPaymentDays(prev => ({ ...prev, [card.name]: event.target.value }))}
                    className="w-full rounded-xl border border-border bg-surface py-3 pl-3.5 pr-9 font-mono text-base focus:border-primary focus:bg-card focus:outline-none"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">日</span>
                </span>
              </label>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={handleSkip}
            disabled={saving}
            className="rounded-xl bg-surface py-3 text-sm font-bold text-foreground transition-base active:opacity-80 disabled:opacity-50"
          >
            あとで
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
