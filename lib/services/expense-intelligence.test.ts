import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeExpenses,
  getExpenseTrendState,
  isValueTag,
  reviewCandidates,
  VALUE_TAG_LABEL,
  type ExpenseIntelligenceInput,
} from './expense-intelligence'

function input(over: Partial<ExpenseIntelligenceInput> = {}): ExpenseIntelligenceInput {
  return {
    currentMonth: {}, previousMonth: {}, threeMonthTotal: {},
    transactionCount: {}, budgets: {}, valueTags: {}, fixedCategories: ['住居費', '通信費'],
    ...over,
  }
}

test('カテゴリ別の今月・先月・3ヶ月平均・年間換算が出る', () => {
  const [row] = analyzeExpenses(input({
    currentMonth: { タバコ: 18000 },
    previousMonth: { タバコ: 15000 },
    threeMonthTotal: { タバコ: 48600 },
    transactionCount: { タバコ: 12 },
  }))
  assert.equal(row.category, 'タバコ')
  assert.equal(row.currentMonth, 18000)
  assert.equal(row.previousMonth, 15000)
  assert.equal(row.threeMonthAverage, 16200)
  assert.equal(row.annualized, 216000)
  assert.equal(row.transactionCount, 12)
  assert.equal(row.previousMonthDifference, 3000)
  assert.equal(row.averageDifference, 1800)
})

test('予算未設定は0円ではなく null', () => {
  const [row] = analyzeExpenses(input({ currentMonth: { 食費: 30000 } }))
  assert.equal(row.budget, null)
  assert.equal(row.budgetDifference, null)
  assert.ok(!row.candidateReason.includes('over_budget'))
})

test('予算超過は見直し候補の理由になる', () => {
  const [row] = analyzeExpenses(input({
    currentMonth: { 食費: 42000 }, budgets: { 食費: 35000 },
  }))
  assert.equal(row.budgetDifference, -7000)
  assert.ok(row.candidateReason.includes('over_budget'))
  assert.equal(row.reviewCandidate, true)
})

test('変動費は15%超、固定費は5%超で増加とみなす', () => {
  // 変動費: 10%増は誤差の範囲
  assert.equal(getExpenseTrendState(11000, 10000), 'flat')
  assert.equal(getExpenseTrendState(12000, 10000), 'increased')
  // 固定費は毎月ほぼ同額なので少しの増加でも意味がある
  assert.equal(getExpenseTrendState(10600, 10000, { isFixed: true }), 'increased')
})

test('比較対象が0円のときは増加と判定しない', () => {
  assert.equal(getExpenseTrendState(5000, 0), 'flat')
  const [row] = analyzeExpenses(input({ currentMonth: { 酒: 5000 } }))
  assert.ok(!row.candidateReason.includes('increased_from_previous_month'))
})

test('価値タグはユーザー設定が正。システムが決めない', () => {
  const rows = analyzeExpenses(input({
    currentMonth: { タバコ: 18000, 外食: 20000 },
    valueTags: { タバコ: 'review' },
  }))
  const tobacco = rows.find(r => r.category === 'タバコ')!
  const dining = rows.find(r => r.category === '外食')!
  assert.equal(tobacco.valueTag, 'review')
  assert.ok(tobacco.candidateReason.includes('tagged_for_review'))
  // 設定していないカテゴリを勝手に review にしない
  assert.equal(dining.valueTag, null)
  assert.ok(!dining.candidateReason.includes('tagged_for_review'))
})

test('実績が0円のカテゴリは候補に挙げない', () => {
  const [row] = analyzeExpenses(input({
    currentMonth: { タバコ: 0 }, previousMonth: { タバコ: 15000 }, valueTags: { タバコ: 'review' },
  }))
  assert.equal(row.reviewCandidate, false)
  assert.deepEqual(row.candidateReason, [])
})

test('見直し候補は金額の大きい順', () => {
  const rows = analyzeExpenses(input({
    currentMonth: { 外食: 30000, タバコ: 18000, 食費: 50000 },
    budgets: { 外食: 20000, タバコ: 10000 },
  }))
  const candidates = reviewCandidates(rows)
  assert.deepEqual(candidates.map(r => r.category), ['外食', 'タバコ'])
})

test('「削るべき」ではなく「見直し候補」の語彙を使う', () => {
  assert.equal(VALUE_TAG_LABEL.review, '見直し候補')
  assert.equal(VALUE_TAG_LABEL.essential, '必須')
  assert.equal(VALUE_TAG_LABEL.flexible, '改善可能')
  assert.equal(VALUE_TAG_LABEL.enjoyment, '楽しみ')
})

test('不正な価値タグを受け付けない', () => {
  assert.equal(isValueTag('review'), true)
  assert.equal(isValueTag('delete_it'), false)
  assert.equal(isValueTag(null), false)
})
