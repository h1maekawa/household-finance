// 給与の二重加算の判定（detectSalaryDuplicate）と、投資可能額・30日予測の両方での使われ方。
// プロフィール給与：300,000円・25日。対象月 2026-11
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectSalaryDuplicate,
  SALARY_DUPLICATE_AMBIGUOUS_MESSAGE,
  SALARY_DUPLICATE_ITEM_LABEL,
} from './salary-duplicate'
import { computeObligations, salaryIncome } from './capacity-obligations'
import { projectCashflow, salaryDuplicateMissing } from '@/lib/cashflow'
import type { ResolvedScheduledPayment, ScheduledPayment } from '@/types/cashflow'

const PLANNED = 300000
const AMBIGUOUS = '給与が予定入金とプロフィールの月収の両方に登録されている可能性があります。どちらか一方にしてください'

test('文言は brief の文字列どおり', () => {
  assert.equal(SALARY_DUPLICATE_AMBIGUOUS_MESSAGE, AMBIGUOUS)
  assert.equal(SALARY_DUPLICATE_ITEM_LABEL, '給与（予定入金を使用・プロフィール月収と重複のため合成分は除外）')
})

// ---------------------------------------------------------------- 純関数

function income(name: string, date: string, amount: number, category: string | null = null) {
  return { id: `i-${name}-${date}`, name, category, date, amount }
}

test('detect：名前「給与」→ 一致（合成給与は足さない）', () => {
  const r = detectSalaryDuplicate({ planned: PLANNED, salaryDate: '2026-11-25', incomes: [income('給与', '2026-11-25', 300000)] })
  assert.equal(r.kind, 'match')
  assert.equal(r.includeSynthesizedSalary, false)
  assert.deepEqual(r.duplicateIds, ['i-給与-2026-11-25'])
  assert.deepEqual(r.missingData, [])
})

test('detect：給料・役員報酬・salary（大文字小文字を問わない）、カテゴリでも一致', () => {
  for (const [name, category] of [
    ['今月の給料', null],
    ['役員報酬', null],
    ['Monthly SALARY', null],
    ['振込', '給与'],
  ] as const) {
    const r = detectSalaryDuplicate({
      planned: PLANNED,
      salaryDate: '2026-11-25',
      incomes: [income(name, '2026-11-05', 10000, category)],
    })
    assert.equal(r.kind, 'match', name)
  }
})

test('detect：名前「振込」、24日、295,000（±3日・±10%以内）→ 一致', () => {
  const r = detectSalaryDuplicate({ planned: PLANNED, salaryDate: '2026-11-25', incomes: [income('振込', '2026-11-24', 295000)] })
  assert.equal(r.kind, 'match')
  assert.equal(r.includeSynthesizedSalary, false)
})

test('detect：名前「振込」、26日、150,000（±3日だが金額が10%外）→ あいまい', () => {
  const r = detectSalaryDuplicate({ planned: PLANNED, salaryDate: '2026-11-25', incomes: [income('振込', '2026-11-26', 150000)] })
  assert.equal(r.kind, 'ambiguous')
  assert.equal(r.includeSynthesizedSalary, false)
  assert.deepEqual(r.missingData, [AMBIGUOUS])
})

test('detect：±3日ちょうどは近い、4日は離れている', () => {
  assert.equal(
    detectSalaryDuplicate({ planned: PLANNED, salaryDate: '2026-11-25', incomes: [income('振込', '2026-11-28', 1)] }).kind,
    'ambiguous'
  )
  assert.equal(
    detectSalaryDuplicate({ planned: PLANNED, salaryDate: '2026-11-25', incomes: [income('振込', '2026-11-29', 1)] }).kind,
    'none'
  )
})

test('detect：名前「副業報酬」、10日、50,000 → 別収入（合成給与も足す）', () => {
  const r = detectSalaryDuplicate({ planned: PLANNED, salaryDate: '2026-11-25', incomes: [income('副業報酬', '2026-11-10', 50000)] })
  assert.equal(r.kind, 'none')
  assert.equal(r.includeSynthesizedSalary, true)
  assert.deepEqual(r.missingData, [])
})

test('detect：プロフィール給与なし → 判定しない', () => {
  const r = detectSalaryDuplicate({ planned: 0, salaryDate: null, incomes: [income('給与', '2026-11-25', 300000)] })
  assert.equal(r.kind, 'none')
  assert.equal(r.includeSynthesizedSalary, false)
})

test('detect：別の月の入金は見ない', () => {
  const r = detectSalaryDuplicate({ planned: PLANNED, salaryDate: '2026-11-25', incomes: [income('給与', '2026-12-25', 300000)] })
  assert.equal(r.kind, 'none')
  assert.equal(r.includeSynthesizedSalary, true)
})

// ---------------------------------------------------------------- 投資可能額（computeObligations）

function resolvedIncome(name: string, date: string, amount: number): ResolvedScheduledPayment {
  return {
    id: `sp-${name}`,
    name,
    amount,
    due_day: Number(date.slice(8, 10)),
    category: '収入',
    type: 'income',
    is_active: true,
    payment_method: 'bank_debit',
    debit_account_id: null,
    last_paid_month: null,
    created_at: '2026-01-01T00:00:00Z',
    resolvedDueDate: date,
    resolvedAmountYen: amount,
    debitAccountName: null,
  }
}

