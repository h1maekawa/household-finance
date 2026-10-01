import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const readRoute = (name: string) => readFileSync(
  path.join(process.cwd(), `app/api/integrations/${name}/route.ts`),
  'utf8'
)

test('finance summary は専用scopeを必須にし、既存loaderをcomposeする', () => {
  const src = readRoute('finance-summary')
  assert.match(src, /requireIntegrationScope\(request, 'finance-summary:read'\)/)
  assert.match(src, /loadAssetPlanning/)
  assert.match(src, /loadCashflow/)
  assert.doesNotMatch(src, /transactions:write/)
})

test('card activity は専用scope・列限定・no-store', () => {
  const src = readRoute('card-activity')
  assert.match(src, /requireIntegrationScope\(request, 'card-activity:read'\)/)
  assert.match(src, /select\('id,date,memo,amount,card_issuer,payment_method,category,needs_review'\)/)
  assert.match(src, /private, no-store/)
  assert.doesNotMatch(src, /select\('\*'\)/)
  assert.doesNotMatch(src, /external_id/)
})

test('debts は既存assets scopeを再利用し、必要最小限の列と集計だけを返す', () => {
  const src = readRoute('debts')
  assert.match(src, /requireIntegrationScope\(request, 'assets:read'\)/)
  assert.match(src, /select\('id,direction,counterparty,amount,date,due_date,memo,is_settled'\)/)
  assert.match(src, /\.eq\('user_id', result\.auth\.userId\)/)
  assert.match(src, /searchParams\.get\('include'\) === 'all'/)
  assert.match(src, /if \(!includeSettled\) query = query\.eq\('is_settled', false\)/)
  assert.match(src, /totals/)
  assert.match(src, /private, no-store/)
  assert.doesNotMatch(src, /select\('\*'\)/)
})

test('debts の認証境界はGAS書込TokenとAI Company読取Tokenを分離する', async () => {
  const { effectiveScopes } = await import('./scopes')
  assert.deepEqual(effectiveScopes('gas', ['transactions:write']), ['transactions:write'])
  assert.ok(!effectiveScopes('gas', ['transactions:write']).includes('assets:read'))
  assert.ok(effectiveScopes('ai_company', ['assets:read']).includes('assets:read'))
  assert.ok(!effectiveScopes('ai_company', ['assets:read']).includes('transactions:write'))
})

test('debts の集計契約は方向別で、精算済み除外後のitemsだけを対象にする', () => {
  const rows = [
    { direction: 'borrowed', amount: 1200, is_settled: false },
    { direction: 'lent', amount: 3000, is_settled: false },
    { direction: 'borrowed', amount: 9000, is_settled: true },
  ] as const
  const items = rows.filter((row) => !row.is_settled)
  const totals = items.reduce((sum, row) => {
    sum[row.direction] += row.amount
    return sum
  }, { borrowed: 0, lent: 0 })
  assert.deepEqual(totals, { borrowed: 1200, lent: 3000 })
})
