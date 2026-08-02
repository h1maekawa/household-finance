import { redirect } from 'next/navigation'

// 固定費は「予定」ページの固定費タブへ統合した。
export default function Page() {
  redirect('/plan?tab=fixed')
}
