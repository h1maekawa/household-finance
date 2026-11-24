// 最終レビューのシナリオ（2026-11-24 PR-1 final review）を、ローダーと同じ組み立て
// （buildCapacityObligations → computeInvestmentCapacity）で通す。
// 数字は固定。実装が違う数字を出したら、期待値を変えずに差を説明すること。
//
// 今日 2026-11-28、対象月 2026-11
//   口座A ¥900,000（記録 11/27、給与口座だがシステム上は不明）
//   口座B ¥400,000（記録 11/20）
//   給与 ¥300,000（25日、実績0）
//   SMBC（15日締め・10日払い・引落A）: 9/20 ¥50k（11/10 引落済み）、10/20 ¥80k（確定請求 ¥82k・12/10）、
//     締め前 ¥20k（1/12 引落）
//   楽天カード（月末締め・27日払い・引落B）: ¥40k（11/27 引落）、締め前 ¥15k
//   口座積立 ¥30k（11/27・A・買付11/27）、楽天カード積立 ¥50k（11/1・買付11/1・カード利用は未取込）
//   自動車保険（年払い）¥60k 11/30 B、USD保険 ¥16k 11/27 A、家賃 ¥80k 11/27 B、
//   Netflix ¥1,590（カード払い・11/29・未請求）
//   残り生活費 ¥30k、予備費 ¥100k、必要防衛資金 ¥600k、貯蓄目標 ¥50k、投資目標 ¥100k
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCapacityObligations } from './capacity-obligations'
import { A, B, TODAY, MONTH, cards, payment, transactions, runScenario } from './__fixtures__/capacity-scenario'
import type { ResolvedScheduledPayment } from '@/types/cashflow'

test('シナリオ：最終レビューの数字（入金0・カード208,590・固定費156,000・投資30,000・投資可能額775,410）', () => {
  const { obligations, investmentDeducted, capacity } = runScenario('2026-11-20T09:00:00+09:00')

  // 内訳を先に出しておく（違ったときに1円ずつ説明できるように）
  const items = obligations.items.map(i => `${i.kind}:${i.label}:${i.amount}`)
  assert.equal(obligations.expectedIncome, 0, items.join('\n'))
  assert.equal(obligations.cardUnpaid, 208590, items.join('\n'))
  assert.equal(obligations.fixedUnpaid + obligations.scheduledUnpaid, 156000, items.join('\n'))
  assert.equal(investmentDeducted, 30000)
  assert.equal(capacity.personal_cash_floor, 130000)
  assert.equal(capacity.investable_amount, 775410)
  assert.deepEqual(capacity.allocation, {
    emergency_fund: 600000,
    savings: 50000,
    asset_building: 100000,
    unallocated_cash: 25410,
  })
})

// I-5 を同じ組み立て（buildCapacityObligations）で確認する
test('I-5 組み立て：カード払いの変動額の固定費は直近3か月の照合額の平均で1回差し引き、決められないものは missing_data', () => {
  const variable = [
    payment({
      id: 'gas',
      name: 'ガス代',
      category: '保険',
      payment_method: 'credit_card',
      credit_card_id: 'rakuten',
      amount_type: 'variable',
      due_day: 5,
      amount: 0,
      resolvedDueDate: '2026-11-05',
      resolvedAmountYen: 0,
    }),
    payment({ id: 'water', name: '水道代', category: '保険', amount_type: 'variable', amount: 0, resolvedAmountYen: 0, debit_account_id: B }),
  ]
  const match = (month: string, amount: number) => ({
    paymentId: 'gas',
    paymentName: 'ガス代',
    amount,
    paymentDate: `${month}-27`,
    month,
    transactionIds: [`g-${month}`],
  })
  const { obligations } = buildCapacityObligations({
    today: TODAY,
    month: MONTH,
    monthEnd: '2026-11-30',
    payments: variable,
    creditCards: cards,
    transactions: [],
    fixedCostMatches: [match('2026-08', 5000), match('2026-09', 4000), match('2026-10', 6000)],
    buys: [],
    balanceDateByAccount: new Map([[A, '2026-11-27'], [B, '2026-11-20']]),
    oldestBalanceDate: '2026-11-20',
    fixedNames: ['保険'],
    salary: null,
  })
  assert.ok(obligations)
  assert.equal(obligations.cardUnpaid, 5000) // (5,000 + 4,000 + 6,000) ÷ 3、楽天 12/28 引落
  assert.ok(obligations.items.some(i => i.kind === 'card' && i.label === 'ガス代（2026-12-28引落）' && i.amount === 5000))
  assert.equal(obligations.fixedUnpaid, 0)
  assert.deepEqual(obligations.missingData, ['変動額の固定費「水道代」の金額が不明です'])
})
