'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ACCOUNT_TYPE_LABELS, useAccounts } from '@/lib/useAccounts'
import { useToast } from '@/components/Toast'
import type { AccountWithBalance } from '@/lib/repositories/accounts'

type AccountForm = {
  name: string
  type: AccountWithBalance['type']
  institution: string
  balance: number
  is_primary: boolean
}

const emptyForm = (): AccountForm => ({
  name: '',
  type: 'bank',
  institution: '',
  balance: 0,
  is_primary: false,
})

export default function AccountsPage() {
  const { accounts, total, isLoading, unavailable, mutate } = useAccounts()
  const { showToast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<AccountWithBalance | null>(null)

  async function handleDelete(account: AccountWithBalance) {
    if (!confirm(`「${account.name}」を削除しますか？\n残高の履歴も一緒に削除されます。`)) return

    const res = await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('削除しました')
      mutate()
    } else {
      showToast('削除に失敗しました', 'error')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6">
      <header className="mb-5">
        <Link href="/settings" className="text-xs text-muted">← 設定</Link>
        <h1 className="mt-1 text-xl font-bold">口座管理</h1>
        <p className="mt-1 text-xs text-muted">
          どの口座からいくら引き落とされるかを、AIコーチとキャッシュフロー予測が参照します
        </p>
      </header>

      <div className="card mb-5 px-4 py-4">
        <p className="text-xs text-muted">現金資産の合計</p>
        <p className="mt-1 text-2xl font-bold">{total.toLocaleString()}円</p>
        <p className="mt-1 text-xs text-muted">{accounts.length}口座</p>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">口座一覧</h2>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="text-sm font-medium text-primary"
        >
          ＋ 追加
        </button>
      </div>

      {unavailable ? (
        <div className="card px-4 py-6 text-sm text-muted">
          口座テーブルがまだ作成されていません。
          <code className="mx-1 rounded bg-surface px-1">supabase/migrations/018_accounts.sql</code>
          を Supabase の SQL エディタで実行してください。
        </div>
      ) : isLoading ? (
        <div className="card h-32 skeleton" />
      ) : accounts.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">
          口座がまだありません。「＋ 追加」から登録してください。
        </div>
      ) : (
        <div className="card overflow-hidden">
          {accounts.map((account, i) => (
            <div
              key={account.id}
              className={`flex items-center gap-3 px-4 py-3 ${i < accounts.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  {account.is_primary && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                      メイン
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {ACCOUNT_TYPE_LABELS[account.type]}
                  {account.recorded_at && ` ・ ${account.recorded_at.slice(0, 10)} 時点`}
                </p>
              </div>
              <p className="shrink-0 text-sm font-bold">{account.balance.toLocaleString()}円</p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => { setEditTarget(account); setShowModal(true) }}
                  className="text-xs text-muted"
                  aria-label={`${account.name}を編集`}
                >
                  ✏
                </button>
                <button
                  onClick={() => handleDelete(account)}
                  className="text-xs text-danger"
                  aria-label={`${account.name}を削除`}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AccountModal
          initial={editTarget}
          onClose={() => setShowModal(false)}
          onSaved={() => { mutate(); setShowModal(false) }}
        />
      )}
    </div>
  )
}

function AccountModal({
  initial, onClose, onSaved,
}: {
  initial: AccountWithBalance | null
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [form, setForm] = useState<AccountForm>(
    initial
      ? {
          name: initial.name,
          type: initial.type,
          institution: initial.institution ?? '',
          balance: initial.balance,
          is_primary: initial.is_primary,
        }
      : emptyForm()
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleSubmit() {
    setSaving(true)
    const url = initial ? `/api/accounts/${initial.id}` : '/api/accounts'
    const res = await fetch(url, {
      method: initial ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        type: form.type,
        institution: form.institution.trim() || null,
        is_primary: form.is_primary,
        balance: form.balance,
      }),
    })
    setSaving(false)

    if (res.ok) {
      showToast(initial ? '更新しました' : '追加しました', 'success')
      onSaved()
    } else {
      showToast('保存に失敗しました', 'error')
    }
  }

  const canSave = Boolean(form.name.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 id="account-modal-title" className="text-base font-bold">
            {initial ? '口座を編集' : '口座を追加'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div>
            <label htmlFor="account-name" className="mb-1 block text-xs text-muted">口座名</label>
            <input
              id="account-name"
              type="text"
              placeholder="例：三井住友銀行"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="account-type" className="mb-1 block text-xs text-muted">種別</label>
              <select
                id="account-type"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as AccountForm['type'] }))}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
              >
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="account-balance" className="mb-1 block text-xs text-muted">残高（円）</label>
              <input
                id="account-balance"
                type="number"
                inputMode="numeric"
                value={form.balance || ''}
                onChange={e => setForm(f => ({ ...f, balance: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm font-bold focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
          </div>

          {initial && (
            <p className="-mt-2 text-xs text-muted">
              残高は上書きではなく履歴として記録されます（推移を壊さないため）
            </p>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_primary}
              onChange={e => setForm(f => ({ ...f, is_primary: e.target.checked }))}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            メイン口座にする
          </label>
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
            disabled={!canSave || saving}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
