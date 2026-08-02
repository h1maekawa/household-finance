import { Suspense } from 'react'
import TransactionTabs from './TransactionTabs'

// 家計簿。タブ選択を ?tab= で持つため、中身は useSearchParams を使う。
// App Router では静的レンダリング時に Suspense 境界が必要なのでここで包む。
export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl p-4">
          <div className="skeleton h-64 w-full rounded-xl" />
        </div>
      }
    >
      <TransactionTabs />
    </Suspense>
  )
}
