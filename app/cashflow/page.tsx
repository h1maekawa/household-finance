import { redirect } from 'next/navigation'

// キャッシュフローは「予定」ページの支払い予定タブへ統合した。
// 既存のブックマークとリンクを壊さないようリダイレクトだけ残す。
export default function Page() {
  redirect('/plan?tab=payments')
}
