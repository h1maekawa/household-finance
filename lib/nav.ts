// lib/nav.ts
//
// ナビゲーションの単一の定義。Sidebar と BottomNav が別々に配列を持つと
// 片方だけ更新されて構成がズレるため、両方ここを参照する。
//
// 情報設計: 機能ごとではなく「ユーザーが何を判断したいか」でページを分ける。
//   ホーム   … 今日・今月のお金について何を判断すべきか
//   家計簿   … 実際に何へ使ったか
//   プラン   … これからのお金を設計する
//   資産     … 今持っている資産を見る
//   コーチ   … 計算結果を説明してもらう
//
// 設定は毎日触るものではないので下部タブから外し、ヘッダーのアバターから入る。
import {
  ChartPie,
  Home,
  type LucideIcon,
  Sparkles,
  WalletCards,
  CalendarClock,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** 役割を1行で補足する */
  hint: string
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'ホーム', icon: Home, hint: '今日なにを判断すべきかを見る' },
  { href: '/transactions', label: '家計簿', icon: WalletCards, hint: '実際に何へ使ったかを見る' },
  { href: '/plan', label: 'プラン', icon: CalendarClock, hint: 'これからのお金を設計する' },
  { href: '/investments', label: '資産', icon: ChartPie, hint: '今持っている資産を見る' },
  { href: '/coach', label: 'コーチ', icon: Sparkles, hint: '計算結果を説明してもらう' },
]

/** アイコンの見た目を全画面で揃える */
export const ICON_STROKE = 1.75

/**
 * 統合したページの旧URL → 移動先。ブックマークとリンクを壊さないために持つ。
 * 内部タブは ?tab= で指定するので、旧ページに相当するタブへ直接着地させる。
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/cashflow': '/plan?tab=payments',
  '/fixed': '/plan?tab=fixed',
  '/goals': '/plan?tab=goals',
  '/ai': '/coach',
  '/accounts': '/investments?tab=accounts',
}

/** 現在のパスがそのナビ項目に属するか(配下のパスも含む) */
export function isActiveNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}
