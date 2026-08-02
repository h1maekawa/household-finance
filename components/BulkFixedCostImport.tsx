'use client'
// 「現在の固定費を一括登録」ボタンと、その確認モーダル。
//
// 押した瞬間に書き込まず、必ず GET のプレビューを見せてから登録する。
// カードが見つからない・同名カードが複数ある・既に登録済み、といった
// 自動で決めてはいけないケースをここで表に出すのが目的。
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import { useToast } from '@/components/Toast'

type CardResolution =
  | { status: 'resolved'; cardId: string; cardName: string }
  | { status: 'missing'; cardName: string }
  | { status: 'ambiguous'; cardName: string; candidates: { id: string; name: string }[] }

type PreviewItem = {
  name: string
  amount: number
  category: string
  amountType: string
  paymentMethod: string
  dueDay: number | null
  matchKeywords: string[]
  note?: string
  card: CardResolution | null
  existing: { id: string; name: string; amount: number } | null
  needsConfirmation: boolean
}

type PreviewResponse = {
  items: PreviewItem[]
  totals: { livingFixed: number; investment: number; total: number }
  conflicts: number
  needsConfirmation: string[]
}

const CONFLICT_MODES = [
  { value: 'skip', label: '今回はスキップ', hint: '既存データをそのまま残します' },
  { value: 'update', label: '今回の内容で更新', hint: '金額・カード・照合キーワードを上書きします' },
  { value: 'keep', label: '既存データを維持', hint: 'スキップと同じく既存を優先します' },
] as const

export default function BulkFixedCostImport({ onImported }: { onImported: () => void }) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [onConflict, setOnConflict] = useState<'skip' | 'update' | 'keep'>('skip')
  const { data, error, mutate } = useSWR<PreviewResponse>(
    open ? '/api/scheduled-payments/bulk' : null,
    fetcher
  )

  async function handleImport() {
    setSaving(true)
    try {
      const res = await fetch('/api/scheduled-payments/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onConflict }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)

      const parts = [
        result.created.length > 0 ? `${result.created.length}件を登録` : null,
        result.updated.length > 0 ? `${result.updated.length}件を更新` : null,
        result.skipped.length > 0 ? `${result.skipped.length}件をスキップ` : null,
      ].filter(Boolean)
      showToast(parts.join('・') || '変更はありませんでした', 'success')

      if (result.skipped.length > 0) {
        // スキップの理由は握りつぶさない。カード未登録などは対処が必要
        console.warn('一括登録でスキップした項目:', result.skipped)
      }
      await mutate()
      onImported()
      setOpen(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '登録に失敗しました', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80"
      >
        現在の固定費を一括登録
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 px-4 py-6 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="border-b border-border px-4 py-4">
              <h2 className="text-base font-bold">
                {data ? `${data.items.length}件の定期支出を登録します` : '登録内容を確認しています'}
              </h2>
              {data && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Total label="生活固定費" amount={data.totals.livingFixed} />
                  <Total label="積立投資" amount={data.totals.investment} />
                  <Total label="固定支出合計" amount={data.totals.total} emphasis />
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {error && <p className="text-sm text-danger">プレビューを取得できませんでした</p>}
              {!data && !error && <div className="skeleton h-40 w-full rounded-xl" />}

              {data?.items.map(item => (
                <div key={item.name} className="border-b border-border/60 py-2.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">
                        {item.name}
                        <span className="ml-1.5 rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold text-muted">
                          {item.amountType === 'fixed' ? '固定額' : '変動額'}
                        </span>
                        {item.category === '投資' && (
                          <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            投資
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {item.category} / {item.paymentMethod === 'credit_card' ? 'クレジットカード' : '口座引落'}
                        {item.card?.status === 'resolved' && ` / ${item.card.cardName}`}
                      </p>
                      {item.note && <p className="mt-0.5 text-[11px] text-muted">{item.note}</p>}

                      {item.card?.status === 'missing' && (
                        <p className="mt-1 text-[11px] font-bold text-danger">
                          カード「{item.card.cardName}」が未登録です。先に登録してください
                        </p>
                      )}
                      {item.card?.status === 'ambiguous' && (
                        <p className="mt-1 text-[11px] font-bold text-danger">
                          「{item.card.cardName}」が{item.card.candidates.length}件あります。自動では決められません
                        </p>
                      )}
                      {item.dueDay === null && (
                        <p className="mt-1 text-[11px] font-bold text-warning">
                          支払日・引落口座が未設定です（確認が必要）
                        </p>
                      )}
                      {item.paymentMethod === 'credit_card' && item.matchKeywords.length === 0 && (
                        <p className="mt-1 text-[11px] text-warning">
                          メール照合キーワード未設定。実際のカード利用と二重計上する可能性があります
                        </p>
                      )}
                      {item.existing && (
                        <p className="mt-1 text-[11px] font-bold text-primary">
                          既に登録済み（現在 {item.existing.amount.toLocaleString()}円）
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 font-mono text-sm font-bold">
                      {item.amount.toLocaleString()}円
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {data && data.conflicts > 0 && (
              <div className="border-t border-border px-4 py-3">
                <p className="mb-2 text-xs font-bold">
                  既に登録済みの{data.conflicts}件をどうしますか？
                </p>
                <div className="flex flex-col gap-1.5">
                  {CONFLICT_MODES.map(mode => (
                    <label key={mode.value} className="flex items-start gap-2 text-xs">
                      <input
                        type="radio"
                        name="onConflict"
                        value={mode.value}
                        checked={onConflict === mode.value}
                        onChange={() => setOnConflict(mode.value)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-bold">{mode.label}</span>
                        <span className="ml-1 text-muted">{mode.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-xl bg-surface py-3 text-sm font-bold text-foreground transition-base active:opacity-80 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={saving || !data}
                className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
              >
                {saving ? '登録中...' : '登録する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Total({ label, amount, emphasis }: { label: string; amount: number; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl p-2.5 ${emphasis ? 'bg-primary/10' : 'bg-surface'}`}>
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${emphasis ? 'text-primary' : 'text-foreground'}`}>
        {amount.toLocaleString()}円
      </p>
    </div>
  )
}
