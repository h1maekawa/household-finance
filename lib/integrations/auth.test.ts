// Integration Token の認証・scope認可のテスト。
//
// 純関数部分（401/403 の分離、scope 判定）はそのまま検証し、
// DBに触る部分（hash照合・revoke・rotation・last_used_at）は
// 接続情報があるときだけ実行する。
import test from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { hashImportSecret, createIntegrationSecret } from '@/lib/import-secrets'
import { hasIntegrationScope, type IntegrationAuthContext } from '@/lib/server-auth'
import { effectiveScopes } from './scopes'

const gasToken: IntegrationAuthContext = {
  userId: 'user-1', tokenId: 't1', integration: 'gas',
  scopes: ['transactions:write'], legacy: false,
}
const aiToken: IntegrationAuthContext = {
  userId: 'user-1', tokenId: 't2', integration: 'ai_company',
  scopes: ['finance-summary:read', 'investment-capacity:read', 'assets:read'], legacy: false,
}
const legacyToken: IntegrationAuthContext = {
  userId: 'user-1', tokenId: null, integration: 'gas',
  scopes: ['transactions:write'], legacy: true,
}

test('GAS Token は取込だけ許可される', () => {
  assert.equal(hasIntegrationScope(gasToken, 'transactions:write'), true)
  assert.equal(hasIntegrationScope(gasToken, 'investment-capacity:read'), false)
  assert.equal(hasIntegrationScope(gasToken, 'finance-summary:read'), false)
  assert.equal(hasIntegrationScope(gasToken, 'assets:read'), false)
})

test('AI Company Token は読み取りだけ許可される', () => {
  assert.equal(hasIntegrationScope(aiToken, 'investment-capacity:read'), true)
  assert.equal(hasIntegrationScope(aiToken, 'finance-summary:read'), true)
  assert.equal(hasIntegrationScope(aiToken, 'assets:read'), true)
  assert.equal(hasIntegrationScope(aiToken, 'transactions:write'), false)
})

test('Legacy 環境変数Secretは取込だけ。全APIを呼べる状態にしない', () => {
  assert.equal(hasIntegrationScope(legacyToken, 'transactions:write'), true)
  assert.equal(hasIntegrationScope(legacyToken, 'investment-capacity:read'), false)
  assert.equal(legacyToken.tokenId, null)
  assert.equal(legacyToken.legacy, true)
})

test('Token が無ければ何の scope も持たない', () => {
  assert.equal(hasIntegrationScope(null, 'transactions:write'), false)
})

test('未知の scope を持たせても権限は広がらない', () => {
  const weird = { ...gasToken, scopes: ['admin:*'] as never }
  assert.equal(hasIntegrationScope(weird, 'transactions:write'), false)
})

/* ── 認証側の Defense in Depth ─────────────────────────── */

test('DBのscopeが壊れていても integration の許可範囲を超えない', () => {
  // GAS の行に assets:read が入っていても、取込権限だけが有効になる
  assert.deepEqual(
    effectiveScopes('gas', ['transactions:write', 'assets:read']),
    ['transactions:write']
  )
  // AI Company の行に書き込みが入っていても無効
  assert.deepEqual(
    effectiveScopes('ai_company', ['finance-summary:read', 'transactions:write']),
    ['finance-summary:read']
  )
})

test('未知の integration は権限ゼロ（fail-closed）', () => {
  assert.deepEqual(effectiveScopes('unknown', ['assets:read']), [])
  assert.deepEqual(effectiveScopes('', ['transactions:write']), [])
})

test('未知の scope 文字列で権限が広がらない', () => {
  assert.deepEqual(effectiveScopes('gas', ['admin:*', 'transactions:write']), ['transactions:write'])
  assert.deepEqual(effectiveScopes('gas', ['*']), [])
})

test('other は発行も権限も無い', () => {
  assert.deepEqual(effectiveScopes('other', ['assets:read']), [])
})

/* ── DB結合テスト（接続情報があるときだけ）────────────────── */

const dbUrl = process.env.SUPABASE_TEST_URL
const dbKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const testUserId = process.env.SUPABASE_TEST_USER_ID
const hasDb = Boolean(dbUrl && dbKey && testUserId)
const skip = hasDb
  ? false
  : 'SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY / SUPABASE_TEST_USER_ID が未設定'

