// 取引分割の集計と、DB側の保証を確認するテスト。
//
// 合計一致・所有権・user_id偽装の防止は最終的にDBが保証する。
// 純関数側では「分割した取引を二重に数えない」ことを固定する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tallyByCategory } from './expense-intelligence'

const sql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/029_transaction_items.sql'),
  'utf8'
)

/* ── 集計 ─────────────────────────────────── */

const tx = (id: string, amount: number, category: string, kind = 'expense') => ({
  id, date: '2026-09-07', amount, category, kind,
})

test('内訳がない取引は取引そのもののカテゴリで数える', () => {
  const { totals, counts } = tallyByCategory([tx('t1', 1800, 'コンビニ')], [])
  assert.deepEqual(totals, { コンビニ: 1800 })
  assert.deepEqual(counts, { コンビニ: 1 })
})

test('内訳がある取引は内訳だけを数える（親を数えると二重計上）', () => {
  const { totals } = tallyByCategory(
    [tx('t1', 1800, 'コンビニ')],
    [
      { transaction_id: 't1', amount: 700, category: '食費' },
      { transaction_id: 't1', amount: 600, category: 'タバコ' },
      { transaction_id: 't1', amount: 500, category: '日用品' },
    ]
  )
  assert.deepEqual(totals, { 食費: 700, タバコ: 600, 日用品: 500 })
  assert.ok(!('コンビニ' in totals), '分割元のカテゴリも数えている')
  assert.equal(Object.values(totals).reduce((a, b) => a + b, 0), 1800)
})

test('分割済みと未分割が混在しても正しく合算する', () => {
  const { totals } = tallyByCategory(
    [tx('t1', 1800, 'コンビニ'), tx('t2', 3000, '食費')],
    [{ transaction_id: 't1', amount: 1800, category: '食費' }]
  )
  assert.deepEqual(totals, { 食費: 4800 })
})

test('収入は支出の集計に含めない', () => {
  const { totals } = tallyByCategory([tx('t1', 300000, '給与', 'income')], [])
  assert.deepEqual(totals, {})
})

/* ── DB側の保証 ───────────────────────────── */

test('items 0件（未分割）は許可される', () => {
  // 空配列のときは合計チェックへ入らない
  assert.match(sql, /if v_count > 0 then/)
})

test('合計が取引額と一致しなければDBが拒否する', () => {
  assert.match(sql, /if v_total <> v_amount then/)
  assert.match(sql, /raise exception 'items total \(%\) must equal transaction amount/)
})

test('置換は全消し→一括INSERTを1トランザクションで行う', () => {
  // 1件ずつINSERTすると途中で必ず合計が合わず、行トリガーでは通せない
  const body = sql.slice(sql.indexOf('function replace_transaction_items'))
  const deleteAt = body.indexOf('delete from transaction_items')
  const insertAt = body.indexOf('insert into transaction_items')
  const checkAt = body.indexOf('if v_total <> v_amount')
  assert.ok(deleteAt > 0 && insertAt > deleteAt && checkAt > insertAt)
})

test('他人の取引は分割できない', () => {
  assert.match(sql, /from transactions\s+where id = p_transaction_id and user_id = v_user/)
  assert.match(sql, /raise exception 'transaction not found'/)
})

test('user_id をクライアントから受け取らない', () => {
  const signature = sql.slice(
    sql.indexOf('function replace_transaction_items'),
    sql.indexOf('returns jsonb')
  )
  assert.doesNotMatch(signature, /p_user_id/)
  assert.match(sql, /v_user uuid := auth\.uid\(\)/)
  assert.match(sql, /security definer/)
  assert.match(sql, /set search_path = public/)
})

test('authenticated から直接書き込めない', () => {
  assert.match(sql, /revoke insert, update, delete on transaction_items from authenticated/)
  assert.match(sql, /grant select on transaction_items to authenticated/)
  // 読めるのは自分の内訳だけ
  assert.match(sql, /for select using \(auth\.uid\(\) = user_id\)/)
})
