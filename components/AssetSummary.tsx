'use client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface Props {
  accountBalance: number
  stockValue: number
  fundValue?: number
  totalAssets: number
}

const COLORS = ['#1476B3', '#1FAE8C', '#F0B429', '#E2544B', '#8891A0', '#3E6FA0']

export default function AssetSummary({ accountBalance, stockValue, fundValue = 0, totalAssets }: Props) {
  const data = [
    { name: '口座残高', value: accountBalance },
    { name: '株式評価額', value: stockValue },
    { name: '投資信託評価額', value: fundValue },
  ].filter(d => d.value > 0)

  return (
    <div className="card p-4">
      <p className="text-sm text-muted mb-1">総資産</p>
      <p className="text-3xl font-bold mb-4">
        {totalAssets.toLocaleString()}
        <span className="text-base font-normal text-muted ml-1">円</span>
      </p>

      {data.length > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
              dataKey="value" paddingAngle={3}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `${Number(v).toLocaleString()}円`} />
            <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs">{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
      )}

      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="bg-surface rounded-xl p-3">
          <p className="text-xs text-muted mb-1">口座残高</p>
          <p className="text-base font-bold">{accountBalance.toLocaleString()}円</p>
        </div>
        <div className="bg-surface rounded-xl p-3">
          <p className="text-xs text-muted mb-1">株式評価額</p>
          <p className="text-base font-bold">{stockValue.toLocaleString()}円</p>
        </div>
        <div className="bg-surface rounded-xl p-3">
          <p className="text-xs text-muted mb-1">投資信託評価額</p>
          <p className="text-base font-bold">{fundValue.toLocaleString()}円</p>
        </div>
      </div>
    </div>
  )
}
