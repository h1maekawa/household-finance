'use client'
// components/FixedIncomeCard.tsx
// 固定収入(月収・給料日)。以前は設定の「家計の初期値」に、現在残高と一緒に置かれていた。
// 残高はキャッシュフローの起点、月収は毎月の設計値で性質が違うため、固定収支ページへ移した。
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import { useToast } from '@/components/Toast'

type SettingsResponse = {
  profile: {
    initial_balance: number
    monthly_income: number
    income_day?: number | null
  }
}

export default function FixedIncomeCard() {
  const { data, mutate, isLoading } = useSWR<SettingsResponse>('/api/settings', fetcher)
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  // 未編集なら null のままにし、表示値はサーバーの値から導出する。
  // useEffect で setState して同期すると、取得のたびに再レンダリングが連鎖する。
  const [incomeDraft, setIncomeDraft] = useState<string | null>(null)
  const [dayDraft, setDayDraft] = useState<string | null>(null)

  const income = incomeDraft ?? String(data?.profile?.monthly_income ?? '')
  const day = dayDraft ?? String(data?.profile?.income_day ?? 25)

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // 残高は送らない(送ると残高スナップショットが積まれてしまう)
      body: JSON.stringify({ monthly_income: Number(income || 0), income_day: Number(day || 25) }),
    })
    setSaving(false)
    if (res.ok) { showToast('保存しました', 'success'); mutate() }
    else showToast('保存に失敗しました', 'error')
  }

  return (
    <section className="card p-4">
      <h2 className="text-base font-bold">固定収入</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        給与など、毎月ほぼ同じ額が入るもの。予算とキャッシュフロー予測の基準になります。
      </p>

      {isLoading ? (
        <div className="mt-4 skeleton h-24 w-full rounded-xl" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fixed-income" className="mb-1 block text-xs text-muted">月収（円）</label>
              <input
                id="fixed-income"
                type="number"
                inputMode="numeric"
                value={income}
                onChange={e => setIncomeDraft(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm font-bold focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="fixed-income-day" className="mb-1 block text-xs text-muted">給料日</label>
              <input
                id="fixed-income-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={day}
                onChange={e => setDayDraft(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="mt-4 w-full rounded-2xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </>
      )}
    </section>
  )
}
