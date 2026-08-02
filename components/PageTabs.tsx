'use client'
// ページ内タブ。
//
// 「予定」「資産」はそれぞれ複数の役割を束ねているが、ページを分けると
// 元の重複問題に戻る。1ページの中でタブで切り替える。
//
// 選択中のタブは ?tab= に載せる。統合前の URL(/cashflow, /accounts 等)から
// 相当するタブへ直接着地させたいのと、リロード・戻る操作で
// タブが先頭に戻らないようにするため。
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

export type PageTab = {
  /** ?tab= に載る値。既定タブは省略時に選ばれる */
  key: string
  label: string
}

export function useActiveTab(tabs: PageTab[]): string {
  const searchParams = useSearchParams()
  const requested = searchParams.get('tab')
  return tabs.some(tab => tab.key === requested) ? (requested as string) : tabs[0].key
}

export default function PageTabs({ tabs, active }: { tabs: PageTab[]; active: string }) {
  const pathname = usePathname()

  return (
    <div
      role="tablist"
      className="grid gap-1 rounded-xl bg-surface p-1"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map(tab => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={`${pathname}?tab=${tab.key}`}
            // 同じページ内の切り替えなのでスクロール位置は保つ
            scroll={false}
            role="tab"
            aria-selected={isActive}
            className={`rounded-lg py-2 text-center text-sm transition-base ${
              isActive ? 'bg-card font-bold text-foreground shadow-sm' : 'text-muted'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
