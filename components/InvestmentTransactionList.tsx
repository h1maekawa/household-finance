'use client'
import { InvestmentTransaction } from '@/types/investment-transaction'

interface Props {
  transactions: InvestmentTransaction[]
}

export default function InvestmentTransactionList({ transactions }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 py-10 text-muted">
        <span className="text-3xl">履</span>
        <p className="text-sm">投資の取引履歴がありません</p>
        <p className="text-xs">楽天証券の取引履歴CSVを取り込むと表示されます</p>
      </div>
    )
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold text-base">取引履歴</h3>
        <span className="text-xs text-muted">{transactions.length}件</span>
      </div>
      <div className="card overflow-hidden">
        {transactions.map((tx, index) => {
          const isSell = /売|解約/.test(tx.trade_type)
          const isBuy = /買|積立/.test(tx.trade_type)
          const tone = isSell ? 'text-danger' : isBuy ? 'text-success' : 'text-muted'
          return (
            <div key={tx.id} className={`px-4 py-3 ${index < transactions.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tx.asset_type === 'stock' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'}`}>
                      {tx.asset_type === 'stock' ? '株式' : '投信'}
                    </span>
                    <span className={`text-xs font-bold ${tone}`}>{tx.trade_type}</span>
                    <span className="font-mono text-xs text-muted">{tx.trade_date}</span>
                  </div>
                  <p className="truncate text-sm font-medium">
                    {tx.symbol ? `${tx.symbol} ` : ''}{tx.name}
                  </p>
                  <p className="text-xs text-muted">
                    {tx.account_type ?? '-'} · {tx.quantity.toLocaleString()}{tx.asset_type === 'stock' ? '株' : '口'}
                    {tx.unit_price > 0 && ` · 単価 ${tx.unit_price.toLocaleString()}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold">{tx.amount_jpy.toLocaleString()}円</p>
                  {tx.amount_foreign ? (
                    <p className="text-[10px] text-muted">
                      {tx.amount_foreign.toLocaleString()} {tx.currency}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
