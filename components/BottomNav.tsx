'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/dashboard',    label: 'ホーム', icon: '🏠' },
  { href: '/input',        label: '入力',   icon: '📝' },
  { href: '/transactions', label: '履歴',   icon: '📊' },
  { href: '/cashflow',     label: '予測',   icon: '💰' },
  { href: '/investments',  label: '投資',   icon: '💹' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border safe-bottom z-40 lg:hidden">
      <div className="flex">
        {tabs.map(tab => {
          const isActive = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 min-h-[64px] justify-center transition-base ${
                isActive ? 'text-primary' : 'text-muted'
              }`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
