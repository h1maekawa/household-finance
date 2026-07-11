'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/Toast'
import { CATEGORIES } from '@/types/transaction'

type SettingsResponse = {
  profile: {
    initial_balance: number
    monthly_income: number
    income_day?: number | null
  }
}

type CreditCardSetting = {
  id: string
  name: string
  closing_day_int?: number | null
  payment_day_int?: number | null
  payment_month_offset?: number | null
}

type CategoryRule = {
  id: string
  merchant_pattern: string
  category: string
}

function toNumberInput(value: number | undefined) {
  return value ? String(value) : ''
}

export default function SettingsPage() {
  const { showToast } = useToast()
  const [initialBalance, setInitialBalance] = useState('')
  const [monthlyIncome, setMonthlyIncome] = useState('')
  const [incomeDay, setIncomeDay] = useState('25')
  const [creditCards, setCreditCards] = useState<CreditCardSetting[]>([])
  const [cardName, setCardName] = useState('')
  const [closingDay, setClosingDay] = useState('31')
  const [paymentDay, setPaymentDay] = useState('27')
  const [savingCard, setSavingCard] = useState(false)
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([])
  const [rulePattern, setRulePattern] = useState('')
  const [ruleCategory, setRuleCategory] = useState('その他')
  const [savingRule, setSavingRule] = useState(false)
  const [recategorizing, setRecategorizing] = useState(false)
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
        setIncomeDay(String(data.profile?.income_day ?? 25))
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

    fetch('/api/credit-cards')
      .then(res => res.json())
      .then((data: CreditCardSetting[]) => {
        if (mounted) setCreditCards(Array.isArray(data) ? data : [])
      })
      .catch(() => undefined)

    fetch('/api/category-rules')
      .then(res => res.json())
      .then((data: CategoryRule[]) => {
        if (mounted) setCategoryRules(Array.isArray(data) ? data : [])
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
          income_day: Number(incomeDay || 25),
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

  async function refreshCreditCards() {
    const res = await fetch('/api/credit-cards')
    const data = await res.json()
    if (res.ok) setCreditCards(Array.isArray(data) ? data : [])
  }

  async function handleAddCard() {
    setSavingCard(true)
    try {
      const res = await fetch('/api/credit-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cardName,
          closing_day_int: Number(closingDay || 31),
          payment_day_int: Number(paymentDay || 27),
          payment_month_offset: 1,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCardName('')
      setClosingDay('31')
      setPaymentDay('27')
      await refreshCreditCards()
      showToast('カード設定を追加しました', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'カード設定を保存できませんでした', 'error')
    } finally {
      setSavingCard(false)
    }
  }

  async function handleDeleteCard(id: string) {
    const res = await fetch(`/api/credit-cards/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await refreshCreditCards()
      showToast('カード設定を削除しました')
    } else {
      showToast('カード設定を削除できませんでした', 'error')
    }
  }

  async function refreshCategoryRules() {
    const res = await fetch('/api/category-rules')
    const data = await res.json()
    if (res.ok) setCategoryRules(Array.isArray(data) ? data : [])
  }

  async function handleAddRule() {
    setSavingRule(true)
    try {
      const res = await fetch('/api/category-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_pattern: rulePattern,
          category: ruleCategory,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRulePattern('')
      await refreshCategoryRules()
      showToast('分類ルールを追加しました', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '分類ルールを保存できませんでした', 'error')
    } finally {
      setSavingRule(false)
    }
  }

  async function handleDeleteRule(id: string) {
    const res = await fetch(`/api/category-rules/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await refreshCategoryRules()
      showToast('分類ルールを削除しました')
    } else {
      showToast('分類ルールを削除できませんでした', 'error')
    }
  }

  async function handleRecategorize() {
    setRecategorizing(true)
    try {
      const res = await fetch('/api/transactions/recategorize', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast(`${data.updated ?? 0}件を再分類しました`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '再分類できませんでした', 'error')
    } finally {
      setRecategorizing(false)
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
          <DayInput
            label="給料日"
            value={incomeDay}
            onChange={setIncomeDay}
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
        <h2 className="text-base font-bold">カード引き落とし設定</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          取引履歴の支払い方法名と同じ名前で登録すると、キャッシュフロー予測に請求見込みが自動で入ります。
        </p>

        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">カード名</span>
            <input
              type="text"
              value={cardName}
              onChange={e => setCardName(e.target.value)}
              placeholder="例：楽天カード、三井住友カード"
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <DayInput label="締め日" value={closingDay} onChange={setClosingDay} disabled={savingCard} />
            <DayInput label="引き落とし日" value={paymentDay} onChange={setPaymentDay} disabled={savingCard} />
          </div>
          <button
            type="button"
            onClick={handleAddCard}
            disabled={savingCard || !cardName.trim()}
            className="rounded-2xl bg-primary py-3 font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {savingCard ? '保存中...' : 'カード設定を追加'}
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {creditCards.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-muted">カード設定はまだありません</div>
          ) : (
            creditCards.map((card, index) => (
              <div
                key={card.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${index < creditCards.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div>
                  <p className="text-sm font-bold">{card.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {card.closing_day_int ?? 31}日締め / 翌月{card.payment_day_int ?? 27}日引き落とし
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteCard(card.id)}
                  className="shrink-0 text-xs font-bold text-danger"
                >
                  削除
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="card mt-4 p-4">
        <h2 className="text-base font-bold">分類ルール</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          店名や明細に含まれる文字を登録すると、今後の自動取込と過去取引の再分類に使われます。
        </p>

        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">含まれる文字</span>
            <input
              type="text"
              value={rulePattern}
              onChange={e => setRulePattern(e.target.value)}
              placeholder="例：楽天モバイル、ジブラルタ、ドトール"
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">カテゴリ</span>
            <select
              value={ruleCategory}
              onChange={e => setRuleCategory(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
            >
              {CATEGORIES.map(category => (
                <option key={category.name} value={category.name}>{category.icon} {category.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleAddRule}
              disabled={savingRule || !rulePattern.trim()}
              className="rounded-2xl bg-primary py-3 font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
            >
              {savingRule ? '保存中...' : 'ルール追加'}
            </button>
            <button
              type="button"
              onClick={handleRecategorize}
              disabled={recategorizing}
              className="rounded-2xl bg-surface py-3 font-bold text-foreground transition-base active:opacity-80 disabled:opacity-50"
            >
              {recategorizing ? '整理中...' : '過去分に反映'}
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {categoryRules.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-muted">追加した分類ルールはまだありません</div>
          ) : (
            categoryRules.map((rule, index) => (
              <div
                key={rule.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${index < categoryRules.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div>
                  <p className="text-sm font-bold">{rule.merchant_pattern}</p>
                  <p className="mt-0.5 text-xs text-muted">{rule.category}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteRule(rule.id)}
                  className="shrink-0 text-xs font-bold text-danger"
                >
                  削除
                </button>
              </div>
            ))
          )}
        </div>
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

function DayInput({
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
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface py-3 pl-3.5 pr-9 font-mono text-base focus:border-primary focus:bg-card focus:outline-none disabled:opacity-60"
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">日</span>
      </span>
    </label>
  )
}
