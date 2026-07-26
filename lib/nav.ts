// lib/nav.ts
//
// ナビゲーションの単一の定義。以前は Sidebar と BottomNav が同じ配列を
// それぞれ持っており、片方だけ更新されて構成がズレる状態だった。
//
// 情報設計(要件定義書 v3.1): ページごとに「何をする場所か」を1つに絞る。
export type NavItem = {
  href: string
  label: string
  icon: string
  /** ドロワーで役割を1行補足する */
  hint: string
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',    label: 'ダッシュボード',     icon: '🏠', hint: '全体を見る' },
  { href: '/transactions', label: '家計簿',             icon: '💰', hint: '日々の収支を入力する' },
  { href: '/fixed',        label: '固定収支',           icon: '💳', hint: '毎月のお金を設計する' },
  { href: '/cashflow',     label: 'キャッシュフロー',   icon: '📅', hint: '未来のお金を見る' },
  { href: '/investments',  label: '投資・資産',         icon: '📈', hint: '資産形成を見る' },
  { href: '/goals',        label: '目標・ミッション',   icon: '🎯', hint: '人生の目標を管理する' },
  { href: '/ai',           label: 'AIライフプランナー', icon: '🤖', hint: '意思決定を支援する' },
  { href: '/settings',     label: '設定',               icon: '⚙️', hint: 'アプリ全体を管理する' },
]

/** 現在のパスがそのナビ項目に属するか(配下のパスも含む) */
export function isActiveNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
