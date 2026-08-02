import { redirect } from 'next/navigation'

// 口座管理は「資産」ページの口座タブへ統合した。
// 既存のブックマークと設定画面からのリンクを壊さないようリダイレクトを残す。
export default function Page() {
  redirect('/investments?tab=accounts')
}
