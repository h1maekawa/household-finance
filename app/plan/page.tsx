import { Suspense } from 'react'
import PlanTabs from './PlanTabs'

// 「予定」= これからのお金を設計する場所。
//
// 旧マネープラン(/plan)と旧キャッシュフロー(/cashflow)を統合した。
// どちらも本質的に「これからのお金」を見る機能で、分かれていること自体が
// 重複感の原因だった。
//
// タブ選択を ?tab= で持つため、中身は useSearchParams を使う。App Router では
// 静的レンダリング時に Suspense 境界が必要なのでここで包む。
export default function PlanPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl p-4">
          <div className="skeleton h-64 w-full rounded-xl" />
        </div>
      }
    >
      <PlanTabs />
    </Suspense>
  )
}
