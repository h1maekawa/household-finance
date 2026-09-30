import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

test('actual debts GET: authorization, keyset pages, totals, isolation and errors', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: String(index).padStart(5, '0'), user_id: index === 1000 ? 'other' : 'owner', direction: index % 2 ? 'lent' : 'borrowed', counterparty: 'Person', amount: 2, date: '2026-09-30', due_date: null, memo: null, is_settled: index === 999 }))
  let status = 200
  let failure = false
  let pages = 0
  const db = { from: (table: string) => {
    assert.equal(table, 'debts')
    let selected = rows.slice()
    const query = {
      select: (columns: string) => { assert.equal(columns, 'id,direction,counterparty,amount,date,due_date,memo,is_settled'); return query },
      eq: (column: string, value: unknown) => { selected = selected.filter(row => row[column as keyof typeof row] === value); return query },
      gt: (_column: string, cursor: string) => { selected = selected.filter(row => row.id > cursor); return query },
      order: () => query,
      limit: () => query,
      then: (resolve: (value: unknown) => void) => { pages++; resolve({ data: selected.slice(0, 500), error: failure ? new Error('offline') : null }) },
    }
    return query
  } }
  const exports: { GET?: (request: unknown) => Promise<Response> } = {}
  const source = ts.transpileModule(readFileSync('app/api/integrations/debts/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(source, { exports, Response, require: (name: string) => {
    if (name === '@/lib/server-auth') return { requireIntegrationScope: async (_request: unknown, scope: string) => { assert.equal(scope, 'assets:read'); return status === 200 ? { auth: { userId: 'owner' } } : { response: Response.json({}, { status }) } } }
    if (name === '@/lib/supabase') return { supabaseAdmin: db }
    if (name === '@/lib/api-errors') return { readFailed: () => Response.json({}, { status: 500 }) }
    throw new Error(name)
  } })
  const request = (search = '') => ({ nextUrl: new URL(`https://example.test/${search}`) })
  for (const denied of [401, 403]) { status = denied; assert.equal((await exports.GET!(request())).status, denied) }
  assert.equal(pages, 0)
  status = 200
  const response = await exports.GET!(request())
  const body = await response.json()
  assert.equal(body.items.length, 999)
  assert.deepEqual(body.totals, { borrowed: 1000, lent: 998 })
  assert.equal(new Set(body.items.map((row: { id: string }) => row.id)).size, 999)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(pages, 3)
  const all = await (await exports.GET!(request('?include=all'))).json()
  assert.equal(all.items.length, 1000)
  assert.deepEqual(all.totals, { borrowed: 1000, lent: 1000 })
  failure = true
  assert.equal((await exports.GET!(request())).status, 500)
  failure = false
  rows[0].amount = Number.NaN
  assert.equal((await exports.GET!(request())).status, 500)
})
