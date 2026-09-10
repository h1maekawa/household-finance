'use client'
// 目標の通過点（スペック §19）の確認と編集。
//
// 到達判定・次の通過点・到達見込み月はサーバー（goal-milestone.ts）が出した
// track をそのまま表示する。ここで判定し直さない。
//
// 「候補を入れる」はフォームに入れるだけで保存はしない。刻み方はユーザーが
// 決めるもので、システムが勝手に確定させない。
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import { useToast } from '@/components/Toast'
import { yen } from '@/components/home/AmountBlock'
import type { MilestoneTrack } from '@/lib/services/goal-milestone'
import type { GoalMilestone, LifeGoal } from '@/types/goal'

type MilestoneResponse = {
  milestones: GoalMilestone[]
  suggested: number[]
  track: MilestoneTrack
}

type Row = { amount: string; label: string }

const toRows = (milestones: GoalMilestone[]): Row[] =>
  milestones.map(m => ({ amount: String(m.amount), label: m.label ?? '' }))

export default function MilestoneModal({
  goal,
  onClose,
}: {
  goal: LifeGoal
  onClose: () => void
}) {
  const { showToast } = useToast()
  const { data, mutate, isLoading } = useSWR<MilestoneResponse>(
    `/api/goals/${goal.id}/milestones`,
    fetcher
  )
  // 編集を始めるまでは取得結果をそのまま見せる。effect で state へ写すと
  // 再取得のたびに編集中の内容が消える
  const [draft, setDraft] = useState<Row[] | null>(null)
  const [saving, setSaving] = useState(false)

  const rows = draft ?? toRows(data?.milestones ?? [])
  const track = data?.track ?? null
  const suggested = data?.suggested ?? []

  function update(index: number, patch: Partial<Row>) {
    setDraft(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  async function handleSave() {
    setSaving(true)
    const payload = rows
      .map(row => ({ amount: Math.round(Number(row.amount) || 0), label: row.label.trim() || null }))
      .filter(row => row.amount > 0)

    const res = await fetch(`/api/goals/${goal.id}/milestones`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestones: payload }),
    })
    setSaving(false)

    if (res.ok) {
      showToast('通過点を保存しました', 'success')
      setDraft(null)
      mutate()
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      showToast(body.error ?? '保存に失敗しました', 'error')
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
        aria-labelledby="milestone-modal-title"
        className="flex max-h-[calc(100svh-48px)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <div className="min-w-0">
            <h2 id="milestone-modal-title" className="truncate text-base font-bold">
              通過点
            </h2>
            <p className="truncate text-xs text-muted">{goal.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <div className="skeleton h-24 w-full rounded-xl" />
          ) : (
            track && <MilestoneProgressList track={track} />
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">刻みを編集</h3>
              {suggested.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft(suggested.map(amount => ({ amount: String(amount), label: '' })))
                  }
                  className="text-xs font-medium text-primary"
                >
                  候補を入れる
                </button>
              )}
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-muted">
              目標までの通過点を自分で決められます。候補を入れたあとに自由に直せます。
              保存するまで反映されません。
            </p>

            <div className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={`${index + 1}番目の通過点の金額`}
                    value={row.amount}
                    onChange={e => update(index, { amount: e.target.value })}
                    className="w-32 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-bold tabular-nums focus:border-primary focus:bg-card focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="呼び名（任意）"
                    aria-label={`${index + 1}番目の通過点の呼び名`}
                    value={row.label}
                    onChange={e => update(index, { label: e.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm focus:border-primary focus:bg-card focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(rows.filter((_, i) => i !== index))}
                    aria-label={`${index + 1}番目の通過点を削除`}
                    className="shrink-0 px-1 text-sm text-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {rows.length < 12 && (
              <button
                type="button"
                onClick={() => setDraft([...rows, { amount: '', label: '' }])}
                className="mt-2 text-sm font-medium text-primary"
              >
                ＋ 通過点を追加
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-surface py-3 text-sm font-bold text-foreground transition-base active:opacity-80 disabled:opacity-50"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MilestoneProgressList({ track }: { track: MilestoneTrack }) {
  if (track.milestones.length === 0) {
    return (
      <p className="rounded-xl bg-surface px-3 py-3 text-xs leading-relaxed text-muted">
        通過点がまだありません。大きな目標は途中の通過点へ分けると、次に目指す金額が分かります。
      </p>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">現在</span>
        <span className="text-[15px] font-bold tabular-nums">{yen(track.currentAmount)}</span>
      </div>

      <ol className="mt-3 space-y-3">
        {track.milestones.map(milestone => (
          <li key={milestone.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-[13px] ${milestone.reached ? 'text-muted' : ''}`}>
                {milestone.reached ? '✓ ' : ''}
                {milestone.label ?? yen(milestone.amount)}
              </span>
              <span className="shrink-0 text-[13px] font-bold tabular-nums">
                {yen(milestone.amount)}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 rounded-full bg-border"
              role="img"
              aria-label={`${yen(milestone.amount)} まで ${Math.round(milestone.segmentProgress * 100)}%`}
            >
              <div
                className={`h-full rounded-full ${milestone.reached ? 'bg-success' : 'bg-primary'}`}
                style={{ width: `${milestone.segmentProgress * 100}%` }}
              />
            </div>
            {!milestone.reached && (
              <p className="mt-0.5 text-[10px] text-muted">
                あと {yen(milestone.remainingAmount)}
              </p>
            )}
          </li>
        ))}
      </ol>

      {track.nextMilestone && (
        <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          次は {yen(track.nextMilestone.amount)}。あと{' '}
          {track.remainingToNext === null ? '—' : yen(track.remainingToNext)}
          {track.projectedNextMonth
            ? `。今の積立ペースなら ${track.projectedNextMonth.replace('-', '年')}月ごろです（利回り0%）`
            : '。積立額が未設定のため、到達時期はまだ出せません'}
        </p>
      )}
    </div>
  )
}
