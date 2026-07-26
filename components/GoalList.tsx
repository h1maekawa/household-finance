'use client'
// components/GoalList.tsx
// ライフゴールの CRUD。API(/api/goals)と進捗エンジン(lib/services/goal-progress.ts)は
// 以前から完成していたが、UI から呼ぶ場所が無く、目標の追加・編集が
// オンボーディングウィザードの再実行でしか行えなかった。
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import { useToast } from '@/components/Toast'
import type { GoalInput, GoalKind, LifeGoal } from '@/types/goal'

const GOAL_KINDS: { value: GoalKind; label: string }[] = [
  { value: 'savings',   label: '貯金' },
  { value: 'fire',      label: 'FIRE' },
  { value: 'house',     label: '家' },
  { value: 'car',       label: '車' },
  { value: 'education', label: '教育' },
  { value: 'travel',    label: '旅行' },
  { value: 'custom',    label: 'その他' },
]

const emptyForm = (): GoalInput => ({
  kind: 'savings',
  title: '',
  target_amount: null,
  target_date: null,
  current_amount: 0,
  priority: 0,
})

export default function GoalList() {
  const { data, mutate, isLoading } = useSWR<LifeGoal[]>('/api/goals', fetcher)
  const { showToast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<LifeGoal | null>(null)

  const goals = Array.isArray(data) ? data : []

  async function handleDelete(goal: LifeGoal) {
    if (!confirm(`「${goal.title}」を削除しますか？`)) return
    const res = await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' })
    if (res.ok) { showToast('削除しました'); mutate() }
    else showToast('削除に失敗しました', 'error')
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold">目標</h2>
          <p className="mt-0.5 text-xs text-muted">目標額と期限から、毎月いくら積み立てるかを逆算します</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="shrink-0 text-sm font-medium text-primary"
        >
          ＋ 追加
        </button>
      </div>

      {isLoading ? (
        <div className="skeleton h-24 w-full rounded-xl" />
      ) : goals.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          目標がまだありません。「＋ 追加」から登録してください。
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {goals.map((goal, i) => (
            <div
              key={goal.id}
              className={`flex items-center gap-3 px-4 py-3 ${i < goals.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{goal.title}</p>
                <p className="text-xs text-muted">
                  {GOAL_KINDS.find(k => k.value === goal.kind)?.label ?? goal.kind}
                  {goal.target_amount !== null && ` ・ ${goal.target_amount.toLocaleString()}円`}
                  {goal.target_date && ` ・ ${goal.target_date} まで`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => { setEditTarget(goal); setShowModal(true) }}
                  className="text-xs text-muted"
                  aria-label={`${goal.title}を編集`}
                >
                  ✏
                </button>
                <button
                  onClick={() => handleDelete(goal)}
                  className="text-xs text-danger"
                  aria-label={`${goal.title}を削除`}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <GoalModal
          initial={editTarget}
          onClose={() => setShowModal(false)}
          onSaved={() => { mutate(); setShowModal(false) }}
        />
      )}
    </section>
  )
}

function GoalModal({
  initial, onClose, onSaved,
}: {
  initial: LifeGoal | null
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [form, setForm] = useState<GoalInput>(
    initial
      ? {
          kind: initial.kind,
          title: initial.title,
          target_amount: initial.target_amount,
          target_date: initial.target_date,
          current_amount: initial.current_amount,
          priority: initial.priority,
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
    const res = await fetch(initial ? `/api/goals/${initial.id}` : '/api/goals', {
      method: initial ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) {
      showToast(initial ? '更新しました' : '追加しました', 'success')
      onSaved()
    } else {
      showToast('保存に失敗しました', 'error')
    }
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
        aria-labelledby="goal-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 id="goal-modal-title" className="text-base font-bold">
            {initial ? '目標を編集' : '目標を追加'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div>
            <label htmlFor="goal-title" className="mb-1 block text-xs text-muted">目標名</label>
            <input
              id="goal-title"
              type="text"
              placeholder="例：生活防衛資金"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="goal-kind" className="mb-1 block text-xs text-muted">種類</label>
              <select
                id="goal-kind"
                value={form.kind}
                onChange={e => setForm(f => ({ ...f, kind: e.target.value as GoalKind }))}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
              >
                {GOAL_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="goal-target" className="mb-1 block text-xs text-muted">目標額（円）</label>
              <input
                id="goal-target"
                type="number"
                inputMode="numeric"
                value={form.target_amount ?? ''}
                onChange={e => setForm(f => ({
                  ...f,
                  target_amount: e.target.value === '' ? null : parseInt(e.target.value) || 0,
                }))}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm font-bold focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="goal-current" className="mb-1 block text-xs text-muted">現在額（円）</label>
              <input
                id="goal-current"
                type="number"
                inputMode="numeric"
                value={form.current_amount ?? 0}
                onChange={e => setForm(f => ({ ...f, current_amount: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="goal-date" className="mb-1 block text-xs text-muted">達成期限</label>
              <input
                id="goal-date"
                type="date"
                value={form.target_date ?? ''}
                onChange={e => setForm(f => ({ ...f, target_date: e.target.value || null }))}
                className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
          </div>
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
            disabled={!form.title.trim() || saving}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
