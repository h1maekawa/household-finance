// lib/nav.ts
//
// ナビゲーションの単一の定義。以前は Sidebar と BottomNav が同じ配列を
// それぞれ持っており、片方だけ更新されて構成がズレる状態だった。
//
// 情報設計: 機能ごとではなく「ユーザーが何を判断したいか」でページを分ける。
//   ホーム   … 今日なにを判断すればよいか
//   家計簿   … 実際に使ったお金を記録・確認する
//   予定     … これからのお金を設計する(旧 マネープラン + キャッシュフロー)
//   資産     … 今持っている資産と、その置き場所を見る(旧 投資・資産 + 口座)
//   設定     … 毎日は触らないマスタと連携
//
// マネープランとキャッシュフローは、どちらも本質的に「これからのお金」を見る機能で、
// 分かれていること自体が重複感の原因だったため「予定」に統合した。
export type NavItem = {
  href: string
  label: string
  icon: string
  /** 役割を1行で補足する */
  hint: string
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',    label: 'ホーム', icon: '🏠', hint: '今日なにをすべきかを見る' },
  { href: '/transactions', label: '家計簿', icon: '💰', hint: '使ったお金を記録する' },
  { href: '/plan',         label: '予定',   icon: '📅', hint: 'これからのお金を設計する' },
  { href: '/investments',  label: '資産',   icon: '💼', hint: '資産と口座を見る' },
  { href: '/settings',     label: '設定',   icon: '⚙️', hint: '連携とマスタを管理する' },
]

/**
 * 統合したページの旧URL → 移動先。ブックマークとリンクを壊さないために持つ。
 * 内部タブは ?tab= で指定するので、旧ページに相当するタブへ直接着地させる。
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/cashflow': '/plan?tab=payments',
  '/fixed': '/plan?tab=fixed',
  '/goals': '/plan',
  '/ai': '/dashboard',
  '/accounts': '/investments?tab=accounts',
}

/** 現在のパスがそのナビ項目に属するか(配下のパスも含む) */
export function isActiveNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
