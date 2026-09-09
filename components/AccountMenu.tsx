'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { CircleUserRound } from 'lucide-react'
import SignOutButton from '@/components/SignOutButton'
import { ICON_STROKE } from '@/lib/nav'

/**
 * ヘッダー右上のアバター。設定系はすべてここから入る。
 * 毎日触らないものを下部タブへ置くと、日常の導線が薄まるため。
 */
/**
 * 実際に開ける画面だけを並べる。存在しない設定セクションへのリンクを置くと
 * 「押せるのに移動しない」導線になる。プロフィール・課金・データ管理は
 * まだ独立したセクションが無いので、実装後に追加する。
 *
 * section の値は settings 側の SETTING_TABS と一致していること
 * （lib/security/ui-contract.test.ts が突き合わせる）。
 */
const MENU = [
  { href: '/investments?tab=accounts', label: '口座・カード' },
  { href: '/settings?section=integrations', label: '連携・取込' },
  { href: '/settings?section=categories', label: 'カテゴリ' },
  { href: '/settings?section=display', label: '表示設定' },
  { href: '/settings?section=account', label: 'アカウント' },
]

export default function AccountMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="アカウントメニュー"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex size-9 items-center justify-center rounded-full text-muted transition-base active:opacity-70"
      >
        <CircleUserRound size={26} strokeWidth={ICON_STROKE} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-[14px] border border-border bg-card py-1 shadow-[0_8px_24px_rgba(30,41,51,0.10)]"
        >
          {MENU.map(item => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-[13px] transition-base active:bg-surface"
            >
              {item.label}
            </Link>
          ))}
          <div className="border-t border-border">
            <SignOutButton variant="menu" />
          </div>
        </div>
      )}
    </div>
  )
}
