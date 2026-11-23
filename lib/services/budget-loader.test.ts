// budget-loader.ts は import 時に next/headers (Supabase server) を読むため、
// node --test の解決フックでは直接 import できない。
// 月境界の2関数は純粋な文字列・日付計算なので、ソースから該当関数だけを取り出して評価する。
// (関数は移動しない。テストは本物のソースを対象にする)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
  path.join(process.cwd(), 'lib/services/budget-loader.ts'),
  'utf8'
)

function extractExportedFunction(name: string): (month: string) => string {
  const start = source.indexOf(`export function ${name}(`)
  assert.notEqual(start, -1, `${name} が budget-loader.ts に無い`)
  const end = source.indexOf('\n}\n', start)
  assert.notEqual(end, -1, `${name} の終端が見つからない`)
  // 型注釈だけ落として JS として評価する（本体ロジックはそのまま）
  const body = source
    .slice(start + 'export '.length, end + 3)
    .replace('(month: string): string {', '(month) {')
  return new Function(`${body}\nreturn ${name}`)() as (month: string) => string
}

const monthStart = extractExportedFunction('monthStart')
const monthEnd = extractExportedFunction('monthEnd')

test('monthEnd は各月の実際の末日を返す', () => {
  assert.equal(monthEnd('2026-11'), '2026-11-30')
  assert.equal(monthEnd('2026-02'), '2026-02-28')
  assert.equal(monthEnd('2028-02'), '2028-02-29')
  assert.equal(monthEnd('2026-12'), '2026-12-31')
})

test('monthStart は月初日を返す', () => {
  assert.equal(monthStart('2026-11'), '2026-11-01')
})
