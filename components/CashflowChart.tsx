'use client'
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 12, right: 18, left: 2, bottom: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#D8DEE8" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} interval={0} tickMargin={8} />
        <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: '#6B7280' }} width={44} />
        <Tooltip
          formatter={(value) => [`${Number(value).toLocaleString()}円`, '預貯金予測']}
          labelFormatter={label => `${label}`}
          contentStyle={{ fontSize: 12, borderRadius: 12, borderColor: '#D8DEE8' }}
        />
        <ReferenceLine y={0} stroke="#E2544B" strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="none"
          fill="#1476B3"
          fillOpacity={0.08}
        />
        <Line
          type="monotone"
          dataKey="balance"
          stroke="#1476B3"
          strokeWidth={3}
          dot={false}
          activeDot={{ r: 5, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
