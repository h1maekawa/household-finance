'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, isActiveNav } from '@/lib/nav'

// デスクトップ幅(lg以上)でのみ表示するサイドナビ。
// モバイルでは MobileNav(ハンバーガー + ドロワー)が同じ NAV_ITEMS を描画する。
export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex lg:w-[220px] lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:px-3.5 lg:py-6">
      <Link href="/dashboard" className="mb-6 block px-2.5 text-base font-bold">
        Flow<span className="text-primary">+</span>
      </Link>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(item => {
          const isActive = isActiveNav(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] transition-base ${
                isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