/** resolveIntegrationAuth が見るのはヘッダーだけなので、最小のスタブで足りる */
function req(secret?: string): NextRequest {
  const headers = new Headers(secret ? { 'x-import-secret': secret } : {})
  return { headers } as unknown as NextRequest
}

test('Token の照合・revoke・rotation・last_used_at', { skip }, async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { resolveIntegrationAuth } = await import('@/lib/server-auth')
  const db = createClient(dbUrl!, dbKey!, { auth: { persistSession: false } })

  const secretA = createIntegrationSecret('gas')
  const secretB = createIntegrationSecret('gas')
  const rows = [secretA, secretB].map(s => ({
    user_id: testUserId!,
    secret_hash: hashImportSecret(s),
    label: 'test',
    integration: 'gas',
    scopes: ['transactions:write'],
  }))

  const { data: created, error } = await db.from('user_import_secrets').insert(rows).select('id')
  assert.equal(error, null)

  try {
    // 有効なTokenは認証でき、scope も取れる
    const authA = await resolveIntegrationAuth(req(secretA))
    assert.equal(authA?.userId, testUserId)
    assert.equal(authA?.integration, 'gas')
    assert.deepEqual(authA?.scopes, ['transactions:write'])
    assert.equal(authA?.legacy, false)

    // Rotation: A と B が併存し、どちらでも認証できる
    assert.ok(await resolveIntegrationAuth(req(secretB)))

    // 認証に成功したら last_used_at が入る
    const { data: usedA } = await db
      .from('user_import_secrets').select('last_used_at').eq('id', created![0].id).single()
    assert.ok(usedA?.last_used_at, 'last_used_at が更新されていない')

    // A を revoke すると A だけ通らなくなる
    await db.from('user_import_secrets')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', created![0].id)
    assert.equal(await resolveIntegrationAuth(req(secretA)), null)
    assert.ok(await resolveIntegrationAuth(req(secretB)), 'revoke が他のTokenへ波及している')

    // revoke しても行は残る（監査のため物理削除しない）
    const { data: revoked } = await db
      .from('user_import_secrets').select('revoked_at').eq('id', created![0].id).single()
    assert.ok(revoked?.revoked_at)

    // 不正なTokenと未指定は通らない
    assert.equal(await resolveIntegrationAuth(req('flow_gas_invalid')), null)
    assert.equal(await resolveIntegrationAuth(req()), null)
  } finally {
    await db.from('user_import_secrets').delete().in('id', created!.map(r => r.id))
  }
})

test('APIを通さずDBを直接叩いても scope escalation できない', { skip }, async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(dbUrl!, dbKey!, { auth: { persistSession: false } })

  const secret = createIntegrationSecret('gas')
  const { data: created, error } = await db
    .from('user_import_secrets')
    .insert([{
      user_id: testUserId!, secret_hash: hashImportSecret(secret), label: 'test-escalation',
      integration: 'gas', scopes: ['transactions:write'],
    }])
    .select('id').single()
  assert.equal(error, null)

  try {
    // service_role で scopes を書き換えても（＝最悪のケースでも）、
    // 認証Contextは integration の許可範囲までしか出さない
    await db.from('user_import_secrets')
      .update({ scopes: ['transactions:write', 'assets:read', 'finance-summary:read'] })
      .eq('id', created!.id)

    const { resolveIntegrationAuth } = await import('@/lib/server-auth')
    const auth = await resolveIntegrationAuth(req(secret))
    assert.deepEqual(auth?.scopes, ['transactions:write'], 'DBの改ざんが権限に反映されている')

    // 失効させたTokenは復活できない（トリガー）
    await db.from('user_import_secrets')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', created!.id)
    const revive = await db.from('user_import_secrets')
      .update({ is_active: true, revoked_at: null })
      .eq('id', created!.id)
    assert.notEqual(revive.error, null, '失効したTokenが復活できてしまう')
    assert.equal(await resolveIntegrationAuth(req(secret)), null)
  } finally {
    await db.from('user_import_secrets').delete().eq('id', created!.id)
  }
})
