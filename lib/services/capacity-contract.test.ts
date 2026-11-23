// Investment Capacity API の契約テスト。
// 金融値をDBエラーや独自ルールから作らないことを、コードの形として固定する。
//
// 入力の組み立て(I/O)は lib/services/capacity-input.ts の loadCapacityInput に一本化した。
// テーブルごとのエラー確認やカード請求の判定は、そちらを対象に確認する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), 'utf8')
}

const route = read('app/api/integrations/investment-capacity/route.ts')
const assetPlanningLoader = read('lib/services/asset-planning-loader.ts')
const capacityInput = read('lib/services/capacity-input.ts')
const capacityObligations = read('lib/services/capacity-obligations.ts')
const scheduledLoader = read('lib/services/scheduled-payments-loader.ts')

test('DB取得失敗を0円として計算に流さない', () => {
  assert.match(capacityInput, /if \(res\.error\) throw new Error/)
  for (const table of ['investment_transactions', 'users_profile', 'credit_cards', 'transactions']) {
    assert.ok(capacityInput.includes(`'${table}'`), `${table} のエラー確認が無い`)
  }
  // 予定支払いは共通ローダー経由。ローダー側で取得失敗を throw する
  assert.match(capacityInput, /loadResolvedScheduledPayments\(/)
  assert.match(scheduledLoader, /if \(paymentsRes\.error\) \{\s*throw new Error\(`scheduled_payments の取得に失敗しました/)
})

test('カード請求の判定を独自に持たない', () => {
  for (const source of [capacityInput, capacityObligations]) {
    assert.doesNotMatch(source, /function isCardBill\(/)
    // 名前や memo からの推測をしない
    assert.doesNotMatch(source, /includes\('カード'\)/)
  }
  assert.match(capacityObligations, /isCardBillPayment\(payment\)/)
  assert.doesNotMatch(capacityObligations, /type === 'credit'/)
})

test('流動現金は共通ローダーから取る（複数口座・F16）', () => {
  assert.match(capacityInput, /loadLiquidCash\(userId, supabase\)/)
  for (const source of [capacityInput, route]) {
    assert.doesNotMatch(source, /from\('account_balance'\)/)
  }
})

test('投資可能額の入力は loadCapacityInput に一本化する', () => {
  for (const [name, source] of [
    ['route.ts', route],
    ['asset-planning-loader.ts', assetPlanningLoader],
  ] as const) {
    assert.match(source, /loadCapacityInput\(/, `${name} が loadCapacityInput を使っていない`)
    assert.doesNotMatch(source, /from\('scheduled_payments'\)/, `${name} が予定支払いを直接読んでいる`)
  }
})

test('DBの詳細をクライアントへ返さない', () => {
  assert.doesNotMatch(route, /error:\s*message/)
  assert.match(route, /readFailed\(/)
})

test('月末日を31日で固定しない', () => {
  assert.doesNotMatch(capacityInput, /`\$\{month\}-31`/)
  assert.match(capacityInput, /monthEnd\(month\)/)
})

test('算出時刻はI/O境界で付ける（後方互換）', () => {
  // 1リクエストで1つの now を使う。鮮度判定と calculated_at を同じ時刻にする
  assert.match(route, /const now = new Date\(\)/)
  assert.match(route, /calculated_at: now\.toISOString\(\)/)
  assert.match(route, /loadCapacityInput\(userId, month, now, supabaseAdmin\)/)
})

test('M-3 本番で使わない sumInvestedAfterBalance を残さない（投資の控除は computeInvestmentOutflows だけ）', () => {
  assert.doesNotMatch(capacityObligations, /sumInvestedAfterBalance/)
  assert.match(capacityObligations, /export function computeInvestmentOutflows\(/)
})
