'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { isSupabaseConfigured } from '@/lib/supabase'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'

const fixedCosts = [
  { name: '家賃', amount: '80,000', day: '毎月25日' },
  { name: '携帯', amount: '9,000', day: '毎月15日' },
  { name: 'サブスク', amount: '1,980', day: '毎月1日' },
]

const cards = [
  { name: '楽天カード', closing: '月末', payment: '翌月27日' },
  { name: '三井住友カード', closing: '月末', payment: '翌月26日' },
]

const isGoogleAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true'

export default function FlowSetupWizard() {
  const [step, setStep] = useState(0)
  const [initialBalance, setInitialBalance] = useState('800000')
  const [monthlyIncome, setMonthlyIncome] = useState('300000')
  const [saving, setSaving] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const nextPath = searchParams.get('next')

  useEffect(() => {
    if (!isSupabaseConfigured) return

    supabase.auth.getSession().then(({ data }) => {
      const hasSession = Boolean(data.session)
      setIsSignedIn(hasSession)
      if (!hasSession) return
      // proxy.ts が未ログインを理由にリダイレクトしてきた場合は、
      // ログイン後に元々アクセスしようとしていたページへ戻す。
      if (nextPath) {
        router.replace(nextPath)
        return
      }
    })
  }, [supabase, nextPath, router])

  async function handleGoogleLogin() {
    if (!isSupabaseConfigured || !isGoogleAuthEnabled) {
      showToast('Googleログインが未設定です。管理者による設定が必要です', 'warning')
      return
    }

    const redirectTo = new URL('/flow/setup', window.location.origin)
    if (nextPath) redirectTo.searchParams.set('next', nextPath)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.toString(),
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
      },
    })

    if (error) showToast('Googleログインを開始できませんでした', 'error')
  }

  return (
    <div className="min-h-svh bg-[#F4F6F9] px-5 py-10 text-[#1E2933] flex items-center justify-center">
      <div className="w-full max-w-[440px]">
        <Link href="/" className="mb-7 block text-center text-lg font-bold">
          Flow<span className="text-[#1476B3]">+</span>
        </Link>

        <div className="rounded-2xl border border-[#E6EAEF] bg-white px-6 py-8 shadow-[0_20px_40px_-28px_rgba(30,41,51,.16)] sm:px-[30px]">
          {step === 0 && (
            <LoginScreen
              onNext={handleGoogleLogin}
              onContinue={() => router.push('/dashboard')}
              googleEnabled={isGoogleAuthEnabled}
              isSignedIn={isSignedIn}
            />
          )}
          {step === 1 && <BalanceScreen balance={initialBalance} onBalanceChange={setInitialBalance} onNext={() => setStep(2)} />}
          {step === 2 && <IncomeScreen income={monthlyIncome} onIncomeChange={setMonthlyIncome} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && <FixedCostsScreen onBack={() => setStep(2)} onNext={() => setStep(4)} />}
          {step === 4 && (
            <CardCycleScreen
              onBack={() => setStep(3)}
              onNext={async () => {
                setSaving(true)
                try {
                  const res = await fetch('/api/settings', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      initial_balance: Number(initialBalance || 0),
                      monthly_income: Number(monthlyIncome || 0),
                    }),
                  })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error)
                  showToast('初期設定を保存しました', 'success')
                  setStep(5)
                } catch (err) {
                  showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error')
                } finally {
                  setSaving(false)
                }
              }}
              saving={saving}
            />
          )}
          {step === 5 && <DoneScreen balance={Number(initialBalance || 0)} income={Number(monthlyIncome || 0)} />}
        </div>
      </div>
    </div>
  )
}

