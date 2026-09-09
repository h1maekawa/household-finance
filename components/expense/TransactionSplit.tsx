'use client'
// 取引の内訳編集。
//
// 「セブンイレブン ¥1,800」を 食費¥700 / タバコ¥600 / 日用品¥500 のように分ける。
// 合計一致の最終保証はDB（replace_transaction_items）。ここでの検証は
// 保存前に気づけるようにするためのもので、正ではない。
import { useState } from 'react'
import useSWR from 'swr'
import { Plus, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { yen } from '@/components/home/AmountBlock'
import { fetcher } from '@/lib/fetcher'
import { ICON_STROKE } from '@/lib/nav'
import { useCategories } from '@/lib/useCategories'

type Item = { item_name: string; amount: number; category: string }
type ItemsResponse = { items: (Item & { id: string; position: number })[] }

export default function TransactionSplit({
  transactionId,
  amount,
  onSaved,
}: {
  transactionId: string
  amount: number
  onSaved?: () => void
}) {
  const { showToast } = useToast()
  const { expense } = useCategories()
  const { data, mutate } = useSWR<ItemsResponse>(
    `/api/transactions/${transactionId}/items`,
    fetcher
  )
  // 編集を始めるまではサーバーの値をそのまま表示し、
  // 触った時点で draft に切り替える（effect で state へ写すとカスケードする）
  const [draft, setDraft] = useState<Item[] | null>(null)
  const [saving, setSaving] = useState(false)

  const items: Item[] =
    draft ??
    (data?.items ?? []).map(i => ({
      item_name: i.item_name,
      amount: i.amount,
      category: i.category,
    }))
  const setItems = (next: Item[] | ((prev: Item[]) => Item[])) =>
    setDraft(typeof next === 'function' ? next(items) : next)

  const total = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
  const diff = amount - total
  const canSave = items.length === 0 || diff === 0

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/transactions/${transactionId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        showToast(json.error ?? '保存に失敗しました', 'error')
        return
      }
      showToast(items.length === 0 ? '内訳を解除しました' : '内訳を保存しました', 'success')
      setDraft(null)
      await mutate()
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-bold">内訳</h2>
        <span className="text-[11px] text-muted">取引金額 {yen(amount)}</span>
      </div>

      {items.length === 0 && (
        <p className="mt-2 text-[12px] text-muted">
          まだ分けていません。1件の買い物を用途ごとに分けられます。
        </p>
      )}

      <ul className="mt-2.5 space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-center gap-2">
            <input
              value={item.item_name}
              onChange={e =>
                setItems(list => list.map((v, i) => (i === index ? { ...v, item_name: e.target.value } : v)))
              }
              placeholder="品目"
              aria-label={`${index + 1}件目の品目`}
              className="min-w-0 flex-1 rounded-[10px] border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary"
            />
            <select
              value={item.category}
              onChange={e =>
                setItems(list => list.map((v, i) => (i === index ? { ...v, category: e.target.value } : v)))
              }
              aria-label={`${index + 1}件目のカテゴリ`}
              className="w-24 shrink-0 rounded-[10px] border border-border px-2 py-2 text-[13px]"
            >
              {expense.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <input
              type="number"
              inputMode="numeric"
              value={item.amount || ''}
              onChange={e =>
                setItems(list =>
                  list.map((v, i) => (i === index ? { ...v, amount: parseInt(e.target.value) || 0 } : v))
                )
              }
              aria-label={`${index + 1}件目の金額`}
              className="w-24 shrink-0 rounded-[10px] border border-border px-2.5 py-2 text-right text-[13px] tabular-nums outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setItems(list => list.filter((_, i) => i !== index))}
              aria-label={`${index + 1}件目を削除`}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-base active:opacity-70"
            >
              <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() =>
          setItems(list => [
            ...list,
            { item_name: '', amount: list.length === 0 ? amount : 0, category: expense[0]?.name ?? '未分類' },
          ])
        }
        className="mt-2.5 flex items-center gap-1.5 text-[12px] font-bold text-primary transition-base active:opacity-70"
      >
        <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
        行を追加
      </button>

      {items.length > 0 && (
        <p className={`mt-2.5 text-[12px] tabular-nums ${diff === 0 ? 'text-muted' : 'text-danger'}`}>
          内訳合計 {yen(total)}
          {diff !== 0 && `（取引金額と ${yen(Math.abs(diff))} ${diff > 0 ? '不足' : '超過'}）`}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving || !canSave}
        className="mt-3 w-full rounded-[12px] bg-primary py-2.5 text-[13px] font-bold text-white transition-base active:opacity-85 disabled:opacity-40"
      >
        {saving ? '保存中' : items.length === 0 ? '内訳を解除して保存' : '内訳を保存'}
      </button>
    </section>
  )
}
