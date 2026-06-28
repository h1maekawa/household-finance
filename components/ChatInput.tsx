'use client'
import { useState } from 'react'
import { ParsedTransaction, CATEGORIES, TransactionInput } from '@/types/transaction'
import { useToast } from '@/components/Toast'

interface Props {
  onSuccess?: () => void
}

export default function ChatInput({ onSuccess }: Props) {
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedTransaction | null>(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleParse() {
    if (!text.trim()) return
    setParsing(true)
    try {
      const res = await fetch('/api/parse-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setParsed(data.parsed)
      if (data.parsed.confidence === 'low') {
        showToast('確認が必要な項目があります', 'warning')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '解析に失敗しました', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleSave() {
    if (!parsed) return
    setSaving(true)
    try {
      const body: TransactionInput = {
        date:           parsed.date,
        amount:         parsed.amount,
        category:       parsed.category,
        payment_method: parsed.payment_method,
        memo:           parsed.memo,
        source:         'chat',
      }
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      showToast('保存しました', 'success')
      setText('')
      setParsed(null)
      onSuccess?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存に失敗しました', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(field: keyof ParsedTransaction, value: string | number) {
    if (!parsed) return
    setParsed({ ...parsed, [field]: value })
  }

  const catIcon = CATEGORIES.find(c => c.name === parsed?.category)?.icon ?? '📦'

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Input area */}
      <div>
        <label className="block text-sm font-medium text-muted mb-1">
          自然言語で入力してください
        </label>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setParsed(null) }}
          placeholder={'例：\n・コーヒー 500円 現金\n・電車代 230円 Suica\n・スーパーで買い物 3200円 楽天カード'}
          rows={4}
          className="w-full rounded-xl border border-border px-4 py-3 text-base bg-card focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      <button
        onClick={handleParse}
        disabled={parsing || !text.trim()}
        className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-lg transition-base active:opacity-80 disabled:opacity-50"
      >
        {parsing ? '解析中...' : '✨ AIで解析'}
      </button>

      {/* Parsed result */}
      {parsed && (
        <div className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">{catIcon}</span>
            <h3 className="font-bold text-lg">解析結果を確認</h3>
            <span className={`ml-auto text-xs px-2 py-1 rounded-full font-medium ${
              parsed.confidence === 'high'   ? 'bg-success/10 text-success' :
              parsed.confidence === 'medium' ? 'bg-warning/10 text-warning' :
              'bg-danger/10 text-danger'
            }`}>
              {parsed.confidence === 'high' ? '確度：高' : parsed.confidence === 'medium' ? '確度：中' : '確度：低'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted mb-1">日付</p>
              <input
                type="date"
                value={parsed.date}
                onChange={e => handleEdit('date', e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 bg-surface text-sm"
              />
            </div>
            <div>
              <p className="text-muted mb-1">金額</p>
              <input
                type="number"
                inputMode="numeric"
                value={parsed.amount}
                onChange={e => handleEdit('amount', parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-border px-3 py-2 bg-surface text-sm font-bold text-danger"
              />
            </div>
            <div>
              <p className="text-muted mb-1">カテゴリ</p>
              <select
                value={parsed.category}
                onChange={e => handleEdit('category', e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 bg-surface text-sm"
              >
                {CATEGORIES.map(c => (
                  <option key={c.name} value={c.name}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-muted mb-1">支払方法</p>
              <select
                value={parsed.payment_method}
                onChange={e => handleEdit('payment_method', e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 bg-surface text-sm"
              >
                {['現金', '楽天カード', 'PayPay', 'Suica'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-muted text-sm mb-1">メモ</p>
            <input
              type="text"
              value={parsed.memo}
              onChange={e => handleEdit('memo', e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 bg-surface text-sm"
            />
          </div>

          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setParsed(null)}
              className="flex-1 py-3 rounded-xl border border-border text-foreground font-medium transition-base active:bg-surface"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-success text-white font-bold transition-base active:opacity-80 disabled:opacity-50"
            >
              {saving ? '保存中...' : '✓ 保存する'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