function capacity(scheduled: ResolvedScheduledPayment[], planned = PLANNED) {
  return computeObligations({
    today: '2026-11-05',
    monthEnd: '2026-11-30',
    scheduled,
    cardCycles: [],
    matchedFixedCostIds: new Set(),
    balanceDateByAccount: new Map([['a', '2026-11-05']]),
    oldestBalanceDate: '2026-11-05',
    salary: salaryIncome({ month: '2026-11', planned, actual: 0, incomeDay: 25 }),
    salaryPlanned: planned,
  })
}

test('投資可能額：「給与」300,000（25日）＋プロフィール 300,000 → 300,000 だけ、内訳に注記', () => {
  const r = capacity([resolvedIncome('給与', '2026-11-25', 300000)])
  assert.equal(r.expectedIncome, 300000)
  assert.deepEqual(
    r.items.filter(i => i.kind === 'income'),
    [{ label: SALARY_DUPLICATE_ITEM_LABEL, amount: 300000, kind: 'income' }]
  )
  assert.deepEqual(r.missingData, [])
})

test('投資可能額：「振込」24日 295,000 → 一致、295,000 だけ', () => {
  const r = capacity([resolvedIncome('振込', '2026-11-24', 295000)])
  assert.equal(r.expectedIncome, 295000)
  assert.deepEqual(r.missingData, [])
})

test('投資可能額：「振込」26日 150,000 → あいまい、150,000 だけ＋missing_data', () => {
  const r = capacity([resolvedIncome('振込', '2026-11-26', 150000)])
  assert.equal(r.expectedIncome, 150000)
  assert.deepEqual(r.missingData, [AMBIGUOUS])
})

test('投資可能額：「副業報酬」10日 50,000 → 給与 300,000 ＋ 50,000', () => {
  const r = capacity([resolvedIncome('副業報酬', '2026-11-10', 50000)])
  assert.equal(r.expectedIncome, 350000)
  assert.deepEqual(r.missingData, [])
})

test('投資可能額：プロフィール給与なし → 予定入金だけ（従来どおり）', () => {
  const r = capacity([resolvedIncome('給与', '2026-11-25', 300000)], 0)
  assert.equal(r.expectedIncome, 300000)
  assert.deepEqual(r.items.filter(i => i.kind === 'income').map(i => i.label), ['給与'])
  assert.deepEqual(r.missingData, [])
})

// ---------------------------------------------------------------- 30日予測（projectCashflow）

function scheduledIncome(name: string, day: number, amount: number): ScheduledPayment {
  return {
    id: `sp-${name}`,
    name,
    amount,
    due_day: day,
    category: '収入',
    type: 'income',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
  }
}

const PROJECTION = { monthlyIncome: PLANNED, incomeDay: 25, today: new Date(2026, 10, 1) } // 2026-11-01 起点

function projectedIncome(payments: ScheduledPayment[], options: Partial<typeof PROJECTION> = {}) {
  const days = projectCashflow(0, payments, 30, { ...PROJECTION, ...options })
  return days[days.length - 1].balance
}

test('30日予測：「給与」300,000（25日）＋プロフィール 300,000 → 300,000 だけ', () => {
  const payments = [scheduledIncome('給与', 25, 300000)]
  assert.equal(projectedIncome(payments), 300000)
  assert.deepEqual(salaryDuplicateMissing(payments, 30, PROJECTION), [])
})

test('30日予測：「振込」24日 295,000 → 295,000 だけ', () => {
  const payments = [scheduledIncome('振込', 24, 295000)]
  assert.equal(projectedIncome(payments), 295000)
  assert.deepEqual(salaryDuplicateMissing(payments, 30, PROJECTION), [])
})

test('30日予測：「振込」26日 150,000 → 150,000 だけ＋missing', () => {
  const payments = [scheduledIncome('振込', 26, 150000)]
  assert.equal(projectedIncome(payments), 150000)
  assert.deepEqual(salaryDuplicateMissing(payments, 30, PROJECTION), [AMBIGUOUS])
})

test('30日予測：「副業報酬」10日 50,000 → 300,000 ＋ 50,000', () => {
  const payments = [scheduledIncome('副業報酬', 10, 50000)]
  assert.equal(projectedIncome(payments), 350000)
  assert.deepEqual(salaryDuplicateMissing(payments, 30, PROJECTION), [])
})

test('30日予測：プロフィール給与なし → 予定入金だけ', () => {
  const payments = [scheduledIncome('給与', 25, 300000)]
  assert.equal(projectedIncome(payments, { monthlyIncome: 0 }), 300000)
  assert.deepEqual(salaryDuplicateMissing(payments, 30, { ...PROJECTION, monthlyIncome: 0 }), [])
})

test('30日予測：月ごとに判定する（11月は重複、12月は予定入金なし → 12月は合成給与）', () => {
  const payments = [{ ...scheduledIncome('給与', 25, 300000), scheduled_date: '2026-11-25' }]
  const days = projectCashflow(0, payments, 60, PROJECTION)
  assert.equal(days.find(d => d.date === '2026-11-25')?.balance, 300000)
  assert.equal(days.find(d => d.date === '2026-12-25')?.balance, 600000)
})
