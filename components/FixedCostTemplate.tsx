'use client'
import { useEffect, useState } from 'react'
import { FIXED_COST_TEMPLATES } from '@/lib/fixed-cost-templates'
import { useAccounts } from '@/lib/useAccounts'
import { useToast } from '@/components/Toast'

type Selection = {
  checked: boolean
  amount: number
  dueDay: number
  debitAccountId: string
}

/**
 * 初期設定の固定費テンプレート(要件書 §16)。
 * チェックした項目に金額・支払日・引落口座を入れて一括登録する。
 * 同名の固定費が既にあるものはサーバー側でスキップされる(二重登録の防止)。
 */
export default function FixedCostTemplate({
  onClose, onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { accounts } = useAccounts()
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  const [selections, setSelections] = useState<Record<string, Selection>>(() => {
    const initial: Record<string, Selection> = {}
    for (const group of FIXED_COST_TEMPLATES) {
      for (const item of group.items) {
        initial[item.name] = {
          checked: Boolean(item.defaultChecked),
          amount: 0,
          dueDay: item.defaultDueDay,
          debitAccountId: '',
        }
      }
    }
    return initial
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function update(name: string, patch: Partial<Selection>) {
    setSelections(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }

  const checkedCount = Object.values(selections).filter(s => s.checked).length

  async function handleSubmit() {
    setSaving(true)
    const items = Object.entries(selections)
      .filter(([, selection]) => selection.checked)
      .map(([name, selection]) => ({
        name,
        amount: selection.amount,
        due_day: selection.dueDay,
        debit_account_id: selection.debitAccountId || null,
      }))

    const res = await fetch('/api/scheduled-payments/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    setSaving(false)

    if (!res.ok) {
      showToast('登録に失敗しました', 'error')
      return
    }

    const result = await res.json() as { created: string[]; skipped: string[] }
    showToast(
      result.skipped.length > 0
        ? `${result.created.length}件を追加（${result.skipped.length}件は登録済みのためスキップ）`
        : `${result.created.length}件を追加しました`,
      'success'
    )
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <div>
            <h2 id="template-modal-title" className="text-base font-bold">固定費テンプレート</h2>
            <p className="mt-0.5 text-xs text-muted">契約しているものにチェックを入れてください</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {FIXED_COST_TEMPLATES.map(group => (
            <section key={group.key}>
              <h3 className="mb-2 text-sm font-bold">{group.label}</h3>
              <div className="flex flex-col gap-2">
                {group.items.map(item => {
                  const selection = selections[item.name]
                  return (
                    <div key={item.name} className="rounded-xl border border-border px-3 py-2.5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selection.checked}
                          onChange={e => update(item.name, { checked: e.target.checked })}
                          className="h-4 w-4 accent-[var(--primary)]"
                        />
                        {item.name}
                      </label>

                      {selection.checked && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            placeholder="金額"
                            value={selection.amount || ''}
                            onChange={e => update(item.name, { amount: parseInt(e.target.value) || 0 })}
                            aria-label={`${item.name}の金額`}
                            className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm focus:border-primary focus:bg-card focus:outline-none"
                          />
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={31}
                            value={selection.dueDay}
                            onChange={e => update(item.name, { dueDay: parseInt(e.target.value) || 1 })}
                            aria-label={`${item.name}の支払日`}
                            className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm focus:border-primary focus:bg-card focus:outline-none"
                          />
                          <select
                            value={selection.debitAccountId}
                            onChange={e => update(item.name, { debitAccountId: e.target.value })}
                            aria-label={`${item.name}の引落口座`}
                            className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-sm focus:border-primary focus:bg-card focus:outline-none"
                          >
                            <option value="">口座未確認</option>
                            {accounts.map(account => (
                              <option key={account.id} value={account.id}>{account.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-surface py-3 text-sm font-bold text-foreground transition-base active:opacity-80 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={checkedCount === 0 || saving}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '登録中...' : `${checkedCount}件を追加`}
          </button>
        </div>
      </div>
    </div>
  )
}
