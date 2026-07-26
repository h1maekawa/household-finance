'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/Toast'
import { useCategories } from '@/lib/useCategories'
import { useAccounts } from '@/lib/useAccounts'
import GmailImportStatusCard from '@/components/GmailImportStatusCard'
import type { ScheduledPayment } from '@/types/cashflow'
import { CARD_PAYMENT_RULES, type CardPlan } from '@/lib/card-payment-rules'

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
  card_type?: string | null
  card_plan?: string | null
  bank_account?: string | null
}

function toNumberInput(value: number | undefined) {
  return value ? String(value) : ''
}

const SETTING_TABS = [
  { key: 'integrations', label: '連携・取込' },
  { key: 'categories', label: 'カテゴリ管理' },
  { key: 'assets', label: '資産・投資設定' },
  { key: 'cards', label: 'カード設定' },
  { key: 'display', label: '表示設定' },
  { key: 'account', label: 'アカウント' },
] as const

type SettingTab = typeof SETTING_TABS[number]['key']

const CARD_TYPES = [
  { value: 'generic', label: '手動設定' },
  { value: 'rakuten', label: '楽天カード' },
  { value: 'smbc', label: '三井住友カード' },
]

const CARD_PLANS = [
  { value: 'generic', label: '手動設定' },
  { value: 'rakuten_standard', label: '楽天カード 通常' },
  { value: 'rakuten_market', label: '楽天市場/ペイ/トラベル 暫定' },
  { value: 'smbc_10th', label: '三井住友 10日プラン' },
  { value: 'smbc_26th', label: '三井住友 26日プラン' },
]

/** 実際に請求計算へ適用される締め日・支払日を表示用に整形する */
function describeCardRule(card: CreditCardSetting) {
  const plan = (card.card_plan || 'generic') as CardPlan
  const rule = CARD_PAYMENT_RULES[plan]
  if (plan !== 'generic' && rule?.supported) {
    const closing = rule.closingDay === 'end_of_month' ? '月末' : `${rule.closingDay}日`
    const monthLabel = rule.paymentMonthOffset === 1 ? '翌月' : `${rule.paymentMonthOffset}ヶ月後`
    return `${closing}締め / ${monthLabel}${rule.paymentDay}日引き落とし`
  }
  const offset = card.payment_month_offset ?? 1
  const monthLabel = offset === 1 ? '翌月' : `${offset}ヶ月後`
  return `${card.closing_day_int ?? 31}日締め / ${monthLabel}${card.payment_day_int ?? 27}日引き落とし`
}

