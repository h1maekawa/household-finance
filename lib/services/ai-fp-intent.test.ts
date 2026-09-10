import test from 'node:test'
import assert from 'node:assert/strict'
import {
  QUICK_QUESTIONS,
  expenseCutQuestion,
  parseFinancialQuestion,
  parseReductionRatio,
  parseYenAmount,
} from './ai-fp-intent'

const CATEGORIES = ['食費', '外食', 'タバコ', 'コンビニ', '住居', '娯楽']

// ---------------------------------------------------------------- 金額の解析

test('日本語の金額を円にする', () => {
  assert.equal(parseYenAmount('毎月+2万円投資したら？'), 20_000)
  assert.equal(parseYenAmount('3,000万円まで何年？'), 30_000_000)
  assert.equal(parseYenAmount('500万円まであと何ヶ月？'), 5_000_000)
  assert.equal(parseYenAmount('20,000円'), 20_000)
  assert.equal(parseYenAmount('副業が月5万円増えたら？'), 50_000)
  assert.equal(parseYenAmount('1億円ためたい'), 100_000_000)
})

test('金額が無ければ null。0円にしない', () => {
  assert.equal(parseYenAmount('今月使いすぎ？'), null)
  assert.equal(parseYenAmount(''), null)
  assert.equal(parseYenAmount('0円にしたら'), null)
})

test('削減率を読む', () => {
  assert.equal(parseReductionRatio('タバコを半分にしたら？'), 0.5)
  assert.equal(parseReductionRatio('外食を30%減らしたら'), 0.3)
  assert.equal(parseReductionRatio('外食を3割減らしたら'), 0.3)
  assert.equal(parseReductionRatio('タバコをやめたら'), 1)
})

test('削減率が読めなければ null。勝手に半分と決めない', () => {
  assert.equal(parseReductionRatio('外食を減らしたら'), null)
  assert.equal(parseReductionRatio('120%減らす'), null)
})

// ---------------------------------------------------------------- §32 定型質問

test('定型質問がすべて意図に落ちる', () => {
  const expected: Record<string, string> = {
    '今月使いすぎ？': 'explain',
    'どこを見直せそう？': 'review',
    '500万円まであと何ヶ月？': 'goal_eta',
    '3,000万円まで何年？': 'goal_eta',
    '毎月+2万円投資したら？': 'scenario_contribution',
    '副業が月5万円増えたら？': 'scenario_extra_income',
    '今月何をすればいい？': 'actions',
  }
  for (const question of QUICK_QUESTIONS) {
    const intent = parseFinancialQuestion(question, CATEGORIES)
    assert.equal(intent.kind, expected[question], `${question} が ${intent.kind} になった`)
  }
})

test('カテゴリ入りの定型質問も落ちる', () => {
  const intent = parseFinancialQuestion(expenseCutQuestion('タバコ'), CATEGORIES)
  assert.deepEqual(intent, { kind: 'scenario_expense_cut', category: 'タバコ', ratio: 0.5 })
})

// ---------------------------------------------------------------- 意図の判定

test('投資と貯金を取り違えない', () => {
  assert.deepEqual(parseFinancialQuestion('毎月+2万円投資したら？', CATEGORIES), {
    kind: 'scenario_contribution',
    field: 'investment',
    monthlyAmount: 20_000,
  })
  assert.deepEqual(parseFinancialQuestion('毎月1万円貯金を増やしたら？', CATEGORIES), {
    kind: 'scenario_contribution',
    field: 'savings',
    monthlyAmount: 10_000,
  })
})

test('目標額の質問を積立の質問と混同しない', () => {
  const intent = parseFinancialQuestion('3,000万円まで何年？', CATEGORIES)
  assert.deepEqual(intent, { kind: 'goal_eta', targetAssets: 30_000_000 })
})

test('ユーザーが持たないカテゴリは扱わない', () => {
  // カテゴリ名をシステム側で決め打ちしない
  const intent = parseFinancialQuestion('タバコを半分にしたら？', ['食費', '住居'])
  assert.equal(intent.kind, 'explain')
})

test('カテゴリはあるが削減率が読めなければ推測しない', () => {
  const intent = parseFinancialQuestion('外食を減らしたらどうなる？', CATEGORIES)
  assert.notEqual(intent.kind, 'scenario_expense_cut')
})

test('長いカテゴリ名を優先する', () => {
  const intent = parseFinancialQuestion('外食費を半分にしたら？', ['外食', '外食費'])
  assert.deepEqual(intent, { kind: 'scenario_expense_cut', category: '外食費', ratio: 0.5 })
})

test('判断できない質問は説明だけに落とす', () => {
  for (const question of ['今月どう？', 'こんにちは', '']) {
    assert.equal(parseFinancialQuestion(question, CATEGORIES).kind, 'explain')
  }
})

test('カテゴリ一覧を渡さなくても壊れない', () => {
  assert.equal(parseFinancialQuestion('タバコを半分にしたら？').kind, 'explain')
})