function LoginScreen({
  onNext,
  onContinue,
  googleEnabled,
  isSignedIn,
}: {
  onNext: () => void
  onContinue: () => void
  googleEnabled: boolean
  isSignedIn: boolean
}) {
  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-[19px] font-bold">おかえりなさい</h1>
        <p className="mt-2 text-[12.5px] leading-7 text-[#8891A0]">
          Googleアカウントでログインして、<br />
          家計簿と資産運用をまとめて管理します。
        </p>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="flex w-full items-center justify-center gap-2.5 rounded-[10px] border border-[#E6EAEF] bg-white p-3 text-[13px] font-medium text-[#1E2933]"
      >
        <span className="h-4 w-4 rounded-full bg-[conic-gradient(#1476B3_0%_25%,#1FAE8C_25%_50%,#E2544B_50%_75%,#F0B429_75%_100%)]" />
        {googleEnabled ? 'Googleでログイン' : 'Googleログインは準備中'}
      </button>
      {isSignedIn && (
        <button
          type="button"
          onClick={onContinue}
          className="mt-3 w-full rounded-[10px] bg-[#1476B3] p-3 text-[13px] font-medium text-white"
        >
          ログイン中のアカウントでホームへ
        </button>
      )}
      <p className="mt-4 text-center text-[11px] leading-6 text-[#8891A0]">
        Gmail・カレンダーへの読み取り権限を使い、<br />
        カード利用通知メールから支出を自動記録します。<br />
        ログインしないと家計簿データにはアクセスできません。
      </p>
      <div className="mt-4 rounded-[12px] border border-[#F0B429]/30 bg-[#F0B429]/10 px-3.5 py-3 text-[11px] leading-6 text-[#6B5A1E]">
        <p className="font-bold">スマホでログインできない場合</p>
        <p className="mt-1">
          Gmail・LINE・ChatGPTなどのアプリ内ブラウザではGoogleログインがブロックされることがあります。
          URLをSafariまたはChromeで直接開いてからログインしてください。
        </p>
      </div>
    </div>
  )
}

function BalanceScreen({
  balance,
  onBalanceChange,
  onNext,
}: {
  balance: string
  onBalanceChange: (value: string) => void
  onNext: () => void
}) {
  return (
    <StepFrame step={1} title="今の貯金残高は？" description="ここを起点に、日々の残高を計算します。あとから修正できます。">
      <MoneyField label="現在の貯金残高" value={balance} onChange={onBalanceChange} />
      <StepNav onNext={onNext} />
    </StepFrame>
  )
}

function IncomeScreen({
  income,
  onIncomeChange,
  onBack,
  onNext,
}: {
  income: string
  onIncomeChange: (value: string) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <StepFrame step={2} title="毎月の固定収入は？" description="給与など、毎月ほぼ同じ額が入るものを入力します。">
      <MoneyField label="月収" value={income} onChange={onIncomeChange} />
      <StepNav onBack={onBack} onNext={onNext} />
    </StepFrame>
  )
}

