// Investment Capacity API の契約テスト。
// 金融値をDBエラーや独自ルールから作らないことを、コードの形として固定する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const route = readFileSync(
  path.join(process.cwd(), 'app/api/integrations/investment-capacity/route.ts'),
  'utf8'
)

test('DB取得失敗を0円として計算に流さない', () => {
  assert.match(route, /if \(res\.error\) throw new Error/)
  for (const table of ['scheduled_payments', 'investment_transactions', 'users_profile']) {
    assert.ok(route.includes(`'${table}'`), `${table} のエラー確認が無い`)
  }
})

test('カード請求の判定を独自に持たない', () => {
  assert.doesNotMatch(route, /function isCardBill\(/)
  assert.match(route, /isCardBillPayment\(payment\)/)
  // 名前や memo からの推測をしない
  assert.doesNotMatch(route, /includes\('カード'\)/)
})

test('流動現金は共通ローダーから取る', () => {
  assert.match(route, /loadLiquidCash\(userId, supabaseAdmin\)/)
  assert.doesNotMatch(route, /from\('account_balance'\)/)
})

test('DBの詳細をクライアントへ返さない', () => {
  assert.doesNotMatch(route, /error:\s*message/)
  assert.match(route, /readFailed\(/)
})

test('算出時刻はI/O境界で付ける（後方互換）', () => {
  assert.match(route, /calculated_at: new Date\(\)\.toISOString\(\)/)
})
