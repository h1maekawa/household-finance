// ユーザーAPIの所有権分離を、コードの形として固定するテスト。
//
// RLS を信頼するだけでなく、API 側でも
//   - クライアントが user_id を指定できない
//   - ユーザー起点のAPIが service_role でRLSを迂回しない
// ことを保証する。実DBが無い環境でも回るように静的検査で行う。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const API_ROOT = path.join(process.cwd(), 'app/api')

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (name === 'route.ts') out.push(full)
  }
  return out
}

const routes = routeFiles(API_ROOT).map(file => ({
  file,
  rel: path.relative(API_ROOT, file).replace(/\/route\.ts$/, ''),
  src: readFileSync(file, 'utf8'),
}))

/**
 * service_role を使ってよい経路。
 * いずれもユーザーのセッションが存在しないため RLS を通せない。
 * ここへ追加するときは docs/SECURITY.md の許可範囲と照らすこと。
 */
const SERVICE_ROLE_ALLOWED = new Set([
  'billing/webhook', // Stripe署名で認証。セッションなし
  'integrations/investment-capacity', // Integration Token で user_id を解決
  'transactions/import', // 同上（GAS取込）
])

test('ユーザー起点のAPIは service_role で RLS を迂回しない', () => {
  const offenders = routes
    .filter(r => r.src.includes('supabaseAdmin'))
    .map(r => r.rel)
    .filter(rel => !SERVICE_ROLE_ALLOWED.has(rel))

  assert.deepEqual(
    offenders,
    [],
    `セッションのあるAPIは createSupabaseServerClient を使うこと: ${offenders.join(', ')}`
  )
})

test('クライアントが user_id を指定できる経路が無い', () => {
  const pattern = /body\.user_?[Ii]d|searchParams\.get\(['"]user_?[Ii]d['"]\)/
  const offenders = routes.filter(r => pattern.test(r.src)).map(r => r.rel)
  assert.deepEqual(offenders, [], `user_id は必ずセッションから取ること: ${offenders.join(', ')}`)
})

test('INSERT では body の後に user_id を固定している', () => {
  // { ...body, user_id: user.id } の順序が逆だと、クライアントが他人のIDを
  // 指定できる（RLSで弾かれるが、APIとしても許してはいけない）
  for (const r of routes) {
    for (const m of r.src.matchAll(/\{\s*\.\.\.(body|allowed)[^}]*\}/g)) {
      const literal = m[0]
      if (!literal.includes('user_id')) continue
      const spreadAt = literal.indexOf('...')
      const userIdAt = literal.indexOf('user_id')
      assert.ok(
        userIdAt > spreadAt,
        `${r.rel}: user_id は spread より後に置くこと -> ${literal}`
      )
    }
  }
})

test('DBエラーの詳細をクライアントへ返さない', () => {
  const offenders = routes
    .filter(r => /error:\s*\w+\.message/.test(r.src))
    .map(r => r.rel)
  assert.deepEqual(
    offenders,
    [],
    `lib/api-errors の readFailed / writeFailed を使うこと: ${offenders.join(', ')}`
  )
})
