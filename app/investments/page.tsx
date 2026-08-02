import { Suspense } from 'react'
import AssetsTabs from './AssetsTabs'

// 「資産」= 今どこにいくらあるかを見る場所。
// 旧「投資・資産」(/investments)と口座管理(/accounts)を統合した。
//
// タブ選択を ?tab= で持つため、中身は useSearchParams を使う。App Router では
// 静的レンダリング時に Suspense 境界が必要なのでここで包む。
export default function InvestmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl p-4">
          <div className="skeleton h-64 w-full rounded-xl" />
        </div>
      }
    >
      <AssetsTabs />
    </Suspense>
  )
}
