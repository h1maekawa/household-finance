'use client'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { DailyBalance } from '@/types/cashflow'
import { format, parseISO } from 'date-fns'

interface Props {
  data: DailyBalance[]
}

function fmt(v: number) {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 10000)}万`
  return `${v.toLocaleString()}`
}

export default function CashflowChart({ data }: Props) {
  const chartData = data.map(d => ({
    date:    format(parseISO(d.date), 'M/d'),
    balance: d.balance,
    isNeg:   d.isNegative,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
        <YAxis tickFormatter={fmt} tick={{ fontSize: 10 }} width={40} />
        <Tooltip
          formatter={(value) => [`${Number(value).toLocaleString()}円`, '残高予測']}
          labelFormatter={label => `${label}`}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <ReferenceLine y={0} stroke="#EF4444" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="balance"
          stroke="#3B82F6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