export default function SettingsPage() {
  const { expense: expenseCategories, mutate: refreshCategories } = useCategories()
  const { showToast } = useToast()
  const { accounts } = useAccounts()
  const [activeTab, setActiveTab] = useState<SettingTab>('integrations')
  const [initialBalance, setInitialBalance] = useState('')
  const [creditCards, setCreditCards] = useState<CreditCardSetting[]>([])
  const [cardName, setCardName] = useState('')
  const [closingDay, setClosingDay] = useState('31')
  const [paymentDay, setPaymentDay] = useState('27')
  const [cardType, setCardType] = useState('generic')
  const [cardPlan, setCardPlan] = useState('generic')
  const [cardBankAccount, setCardBankAccount] = useState('')
  const [savingCard, setSavingCard] = useState(false)
  const [recategorizing, setRecategorizing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [billingActive, setBillingActive] = useState(false)
  const [billingRequired, setBillingRequired] = useState(false)
  const [newGasSecret, setNewGasSecret] = useState('')
  const [scheduledPayments, setScheduledPayments] = useState<ScheduledPayment[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryIcon, setNewCategoryIcon] = useState('📦')
  const [savingCategory, setSavingCategory] = useState(false)

  useEffect(() => {
    let mounted = true

    fetch('/api/settings')
      .then(res => res.json())
      .then((data: SettingsResponse) => {
        if (!mounted) return
        setInitialBalance(toNumberInput(data.profile?.initial_balance))
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

    fetch('/api/scheduled-payments')
      .then(res => res.json())
      .then((data: ScheduledPayment[]) => {
        if (mounted) setScheduledPayments(Array.isArray(data) ? data : [])
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
        // 残高だけを送る。月収・給料日は固定収支ページが持つようになったので、
        // ここから送ると古い値で上書きしてしまう。
        body: JSON.stringify({ initial_balance: Number(initialBalance || 0) }),
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
          card_type: cardType,
          card_plan: cardPlan,
          debit_account_id: cardBankAccount || null,
          bank_account: accounts.find(a => a.id === cardBankAccount)?.name ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCardName('')
      setClosingDay('31')
      setPaymentDay('27')
      setCardType('generic')
      setCardPlan('generic')
      setCardBankAccount('')
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

  async function handleAddCategory() {
    setSavingCategory(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName, icon: newCategoryIcon, kind: 'expense' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewCategoryName('')
      setNewCategoryIcon('📦')
      await refreshCategories()
      showToast('カテゴリを追加しました', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'カテゴリを追加できませんでした', 'error')
    } finally {
      setSavingCategory(false)
    }
  }

  async function handleDeleteCategory(name: string) {
    const res = await fetch(`/api/categories?name=${encodeURIComponent(name)}&kind=expense`, { method: 'DELETE' })
    if (res.ok) {
      await refreshCategories()
      showToast('カテゴリを削除しました')
    } else {
      const data = await res.json()
      showToast(data.error ?? '既定カテゴリは削除できません', 'warning')
    }
  }

  async function handleRecategorize() {
    setRecategorizing(true)
    try {
      const res = await fetch('/api/transactions/recategorize', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast(`${data.updated ?? 0}件の補助情報を更新しました`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '補助情報を更新できませんでした', 'error')
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

  async function refreshScheduledPayments() {
    const res = await fetch('/api/scheduled-payments')
    const data = await res.json()
    if (res.ok) setScheduledPayments(Array.isArray(data) ? data : [])
  }

  /**
   * 引き落とし口座は debit_account_id(FK) が真実。bank_account(text) は
   * 既存データとの互換のため表示名を併せて書いておくだけ。
   */
  async function handlePaymentBankChange(payment: ScheduledPayment, accountId: string) {
    const account = accounts.find(a => a.id === accountId)
    const res = await fetch(`/api/scheduled-payments/${payment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        debit_account_id: accountId || null,
        bank_account: account?.name ?? null,
      }),
    })
    if (res.ok) {
      await refreshScheduledPayments()
      showToast('引き落とし口座を保存しました', 'success')
    } else {
      showToast('引き落とし口座を保存できませんでした', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 lg:max-w-3xl lg:px-0">
      <div className="mb-5">
        <h1 className="text-xl font-bold">設定</h1>
        <p className="mt-1 text-sm text-muted">連携、カード、カテゴリ、アカウント設定を管理できます。</p>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {SETTING_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition-base ${
              activeTab === tab.key ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'assets' && (
      <div className="flex flex-col gap-4">
      <section className="card p-4">
        <h2 className="text-base font-bold">家計の初期値</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          残高はキャッシュフロー予測の起点として保存されます。
          月収と給料日は<Link href="/fixed" className="font-medium text-primary">固定収支</Link>で設定します。
        </p>

        <div className="mt-4 grid gap-4">
          <MoneyInput
            label="現在の貯金残高"
            value={initialBalance}
            onChange={setInitialBalance}
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
      <section className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">固定費の引き落とし管理</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              固定費ごとに引き落とし日と利用口座を確認・設定できます。
            </p>
          </div>
          <Link href="/accounts" className="shrink-0 text-sm font-medium text-primary">
            口座管理
          </Link>
        </div>
        {accounts.length === 0 && (
          <p className="mt-2 text-xs text-warning">
            口座がまだ登録されていません。「口座管理」から登録すると引落口座を選べます。
          </p>
        )}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {scheduledPayments.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-muted">固定費の登録はまだありません</div>
          ) : (
            scheduledPayments.map((payment, index) => (
              <div
                key={payment.id}
                className={`grid gap-3 px-4 py-3 ${index < scheduledPayments.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{payment.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {payment.scheduled_date ?? `毎月${payment.due_day}日`} / {payment.amount.toLocaleString()}円
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-[11px] text-muted">{payment.category}</span>
                </div>
                <select
                  value={payment.debit_account_id ?? ''}
                  onChange={event => handlePaymentBankChange(payment, event.target.value)}
                  aria-label={`${payment.name}の引き落とし口座`}
                  className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm focus:border-primary focus:bg-card focus:outline-none"
                >
                  <option value="">口座未設定</option>
                  {accounts.map(account => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </div>
            ))
          )}
        </div>
      </section>
      </div>
      )}

      {activeTab === 'cards' && (
      <section className="card p-4">
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
          <div className="grid grid-cols-2 gap-3">
            <SelectInput
              label="カード種別"
              value={cardType}
              onChange={setCardType}
              options={CARD_TYPES}
              disabled={savingCard}
            />
            <SelectInput
              label="支払プラン"
              value={cardPlan}
              onChange={setCardPlan}
              options={CARD_PLANS}
              disabled={savingCard}
            />
          </div>
          <SelectInput
            label="引き落とし口座"
            value={cardBankAccount}
            onChange={setCardBankAccount}
            options={[
              { value: '', label: '口座未設定' },
              ...accounts.map(account => ({ value: account.id, label: account.name })),
            ]}
            disabled={savingCard}
          />
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
                    {describeCardRule(card)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {CARD_TYPES.find(item => item.value === (card.card_type ?? 'generic'))?.label ?? '手動設定'} / {CARD_PLANS.find(item => item.value === (card.card_plan ?? 'generic'))?.label ?? '手動設定'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">引き落とし口座: {card.bank_account || '未設定'}</p>
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
      )}

      {activeTab === 'categories' && (
      <section className="card p-4">
        <h2 className="text-base font-bold">カテゴリ管理</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          新しい支出は「未分類」で保存されます。取引一覧で分類すると、その選択が常に優先されます。
        </p>

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-[80px_1fr] gap-3">
            <input
              type="text"
              value={newCategoryIcon}
              onChange={e => setNewCategoryIcon(e.target.value)}
              aria-label="カテゴリのアイコン"
              maxLength={4}
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-center text-sm focus:border-primary focus:bg-card focus:outline-none"
            />
            <input
              type="text"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="例：ペット、教育費"
              maxLength={10}
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleAddCategory}
            disabled={savingCategory || !newCategoryName.trim()}
            className="rounded-2xl bg-primary py-3 font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {savingCategory ? '保存中...' : 'カテゴリを追加'}
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {expenseCategories.map((category, index) => (
              <div
                key={category.name}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${index < expenseCategories.length - 1 ? 'border-b border-border' : ''}`}
              >
                <p className="text-sm font-bold">{category.icon} {category.name}</p>
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(category.name)}
                  className="shrink-0 text-xs font-bold text-danger"
                >
                  削除
                </button>
              </div>
            ))}
        </div>
      </section>
      )}

      {activeTab === 'integrations' && (
      <div className="flex flex-col gap-4">
      <GmailImportStatusCard />

      <section className="card p-4">
        <h2 className="text-base font-bold">過去履歴の補助情報を更新</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          手動カテゴリは変更せず、カード発行会社と将来利用するカテゴリ候補だけを更新します。
        </p>
        <button
          type="button"
          onClick={handleRecategorize}
          disabled={recategorizing}
          className="mt-4 w-full rounded-2xl bg-primary py-3 font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
        >
          {recategorizing ? '更新中...' : '補助情報を更新'}
        </button>
      </section>

      <section className="card p-4">
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
      )}

      {activeTab === 'account' && (
      <section className="card p-4">
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
      )}

      {activeTab === 'display' && (
      <section className="card p-4">
        <h2 className="text-base font-bold">表示設定</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          通貨・日付形式・テーマ・グラフ初期表示は今後ここにまとめます。
        </p>
        <div className="mt-4 rounded-xl bg-surface p-3">
          <p className="text-xs text-muted">現在の表示</p>
          <p className="mt-1 text-sm font-bold">日本円 / 日本式日付 / ライトテーマ</p>
        </div>
      </section>
      )}
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

function SelectInput({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none disabled:opacity-60"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}
