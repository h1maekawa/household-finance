'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, isActiveNav } from '@/lib/nav'

// モバイル用ナビ。以前は下部固定の5タブだったが、情報設計が8ページになり
// 下部タブでは収まらなくなったため、ヘッダーの ☰ + ドロワーに置き換えた。
export default function MobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const current = NAV_ITEMS.find(item => isActiveNav(pathname, item.href))

  // 開いている間は背面をスクロールさせない
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-[10px] text-xl transition-base active:bg-surface"
        >
          ☰
        </button>
        <span className="min-w-0 truncate text-sm font-bold">
          {current ? `${current.icon} ${current.label}` : 'Flow+'}
        </span>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-foreground/55 backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <nav
            className="flex h-full w-[280px] max-w-[85vw] flex-col bg-card px-3.5 py-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
            aria-label="メインメニュー"
          >
            <div className="mb-6 flex items-center justify-between px-2.5">
              <span className="text-base font-bold">
                Flow<span className="text-primary">+</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="メニューを閉じる"
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted transition-base active:bg-surface"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-1 overflow-y-auto">
              {NAV_ITEMS.map(item => {
                const isActive = isActiveNav(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 transition-base ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-foreground'
                    }`}
                  >
                    <span className="text-base leading-tight">{item.icon}</span>
                    <span className="min-w-0">
                      <span className={`block text-[13px] ${isActive ? 'font-medium' : ''}`}>
                        {item.label}
                      </span>
                      <span className="block text-[11px] text-muted">{item.hint}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
