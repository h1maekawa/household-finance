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
