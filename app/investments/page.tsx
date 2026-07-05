'use client'
import useSWR from 'swr'
import AssetSummary from '@/components/AssetSummary'
import StockHoldingList from '@/components/StockHoldingList'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function InvestmentsPage() {
  const { data, mutate } = useSWR('/api/stocks', fetcher, {
    refreshInterval: 5 * 60 * 1000, // 5分ごとに時価を自動更新
  })

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="px-4 pt-10 pb-4">
        <h1 className="text-xl font-bold mb-1">投資</h1>
        <p className="text-xs text-muted">株価は5分ごとに自動更新(楽天証券などの保有銘柄を登録してください)</p>
      </div>

      <div className="flex flex-col gap-4 px-4">
        {/* Asset Summary */}
        {!data ? (
          <div className="card p-4">
            <div className="skeleton h-5 w-24 rounded mb-2" />
            <div className="skeleton h-10 w-48 rounded mb-4" />
            <div className="skeleton h-40 w-full rounded-xl" />
          </div>
        ) : (
          <AssetSummary
            accountBalance={data.accountBalance ?? 0}
            stockValue={data.stockValue ?? 0}
            totalAssets={data.totalAssets ?? 0}
          />
        )}

        {/* Holdings */}
        {!data ? (
          <div className="card p-4">
            <div className="skeleton h-5 w-32 rounded mb-3" />
            {[...Array(2)].map((_, i) => (
              <div key={i} className="flex gap-3 py-3 border-b border-border last:border-0">
                <div className="flex-1 flex flex-col gap-1">
                  <div className="skeleton h-4 w-1/2 rounded" />
                  <div className="skeleton h-3 w-3/4 rounded" />
                </div>
                <div className="skeleton h-8 w-20 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <StockHoldingList holdings={data.holdings ?? []} onMutate={() => mutate()} />
        )}
      </div>
    </div>
  )
}
