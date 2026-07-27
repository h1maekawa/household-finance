import { redirect } from 'next/navigation'

// /fixed・/goals・/ai はマネープラン(/plan)へ統合した。
// 既存のブックマークとナビ履歴を壊さないようリダイレクトだけ残す。
export default function Page() {
  redirect('/plan')
}
