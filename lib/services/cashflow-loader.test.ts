// cashflow-loader.ts は Supabase サーバーモジュールを読むため直接 import できない。
// ソースの形を固定する契約テスト。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(process.cwd(), 'lib/services/cashflow-loader.ts'), 'utf8')

test('開始残高は loadLiquidCash の口座合計から取る', () => {
  assert.match(source, /loadLiquidCash\(/)
  assert.match(source, /startingBalance/)
  assert.match(source, /startingBalanceSource/)
  assert.match(source, /startingBalanceRecordedAt/)
})

test('旧テーブルの残高を ?? 0 で開始残高にしない', () => {
  assert.doesNotMatch(source, /currentBalance\s*=\s*balanceRes\.data\?\.balance\s*\?\?\s*0/)
  assert.doesNotMatch(source, /projectCashflow\(\s*balanceRes/)
  assert.doesNotMatch(source, /projectCashflow\(\s*currentBalance/)
})

test('開始残高が未登録なら予測を空にして日本語の理由を返す', () => {
  assert.match(source, /口座残高が未登録のため、資金繰りを予測できません/)
  assert.match(source, /projectedDays\s*=\s*startingBalance\s*===\s*null\s*\?\s*\[\]/)
})

test('後方互換のため currentBalance（旧テーブルの行）は返し続ける', () => {
  assert.match(source, /currentBalance:\s*balanceRes\.data/)
})
