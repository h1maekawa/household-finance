import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOWED_SCOPES,
  INTEGRATION_SCOPES,
  isKnownScope,
  normalizeScopes,
  scopesForIntegration,
} from './scopes'

test('scope の定義が4種そろっている', () => {
  assert.deepEqual([...INTEGRATION_SCOPES], [
    'transactions:write',
    'finance-summary:read',
    'investment-capacity:read',
    'assets:read',
  ])
})

test('GAS は取込専用。読み取り系を持たない', () => {
  assert.deepEqual([...ALLOWED_SCOPES.gas], ['transactions:write'])
})

test('AI Company は read-only。書き込みを持たない', () => {
  assert.ok(!ALLOWED_SCOPES.ai_company.includes('transactions:write' as never))
  assert.deepEqual([...ALLOWED_SCOPES.ai_company], [
    'finance-summary:read',
    'investment-capacity:read',
    'assets:read',
  ])
})

test('未知の scope は権限として数えない（fail-closed）', () => {
  assert.equal(isKnownScope('transactions:delete'), false)
  assert.deepEqual(
    normalizeScopes(['transactions:write', 'admin:*', 'assets:read']),
    ['transactions:write', 'assets:read']
  )
})

test('未知の値が入っていてもクラッシュしない', () => {
  assert.deepEqual(normalizeScopes(null), [])
  assert.deepEqual(normalizeScopes('transactions:write'), [])
  assert.deepEqual(normalizeScopes([1, {}, null]), [])
})

test('scope はサーバー側の allowlist で決まる（escalation 防止）', () => {
  assert.deepEqual(scopesForIntegration('gas'), ['transactions:write'])
  // クライアントが勝手な integration を指定しても scope は付かない
  assert.deepEqual(scopesForIntegration('admin'), [])
  assert.deepEqual(scopesForIntegration('other'), [])
})
