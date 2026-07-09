'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/dashboard',    label: 'ホーム', icon: '🏠' },
  { href: '/input',        label: '入力',   icon: '📝' },
  { href: '/transactions', label: '履歴',   icon: '📊' },
  { href: '/cashflow',     label: '予測',   icon: '💰' },
  { href: '/investments',  label: '投資',   icon: '💹' },
  { href: '/settings',     label: '設定',   icon: '⚙️' },
]

// デスクトップ幅(lg以上)でのみ表示するサイドナビ。
// モバイルでは BottomNav が同じタブ構成を担当する。
export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex lg:w-[200px] lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:px-3.5 lg:py-6">
      <Link href="/dashboard" className="mb-6 block px-2.5 text-base font-bold">
        Flow<span className="text-primary">+</span>
      </Link>

      <nav className="flex flex-col gap-1">
        {tabs.map(tab => {
          const isActive = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] transition-base ${
                isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted'
              }`}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              {tab.label}
            </Link>
          )
        })}
      </nav>

      <Link href="/settings" className="mt-auto block px-3 py-2 text-xs text-primary">
        初期設定
      </Link>
    </aside>
  )
}
