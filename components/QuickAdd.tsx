'use client'
// 全画面から使える追加ボタン。
//
// 出すのは実際に登録できるものだけ。未実装のものを並べると
// 「押せるのに何も起きない」導線になる（振替・カード請求は未実装）。
// フォームは既存の TransactionForm を再利用し、同じ入力画面を2つ作らない。
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Landmark, Plus, TrendingDown, TrendingUp, X } from 'lucide-react'
import TransactionForm from '@/components/TransactionForm'
import { ICON_STROKE } from '@/lib/nav'

type Sheet = null | 'menu' | 'expense' | 'income'

/** 追加ボタンを出さない画面。設定やセットアップ中に浮かせても邪魔になる */
const HIDDEN_PATHS = ['/flow/setup', '/onboarding', '/settings']

export default function QuickAdd() {
  const pathname = usePathname()
  const [sheet, setSheet] = useState<Sheet>(null)

  if (HIDDEN_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setSheet('menu')}
        aria-label="追加する"
        // 下部タブの少し上。親指の届く位置に置く
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-[0_6px_16px_rgba(20,118,179,0.35)] transition-base active:opacity-85 lg:bottom-6"
      >
        <Plus size={26} strokeWidth={ICON_STROKE} aria-hidden />
      </button>

      {sheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
          onClick={() => setSheet(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-xl rounded-t-[20px] bg-card pb-[env(safe-area-inset-bottom)]"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="追加する"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-[14px] font-bold">
                {sheet === 'menu' ? '追加する' : sheet === 'income' ? '収入を追加' : '支出を追加'}
              </p>
              <button
                type="button"
                onClick={() => setSheet(null)}
                aria-label="閉じる"
                className="flex size-9 items-center justify-center rounded-full text-muted transition-base active:opacity-70"
              >
                <X size={19} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>

            {sheet === 'menu' && (
              <div className="p-2">
                <MenuRow
                  icon={<TrendingDown size={18} strokeWidth={ICON_STROKE} aria-hidden />}
                  label="支出を追加"
                  onClick={() => setSheet('expense')}
                />
                <MenuRow
                  icon={<TrendingUp size={18} strokeWidth={ICON_STROKE} aria-hidden />}
                  label="収入を追加"
                  onClick={() => setSheet('income')}
                />
                <Link
                  href="/investments?tab=accounts"
                  onClick={() => setSheet(null)}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-[12px] px-3 text-[14px] transition-base active:bg-surface"
                >
                  <span className="text-muted">
                    <Landmark size={18} strokeWidth={ICON_STROKE} aria-hidden />
                  </span>
                  口座残高を更新
                </Link>
              </div>
            )}

            {(sheet === 'expense' || sheet === 'income') && (
              <div className="max-h-[70svh] overflow-y-auto">
                <TransactionForm initialKind={sheet} onSuccess={() => setSheet(null)} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-[12px] px-3 text-left text-[14px] transition-base active:bg-surface"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  )
}
