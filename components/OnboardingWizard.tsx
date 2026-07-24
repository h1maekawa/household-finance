'use client'
// components/OnboardingWizard.tsx
// スペック §3 Phase1: 重視点 → 目標 → 収入 → メイン口座 → 予算。
// 計算(毎月の積立額の逆算)はサーバー(/api/onboarding)が決定的に行う。
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import type { GoalKind } from '@/types/goal'

const PRIORITIES = ['将来の安心', '今の生活の充実', '子どもの教育', '早期リタイア(FIRE)', '住宅の購入']

const GOAL_KINDS: Array<{ kind: GoalKind; label: string; icon: string }> = [
  { kind: 'savings', label: '貯金', icon: '🏦' },
  { kind: 'house', label: '住宅', icon: '🏠' },
  { kind: 'car', label: '車', icon: '🚗' },
  { kind: 'education', label: '教育', icon: '🎓' },
  { kind: 'travel', label: '旅行', icon: '✈️' },
  { kind: 'fire', label: 'FIRE', icon: '🔥' },
]

const TOTAL_STEPS = 5

export default function OnboardingWizard() {
  const router = useRouter()
  const { showToast } = useToast()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  const [priorities, setPriorities] = useState<string[]>([])
  const [goalKind, setGoalKind] = useState<GoalKind>('savings')
  const [goalTitle, setGoalTitle] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [monthlyIncome, setMonthlyIncome] = useState('300000')
  const [incomeDay, setIncomeDay] = useState('25')
  const [accountName, setAccountName] = useState('メイン口座')
  const [accountBalance, setAccountBalance] = useState('')
  const [buffer, setBuffer] = useState('10000')
  const [investment, setInvestment] = useState('0')

  const monthlyEstimate = estimateMonthly(targetAmount, targetDate)

  function togglePriority(p: string) {
    setPriorities(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]))
  }

  async function submit() {
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: { priorities },
          income: { monthly_income: Number(monthlyIncome || 0), income_day: Number(incomeDay || 25) },
          primary_account: accountName.trim()
            ? { name: accountName.trim(), type: 'bank', balance: Number(accountBalance || 0) }
            : undefined,
          goal: goalTitle.trim()
            ? {
                kind: goalKind,
                title: goalTitle.trim(),
                target_amount: targetAmount ? Number(targetAmount) : null,
                target_date: targetDate || null,
              }
            : undefined,
          budget: { investment_target: Number(investment || 0), buffer: Number(buffer || 0) },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存に失敗しました')
      showToast('設定を保存しました', 'success')
      router.push('/dashboard')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="mb-6 flex gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-sm ${i < step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>
      <p className="mb-1 font-mono text-[11px] text-muted">STEP {step} / {TOTAL_STEPS}</p>

      {step === 1 && (
        <Frame title="何を大切にしたいですか？" desc="複数選べます。コーチの提案の優先度に反映します。">
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => togglePriority(p)}
                className={`rounded-full border px-3.5 py-2 text-sm ${
                  priorities.includes(p) ? 'border-primary bg-primary text-white' : 'border-border text-muted'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Frame>
      )}

      {step === 2 && (
        <Frame title="いちばんの目標は？" desc="まずは1つ。あとから追加・変更できます。">
          <div className="mb-3 grid grid-cols-3 gap-2">
            {GOAL_KINDS.map(g => (
              <button
                key={g.kind}
                type="button"
                onClick={() => { setGoalKind(g.kind); if (!goalTitle) setGoalTitle(g.label) }}
                className={`flex flex-col items-center gap-1 rounded-xl border py-3 text-xs ${
                  goalKind === g.kind ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <span className="text-xl">{g.icon}</span>
                {g.label}
              </button>
            ))}
          </div>
          <Field label="目標の名前">
            <input className={inputClass} value={goalTitle} onChange={e => setGoalTitle(e.target.value)} placeholder="住宅の頭金" />
          </Field>
          <Field label="目標額(円)">
            <input type="number" inputMode="numeric" className={inputClass} value={targetAmount} onChange={e => setTargetAmount(e.target.value)} placeholder="5000000" />
          </Field>
          <Field label="達成したい時期">
            <input type="date" className={inputClass} value={targetDate} onChange={e => setTargetDate(e.target.value)} />
          </Field>
          {monthlyEstimate !== null && (
            <p className="mt-1 rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">
              この目標なら毎月 <span className="font-bold">{monthlyEstimate.toLocaleString()}円</span> の積立が必要です。
            </p>
          )}
        </Frame>
      )}

      {step === 3 && (
        <Frame title="毎月の収入は？" desc="給与など、毎月ほぼ同じ額が入るもの。">
          <Field label="月収(円)">
            <input type="number" inputMode="numeric" className={inputClass} value={monthlyIncome} onChange={e => setMonthlyIncome(e.target.value)} />
          </Field>
          <Field label="給料日">
            <input type="number" inputMode="numeric" className={inputClass} value={incomeDay} onChange={e => setIncomeDay(e.target.value)} min={1} max={31} />
          </Field>
        </Frame>
      )}

      {step === 4 && (
        <Frame title="メインの口座" desc="引き落としの起点になる口座。1つでOKです。">
          <Field label="口座名">
            <input className={inputClass} value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="三井住友銀行" />
          </Field>
          <Field label="今の残高(円)">
            <input type="number" inputMode="numeric" className={inputClass} value={accountBalance} onChange={e => setAccountBalance(e.target.value)} placeholder="800000" />
          </Field>
        </Frame>
      )}

      {step === 5 && (
        <Frame title="毎月の先取り" desc="収入から先に確保する分。残りが変動費の枠になります。">
          <Field label="投資に回す額(円)">
            <input type="number" inputMode="numeric" className={inputClass} value={investment} onChange={e => setInvestment(e.target.value)} />
          </Field>
          <Field label="予備費(円)">
            <input type="number" inputMode="numeric" className={inputClass} value={buffer} onChange={e => setBuffer(e.target.value)} />
          </Field>
          <div className="mt-3 space-y-1 rounded-xl bg-surface p-3 text-xs text-muted">
            <SummaryRow label="月収" value={Number(monthlyIncome || 0)} />
            {monthlyEstimate !== null && <SummaryRow label="貯蓄(目標から逆算)" value={monthlyEstimate} sign="−" />}
            <SummaryRow label="投資" value={Number(investment || 0)} sign="−" />
            <SummaryRow label="予備費" value={Number(buffer || 0)} sign="−" />
            <p className="pt-1 text-[11px]">固定費を引いた残りが「今月あと使える額」になります。</p>
          </div>
        </Frame>
      )}

      <div className="mt-6 flex items-center justify-between">
        {step > 1 ? (
          <button type="button" onClick={() => setStep(s => s - 1)} className="px-4 py-2.5 text-sm text-muted">戻る</button>
        ) : <span />}
        {step < TOTAL_STEPS ? (
          <button type="button" onClick={() => setStep(s => s + 1)} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white">
            次へ
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={saving} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {saving ? '保存中…' : '設定を完了'}
          </button>
        )}
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-sm focus:border-primary focus:bg-card focus:outline-none'

function estimateMonthly(amount: string, date: string): number | null {
  const target = Number(amount)
  if (!target || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const now = new Date()
  const [y, m] = date.split('-').map(Number)
  const months = (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1)) + 1
  if (months <= 0) return null
  return Math.ceil(target / months)
}

function Frame({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="mb-5 mt-1.5 text-[13px] leading-6 text-muted">{desc}</p>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  )
}

function SummaryRow({ label, value, sign = '+' }: { label: string; value: number; sign?: '+' | '−' }) {
  return (
    <div className="flex justify-between">
      <span>{sign} {label}</span>
      <span className="font-mono">{value.toLocaleString()}円</span>
    </div>
  )
}
