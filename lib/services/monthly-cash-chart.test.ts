// 月別見通しグラフのデータ。開始残高が不明なときに ¥0 の棒を描かない（T16-chart）
import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyCashChartData } from './monthly-cash-chart'
import type { DailyBalance } from '@/types/cashflow'

const months = [new Date(2026, 10, 1), new Date(2026, 11, 1)]

test('開始残高が不明（null）なら月別見通しのデータを作らない（0円の棒を描かない）', () => {
  assert.deepEqual(
    monthlyCashChartData({ months, projectedDays: [], startingBalance: null, investmentValue: 500000 }),
    []
  )
})

test('予測の日が無い月は開始残高で埋める（0円にしない）', () => {
  const days: DailyBalance[] = [
    {
      date: '2026-11-27',
      balance: 820000,
      isNegative: false,
      payments: [{ id: 'r', name: '家賃', amount: 80000, due_day: 27, category: '住居費', type: 'fixed', is_active: true, created_at: '' }],
    },
  ]
  const data = monthlyCashChartData({ months, projectedDays: days, startingBalance: 900000, investmentValue: 100000 })
  assert.deepEqual(data, [
    { month: '11月', totalAssets: 920000, cash: 820000, expense: 80000 },
    { month: '12月', totalAssets: 1000000, cash: 900000, expense: 0 },
  ])
})

test('UpcomingPayments は開始残高不明を ¥0 として月別見通しに使わない', async () => {
  const { readFileSync } = await import('node:fs')
  const component = readFileSync('components/UpcomingPayments.tsx', 'utf8')
  assert.doesNotMatch(component, /currentCash \?\? 0/)
  assert.match(component, /monthlyCashChartData\(/)
})
