'use client'
import { useState } from 'react'
import useSWR from 'swr'
import AssetSummary from '@/components/AssetSummary'
import FundHoldingList from '@/components/FundHoldingList'
import InvestmentCsvImportPanel from '@/components/InvestmentCsvImportPanel'
import InvestmentTransactionList from '@/components/InvestmentTransactionList'
import StockHoldingList from '@/components/StockHoldingList'

import { fetcher } from '@/lib/fetcher'

export default function InvestmentsPage() {
  const [activeTab, setActiveTab] = useState<'summary' | 'holdings' | 'history'>('summary')
  const { data, mutate } = useSWR('/api/stocks', fetcher, {
    refreshInterval: 5 * 60 * 1000, // 5分ごとに時価を自動更新
  })
  const { data: transactionData, mutate: mutateTransactions } = useSWR('/api/investment-transactions?limit=150', fetcher)

  function refreshInvestmentData() {
    mutate()
    mutateTransactions()
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="px-4 pt-10 pb-4">
        <h1 className="text-xl font-bold mb-1">投資</h1>
        <p className="text-xs text-muted">株価は5分ごとに自動更新(楽天証券などの保有銘柄を登録してください)</p>
      </div>

      <div className="flex flex-col gap-4 px-4">
        <div className="grid grid-cols-3 rounded-xl bg-white p-1">
          <InvestmentTab label="サマリー" active={activeTab === 'summary'} onClick={() => setActiveTab('summary')} />
          <InvestmentTab label="保有" active={activeTab === 'holdings'} onClick={() => setActiveTab('holdings')} />
          <InvestmentTab label="取引履歴" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
        </div>

        {/* Asset Summary */}
        {activeTab === 'summary' && (!data ? (
          <div className="card p-4">
            <div className="skeleton h-5 w-24 rounded mb-2" />
            <div className="skeleton h-10 w-48 rounded mb-4" />
            <div className="skeleton h-40 w-full rounded-xl" />
          </div>
        ) : (
          <AssetSummary
            accountBalance={data.accountBalance ?? 0}
            stockValue={data.stockValue ?? 0}
            fundValue={data.fundValue ?? 0}
            totalAssets={data.totalAssets ?? 0}
          />
        ))}

        {/* Holdings */}
        {activeTab === 'holdings' && (!data ? (
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
          <>
            <InvestmentCsvImportPanel
              mode="holdings"
              holdings={data.holdings ?? []}
              funds={data.funds ?? []}
              onMutate={refreshInvestmentData}
            />
            <StockHoldingList holdings={data.holdings ?? []} onMutate={refreshInvestmentData} showImport={false} />
          </>
        ))}

        {activeTab === 'holdings' && data && (
          <FundHoldingList funds={data.funds ?? []} onMutate={refreshInvestmentData} showImport={false} />
        )}

        {activeTab === 'history' && (
          !transactionData ? (
            <div className="card p-4">
              <div className="skeleton h-5 w-32 rounded mb-3" />
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex gap-3 py-3 border-b border-border last:border-0">
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="skeleton h-4 w-3/4 rounded" />
                    <div className="skeleton h-3 w-1/2 rounded" />
                  </div>
                  <div className="skeleton h-8 w-20 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <InvestmentCsvImportPanel
                mode="history"
                holdings={data?.holdings ?? []}
                funds={data?.funds ?? []}
                onMutate={refreshInvestmentData}
              />
              <InvestmentTransactionList transactions={transactionData.transactions ?? []} />
            </>
          )
        )}
      </div>
    </div>
  )
}

function InvestmentTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg py-2 text-sm font-bold transition-base ${
        active ? 'bg-primary text-white' : 'text-muted'
      }`}
    >
      {label}
    </button>
  )
}
