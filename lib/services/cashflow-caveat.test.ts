import test from 'node:test'
import assert from 'node:assert/strict'
import { noShortfallMessage, shortfallJudgeable, SHORTFALL_STALE_MESSAGE } from './cashflow-caveat'

test('最も古い記録日が過去なら M/D 付きの注意書きにする', () => {
  const m = noShortfallMessage({ oldestRecordedAt: '2026-11-20T09:00:00+09:00', today: '2026-11-28' })
  assert.ok(m.includes('11/20'))
  assert.ok(m.includes('断定できません'))
  assert.equal(m, '不足見込みは検出されていません（残高記録日 11/20 以降の引落は予測に未反映のため、不足なしとは断定できません）')
})

test('記録日が今日なら従来の文言', () => {
  assert.equal(
    noShortfallMessage({ oldestRecordedAt: '2026-11-28T09:00:00+09:00', today: '2026-11-28' }),
    '現時点では不足見込みなし',
  )
})

test('UTC表記でもJSTの日付で比べる（11/27 20:00Z は JST 11/28）', () => {
  assert.equal(
    noShortfallMessage({ oldestRecordedAt: '2026-11-27T20:00:00Z', today: '2026-11-28' }),
    '現時点では不足見込みなし',
  )
})

test('記録日が不明なときは日付なしの注意書き（断定しない）', () => {
  const m = noShortfallMessage({ oldestRecordedAt: null, today: '2026-11-28' })
  assert.ok(m.includes('断定できません'))
})

// 資金繰りの不足は、最も古い口座の記録が7日（168時間）以内のときだけ判定する
test('shortfallJudgeable：記録8日前 → false、6日前 → true、未登録 → false', () => {
  const now = new Date('2026-11-28T01:00:00.000Z')
  assert.equal(shortfallJudgeable({ balanceKnown: true, oldestRecordedAt: '2026-11-20T01:00:00.000Z', now }), false)
  assert.equal(shortfallJudgeable({ balanceKnown: true, oldestRecordedAt: '2026-11-22T01:00:00.000Z', now }), true)
  assert.equal(shortfallJudgeable({ balanceKnown: false, oldestRecordedAt: null, now }), false)
  // 残高はあるが記録日時が不明 → 7日以内と確かめられないので判定しない
  assert.equal(shortfallJudgeable({ balanceKnown: true, oldestRecordedAt: null, now }), false)
})

test('SHORTFALL_STALE_MESSAGE は brief の文言', () => {
  assert.equal(SHORTFALL_STALE_MESSAGE, '口座残高が7日以上更新されていないため、資金繰りの不足を判定できません')
})
