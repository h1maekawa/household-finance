import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeCardActivityCursor,
  encodeCardActivityCursor,
  minimizeCardActivity,
} from './card-activity'

test('card activity は必要最小限の項目だけを返す', () => {
  const item = minimizeCardActivity({
    id: '11111111-1111-4111-8111-111111111111',
    date: '2026-09-30T10:00:00Z',
    amount: -4980,
    memo: 'クレジットカード自動連携 (Amazon)',
    card_issuer: '楽天カード',
    payment_method: 'credit',
    category: 'shopping',
    needs_review: true,
    external_id: 'secret-provider-id',
    raw_email: 'raw body',
  } as never)

  assert.deepEqual(item, {
    id: '11111111-1111-4111-8111-111111111111',
    date: '2026-09-30',
    merchant: 'Amazon',
    amount: 4980,
    card: '楽天カード',
    category: 'shopping',
    review_status: 'unreviewed',
  })
  assert.equal('external_id' in item, false)
  assert.equal('raw_email' in item, false)
  assert.equal('memo' in item, false)
})

test('cursor は date と id 以外を受理しない', () => {
  const source = { date: '2026-09-30', id: '11111111-1111-4111-8111-111111111111' }
  assert.deepEqual(decodeCardActivityCursor(encodeCardActivityCursor(source)), source)
  assert.equal(decodeCardActivityCursor('invalid'), null)
})