function FixedCostsScreen({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <StepFrame step={3} title="毎月の固定費を登録" description="家賃やサブスクなど、金額と発生日が決まっているもの。">
      <div className="space-y-2.5">
        {fixedCosts.map(cost => (
          <div key={cost.name} className="grid grid-cols-[1fr_96px_70px_28px] items-center gap-2">
            <input className="rounded-[10px] border border-[#E6EAEF] bg-[#F0F3F7] px-3 py-2.5 text-[13px]" defaultValue={cost.name} />
            <input className="rounded-[10px] border border-[#E6EAEF] bg-[#F0F3F7] px-3 py-2.5 font-mono text-[13px]" defaultValue={cost.amount} />
            <div className="text-center font-mono text-xs text-[#8891A0]">{cost.day}</div>
            <button type="button" className="h-7 w-7 rounded-full bg-[#F0F3F7] text-sm text-[#8891A0]">×</button>
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 text-xs text-[#1476B3]">＋ 固定費を追加</button>
      <StepNav onBack={onBack} onNext={onNext} className="mt-5" />
    </StepFrame>
  )
}

function CardCycleScreen({ onBack, onNext, saving }: { onBack: () => void; onNext: () => void; saving: boolean }) {
  return (
    <StepFrame step={4} title="クレジットカードの締め日" description="請求予定額を自動計算するために使います。">
      <div className="space-y-3">
        {cards.map(card => (
          <div key={card.name} className="rounded-xl bg-[#F0F3F7] p-4">
            <p className="mb-2.5 text-[13px] font-medium">{card.name}</p>
            <div className="grid grid-cols-2 gap-2.5">
              <SmallField label="締め日" value={card.closing} />
              <SmallField label="引き落とし日" value={card.payment} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 text-xs text-[#1476B3]">＋ カードを追加</button>
      <StepNav onBack={onBack} onNext={onNext} nextLabel={saving ? '保存中...' : '設定を完了する'} className="mt-5" disabled={saving} />
    </StepFrame>
  )
}

function DoneScreen({ balance, income }: { balance: number; income: number }) {
  return (
    <div>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#E3F5F0]">
          <span className="h-2.5 w-5 -rotate-45 border-b-[2.5px] border-l-[2.5px] border-[#1FAE8C]" />
        </div>
        <h1 className="text-[19px] font-bold">設定が完了しました</h1>
        <p className="mb-5 mt-2 text-[12.5px] leading-7 text-[#8891A0]">
          ホーム画面から、今日あと使える金額を確認できます。
        </p>
      </div>
      <SummaryRow label="初期残高" value={`¥${balance.toLocaleString()}`} />
      <SummaryRow label="月収" value={`¥${income.toLocaleString()}`} />
      <SummaryRow label="固定費 3件" value="¥90,980 / 月" />
      <SummaryRow label="登録カード" value="2枚" />
      <div className="mt-5">
        <Link href="/dashboard" className="block w-full rounded-full bg-[#1476B3] px-5 py-3 text-center text-[13px] font-medium text-white">
          ホームへ進む
        </Link>
      </div>
    </div>
  )
}

function StepFrame({
  step,
  title,
  description,
  children,
}: {
  step: number
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-6 flex gap-1.5">
        {[1, 2, 3, 4].map(item => (
          <span key={item} className={`h-[3px] flex-1 rounded-sm ${item <= step ? 'bg-[#1476B3]' : 'bg-[#E6EAEF]'}`} />
        ))}
      </div>
      <p className="mb-1 font-mono text-[11px] text-[#8891A0]">STEP {step} / 4</p>
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="mb-6 mt-1.5 text-[12.5px] leading-7 text-[#8891A0]">{description}</p>
      {children}
    </div>
  )
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs text-[#8891A0]">{label}</span>
      <span className="relative block">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-[#8891A0]">¥</span>
        <input
          type="number"
          inputMode="numeric"
          className="w-full rounded-[10px] border border-[#E6EAEF] bg-[#F0F3F7] py-3 pl-8 pr-3.5 font-mono text-[15px] text-[#1E2933] focus:border-[#1476B3] focus:bg-white focus:outline-none"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </span>
    </label>
  )
}

function SmallField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[#8891A0]">{label}</span>
      <input className="w-full rounded-[10px] border border-[#E6EAEF] bg-white px-2.5 py-2 font-mono text-[13px]" defaultValue={value} />
    </label>
  )
}

function StepNav({
  onBack,
  onNext,
  nextLabel = '次へ',
  className = 'mt-2',
  disabled = false,
}: {
  onBack?: () => void
  onNext: () => void
  nextLabel?: string
  className?: string
  disabled?: boolean
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      {onBack ? (
        <button type="button" onClick={onBack} className="rounded-full px-5 py-3 text-[13px] font-medium text-[#8891A0]">
          戻る
        </button>
      ) : <span />}
      <button type="button" onClick={onNext} disabled={disabled} className="rounded-full bg-[#1476B3] px-5 py-3 text-[13px] font-medium text-white disabled:opacity-50">
        {nextLabel}
      </button>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-t border-[#E6EAEF] py-2.5 text-[12.5px] text-[#8891A0]">
      <span>{label}</span>
      <span className="font-mono text-[#1E2933]">{value}</span>
    </div>
  )
}
