// components/PageShell.tsx
//
// 全ページ共通のヘッダーとコンテナ。以前は各ページが自前でヘッダーを書いており、
// max-width が max-w-xl / lg:max-w-4xl / lg:max-w-3xl / 720px / 1080px の5種類、
// ヘッダー実装が3種類に分岐していた。ネイティブ展開を見据えて、
// 「ページは PageShell に中身を渡すだけ」という形に揃える。
import type { ReactNode } from 'react'

type Props = {
  title: string
  /** タイトル下の補足。ページの役割を1行で書く */
  description?: string
  /** ヘッダー右側の操作(追加ボタン等) */
  actions?: ReactNode
  /** タイトルの上に出す戻りリンク等 */
  breadcrumb?: ReactNode
  /** タイトル直下・本文の上に敷くタブ列 */
  tabs?: ReactNode
  children: ReactNode
}

export default function PageShell({
  title, description, actions, breadcrumb, tabs, children,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 lg:max-w-4xl lg:py-8">
      <header className="mb-5">
        {breadcrumb && <div className="mb-1">{breadcrumb}</div>}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{title}</h1>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      </header>

      {tabs && <div className="mb-5">{tabs}</div>}

      {children}
    </div>
  )
}

/** ページ内タブの共通見た目。固定収支・投資・目標で使う */
export function PageTabs<T extends string>({
  tabs, active, onChange,
}: {
  tabs: readonly { key: T; label: string }[]
  active: T
  onChange: (key: T) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={`shrink-0 rounded-full px-3.5 py-2 text-sm transition-base ${
            active === tab.key
              ? 'bg-primary font-medium text-white'
              : 'bg-surface text-muted'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
