// Token 発行・失効の DB 側ハードニングを固定するテスト。
//
// scope のサーバー決定は API だけでは不十分で、Supabase の REST を直接
// 叩けば自分のToken行を書き換えられてしまう。027 がそれを塞いでいることを、
// SQL の構造として確認する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ALLOWED_SCOPES } from './scopes'

const sql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/027_integration_token_hardening.sql'),
  'utf8'
)

test('authenticated からの直接書き込み権限を剥がしている', () => {
  assert.match(sql, /revoke insert, update, delete on user_import_secrets from authenticated/)
  for (const policy of ['insert_own', 'update_own', 'delete_own']) {
    assert.match(sql, new RegExp(`drop policy if exists ${policy} on user_import_secrets`))
  }
  // 読み取りは残す（自分のTokenのmetadataは見えてよい）
  assert.match(sql, /grant select on user_import_secrets to authenticated/)
})

test('発行は SECURITY DEFINER の関数を通す', () => {
  assert.match(sql, /create or replace function issue_integration_token[\s\S]*?security definer/)
  assert.match(sql, /set search_path = public/)
  // 対象ユーザーは関数内で決める。クライアントから user_id を受け取らない
  assert.match(sql, /v_user uuid := auth\.uid\(\)/)
  assert.doesNotMatch(sql, /issue_integration_token\(\s*p_user_id/)
})

test('発行関数は scopes を引数で受け取らない', () => {
  const signature = sql.slice(
    sql.indexOf('function issue_integration_token'),
    sql.indexOf('returns jsonb')
  )
  assert.doesNotMatch(signature, /p_scopes/)
})

test('発行関数の scope は ALLOWED_SCOPES と一致する', () => {
  // SQL と TS で正が二重にならないよう、ここで突き合わせる。
  // SQL は発行の権限、TS は認可時の絞り込みに使う
  const body = sql.slice(sql.indexOf('v_scopes := case'), sql.indexOf('if v_scopes is null'))
  for (const [integration, scopes] of Object.entries(ALLOWED_SCOPES)) {
    if (scopes.length === 0) {
      assert.doesNotMatch(body, new RegExp(`when '${integration}'`), `${integration} は発行不可のはず`)
      continue
    }
    const branch = body.slice(body.indexOf(`when '${integration}'`))
    const line = branch.slice(0, branch.indexOf('\n'))
    for (const scope of scopes) {
      assert.ok(line.includes(`'${scope}'`), `${integration} に ${scope} が無い`)
    }
    // 余分な scope が付いていない
    const count = (line.match(/'[a-z-]+:[a-z]+'/g) ?? []).length
    assert.equal(count, scopes.length, `${integration} の scope 数が一致しない: ${line}`)
  }
})

test('発行関数は secret_hash を返さない', () => {
  const ret = sql.slice(sql.indexOf('return jsonb_build_object'), sql.indexOf('end;\n$$;'))
  assert.doesNotMatch(ret, /secret_hash/)
})

test('失効は不可逆（トリガーで復活を拒否する）', () => {
  assert.match(sql, /create or replace function prevent_integration_token_revival/)
  assert.match(sql, /new\.revoked_at is null or \(new\.is_active and not old\.is_active\)/)
  assert.match(sql, /raise exception 'revoked integration token cannot be reactivated'/)
  assert.match(sql, /create trigger user_import_secrets_no_revival[\s\S]*?before update on user_import_secrets/)
})

test('失効関数も auth.uid() で対象を決める', () => {
  const fn = sql.slice(sql.indexOf('function revoke_integration_token'), sql.indexOf('prevent_integration_token_revival'))
  assert.match(fn, /security definer/)
  assert.match(fn, /and user_id = v_user/)
  assert.match(fn, /and revoked_at is null/)
})

test('関数は anon から呼べない', () => {
  assert.match(sql, /revoke all on function issue_integration_token[^;]*from anon, public/)
  assert.match(sql, /revoke all on function revoke_integration_token[^;]*from anon, public/)
})
