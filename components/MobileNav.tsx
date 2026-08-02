'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, isActiveNav } from '@/lib/nav'

// モバイル用ナビ。
//
// 8ページあった頃は下部タブに収まらず ☰ + ドロワーにしていたが、
// 5ページへ整理したので下部固定タブへ戻した。
// 「今月あと使える金額」を確認するたびにメニューを開かせないのが目的。
export default function MobileNav() {
  const pathname = usePathname()
  const current = NAV_ITEMS.find(item => isActiveNav(pathname, item.href))

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-card px-4 py-3 lg:hidden">
        <span className="text-base font-bold">
          Flow<span className="text-primary">+</span>
        </span>
        {current && (
          <span className="min-w-0 truncate text-sm text-muted">/ {current.label}</span>
        )}
      </header>

      {/* 下部固定タブ。iOS のホームインジケータに被らないよう safe-area を確保する */}
      <nav
        aria-label="メインメニュー"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV_ITEMS.map(item => {
          const isActive = isActiveNav(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-base ${
                isActive ? 'text-primary' : 'text-muted'
              }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className={`text-[10px] ${isActive ? 'font-bold' : ''}`}>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
