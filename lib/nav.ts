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
  { href: '/dashboard',    label: 'ダッシュボード',   icon: '🏠', hint: '全体を見る' },
  { href: '/transactions', label: '家計簿',           icon: '💰', hint: '日々の収支を入力する' },
  // 固定収支・目標・AIコーチは「毎月のお金の設計」という1つの流れなので統合した。
  // 固定費を直した結果が自由予算にどう効くかを、画面移動せずに見られる。
  { href: '/plan',         label: 'マネープラン',     icon: '🧭', hint: '収入・固定費・目標から使える額を設計する' },
  { href: '/cashflow',     label: 'キャッシュフロー', icon: '📅', hint: '未来のお金を見る' },
  { href: '/investments',  label: '投資・資産',       icon: '📈', hint: '資産形成を見る' },
  { href: '/settings',     label: '設定',             icon: '⚙️', hint: 'アプリ全体を管理する' },
]

/** 現在のパスがそのナビ項目に属するか(配下のパスも含む) */
export function isActiveNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
