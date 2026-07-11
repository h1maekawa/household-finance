'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/Toast'

type SettingsResponse = {
  profile: {
    initial_balance: number
    monthly_income: number
  }
}

function toNumberInput(value: number | undefined) {
  return value ? String(value) : ''
}

export default function SettingsPage() {
  const { showToast } = useToast()
  const [initialBalance, setInitialBalance] = useState('')
  const [monthlyIncome, setMonthlyIncome] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [billingActive, setBillingActive] = useState(false)
  const [billingRequired, setBillingRequired] = useState(false)
  const [newGasSecret, setNewGasSecret] = useState('')

  useEffect(() => {
    let mounted = true

    fetch('/api/settings')
      .then(res => res.json())
      .then((data: SettingsResponse) => {
        if (!mounted) return
        setInitialBalance(toNumberInput(data.profile?.initial_balance))
        setMonthlyIncome(toNumberInput(data.profile?.monthly_income))
      })
      .catch(() => showToast('設定の読み込みに失敗しました', 'error'))
      .finally(() => {
        if (mounted) setLoading(false)
      })

    fetch('/api/billing/status')
      .then(res => res.json())
      .then(data => {
        if (!mounted) return
        setBillingActive(Boolean(data.active))
        setBillingRequired(Boolean(data.billingRequired))
      })
      .catch(() => undefined)

    return () => { mounted = false }
  }, [showToast])

  async function handleSave() {
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
      showToast('設定を保存しました', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCheckout() {
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch (err) {
      showToast(err instanceof Error ? err.message : '購入画面を開けませんでした', 'error')
    }
  }

  async function handleCreateGasSecret() {
    try {
      const res = await fetch('/api/integrations/gas-secret', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewGasSecret(data.secret)
      showToast('GAS連携キーを発行しました', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'GAS連携キーを発行できませんでした', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 lg:max-w-3xl lg:px-0">
      <div className="mb-5">
        <h1 className="text-xl font-bold">設定</h1>
        <p className="mt-1 text-sm text-muted">初期残高や毎月の収入をあとから変更できます。</p>
      </div>

      <section className="card p-4">
        <h2 className="text-base font-bold">家計の初期値</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          残高はキャッシュフロー予測の起点として保存されます。
        </p>

        <div className="mt-4 grid gap-4">
          <MoneyInput
            label="現在の貯金残高"
            value={initialBalance}
            onChange={setInitialBalance}
            disabled={loading || saving}
          />
          <MoneyInput
            label="毎月の固定収入"
            value={monthlyIncome}
            onChange={setMonthlyIncome}
            disabled={loading || saving}
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={loading || saving}
          className="mt-5 w-full rounded-2xl bg-primary py-3 font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存する'}
        </button>
      </section>

      <section className="card mt-4 p-4">
        <h2 className="text-base font-bold">Pro機能</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Gmail自動取込や投資CSV取込などの高度な機能を使えます。
        </p>
        <div className="mt-4 rounded-xl bg-surface p-3">
          <p className="text-xs text-muted">現在の状態</p>
          <p className="mt-1 text-sm font-bold">{billingActive ? '購入済み' : billingRequired ? '未購入' : '開発中は無料開放'}</p>
        </div>
        {!billingActive && billingRequired && (
          <button
            type="button"
            onClick={handleCheckout}
            className="mt-4 w-full rounded-2xl bg-primary py-3 font-bold text-white transition-base active:opacity-80"
          >
            買い切りで購入する
          </button>
        )}
      </section>

      <section className="card mt-4 p-4">
        <h2 className="text-base font-bold">GAS連携キー</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Gmail取込用のキーです。発行後、この画面に一度だけ表示されます。
        </p>
        <button
          type="button"
          onClick={handleCreateGasSecret}
          className="mt-4 w-full rounded-2xl bg-primary py-3 font-bold text-white transition-base active:opacity-80"
        >
          新しい連携キーを発行する
        </button>
        {newGasSecret && (
          <div className="mt-4 rounded-xl bg-surface p-3">
            <p className="mb-1 text-xs text-muted">GAS_IMPORT_SECRET に設定</p>
            <p className="break-all font-mono text-xs">{newGasSecret}</p>
          </div>
        )}
      </section>
    </div>
  )
}

function MoneyInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      <span className="relative block">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-muted">¥</span>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface py-3 pl-8 pr-3.5 font-mono text-base focus:border-primary focus:bg-card focus:outline-none disabled:opacity-60"
        />
      </span>
    </label>
  )
}
