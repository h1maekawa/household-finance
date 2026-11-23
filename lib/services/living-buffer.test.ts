import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLivingBuffer } from '@/lib/services/living-buffer'
import { summarizeVariableSpendingInRange } from '@/lib/services/budget-engine'
import type { BudgetTransaction } from '@/types/budget'

const MISSING = '直近90日分の支出データが不足しているため、固定予備費を使用しました'

test('rolling 90d larger than fixed buffer wins', () => {
  const r = computeLivingBuffer({ variableSpend90d: 270000, dataCoverageDays: 90, fixedBuffer: 30000 })
  assert.equal(r.rolling30d, 108000)
  assert.equal(r.amount, 108000)
  assert.equal(r.basis, 'rolling_90d')
  assert.deepEqual(r.missingData, [])
})

test('fixed buffer wins when larger', () => {
  const r = computeLivingBuffer({ variableSpend90d: 45000, dataCoverageDays: 90, fixedBuffer: 30000 })
  assert.equal(r.rolling30d, 18000)
  assert.equal(r.amount, 30000)
  assert.equal(r.basis, 'fixed')
})

test('insufficient coverage falls back to fixed buffer', () => {
  const r = computeLivingBuffer({ variableSpend90d: 270000, dataCoverageDays: 40, fixedBuffer: 30000 })
  assert.equal(r.rolling30d, null)
  assert.equal(r.amount, 30000)
  assert.equal(r.basis, 'fixed')
  assert.deepEqual(r.missingData, [MISSING])
})

test('null spend falls back to fixed buffer', () => {
  const r = computeLivingBuffer({ variableSpend90d: null, dataCoverageDays: 90, fixedBuffer: 30000 })
  assert.equal(r.rolling30d, null)
  assert.equal(r.amount, 30000)
  assert.equal(r.basis, 'fixed')
  assert.deepEqual(r.missingData, [MISSING])
})

test('summarizeVariableSpendingInRange applies the same exclusions, inclusive range', () => {
  const t = (p: Partial<BudgetTransaction> & { id: string; amount: number }): BudgetTransaction => ({
    date: '2026-07-10', category: '食費', kind: 'expense', ...p,
  })
  const txs = [
    t({ id: 'a', amount: 1000 }),
    t({ id: 'b', amount: 2000, date: '2026-07-01' }),
    t({ id: 'c', amount: 4000, date: '2026-07-31' }),
    t({ id: 'out', amount: 9999, date: '2026-08-01' }),
    t({ id: 'inv', amount: 5000, category: '投資' }),
    t({ id: 'fix', amount: 6000, category: '住居費' }),
    t({ id: 'sched', amount: 7000, scheduled_payment_id: 's1' }),
    t({ id: 'inc', amount: 8000, kind: 'income' }),
    t({ id: 'card', amount: 3000, category: 'クレカ請求' }),
    t({ id: 'ex', amount: 300 }),
  ]
  const r = summarizeVariableSpendingInRange(txs, {
    from: '2026-07-01', to: '2026-07-31', fixedNames: ['住居費', '投資'], excludeTransactionIds: ['ex'],
  })
  assert.equal(r.total, 7000)
  assert.deepEqual(r.byCategory, { 食費: 7000 })
})
