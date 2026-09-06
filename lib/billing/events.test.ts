import test from 'node:test'
import assert from 'node:assert/strict'
import { decideEventAction, STALE_PROCESSING_MS, type StripeEventRow } from './events'

const NOW = new Date('2026-09-06T12:00:00Z')

function row(overrides: Partial<StripeEventRow>): StripeEventRow {
  return {
    event_id: 'evt_1',
    event_type: 'checkout.session.completed',
    status: 'processing',
    attempts: 1,
    received_at: NOW.toISOString(),
    ...overrides,
  }
}

test('未登録のイベントは処理する', () => {
  assert.equal(decideEventAction(null, NOW), 'process')
})

test('processed 済みのイベントは二重適用しない', () => {
  assert.equal(decideEventAction(row({ status: 'processed' }), NOW), 'skip')
})

test('途中で失敗したイベントは再処理する', () => {
  assert.equal(decideEventAction(row({ status: 'failed' }), NOW), 'retry')
})

test('処理中のイベントは横取りしない', () => {
  assert.equal(decideEventAction(row({ status: 'processing' }), NOW), 'skip')
})

test('processing のまま放置されたイベントは引き取る', () => {
  const stale = new Date(NOW.getTime() - STALE_PROCESSING_MS - 1000).toISOString()
  assert.equal(decideEventAction(row({ status: 'processing', received_at: stale }), NOW), 'retry')
})
