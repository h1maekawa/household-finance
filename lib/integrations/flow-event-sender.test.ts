import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createSignedFlowEvent,
  isCardTransaction,
  sendCardTransactionCreatedEvent,
  type CardTransactionCreatedEvent,
} from './flow-event-sender'

const event: CardTransactionCreatedEvent = {
  event: 'card_transaction.created',
  transactionId: 'tx-1',
  date: '2026-09-30',
  merchant: 'Amazon',
  amount: 4980,
  card: '楽天カード',
}

test('AI Company契約どおり timestamp.rawBody をHMAC-SHA256署名する', () => {
  const timestamp = '1790755200000'
  const signed = createSignedFlowEvent({ event, secret: 'test-secret', timestamp })
  const expected = createHmac('sha256', 'test-secret')
    .update(`${timestamp}.${signed.rawBody}`)
    .digest('hex')

  assert.equal(signed.headers['x-flow-timestamp'], timestamp)
  assert.equal(signed.headers['x-flow-signature'], `sha256=${expected}`)
  assert.deepEqual(Object.keys(JSON.parse(signed.rawBody)).sort(), [
    'amount', 'card', 'date', 'event', 'merchant', 'transactionId',
  ])
})

test('13桁Unixミリ秒以外では署名を作らない', () => {
  assert.throws(
    () => createSignedFlowEvent({ event, secret: 'test-secret', timestamp: '123' }),
    /13-digit/
  )
})

test('カード支出だけを通知対象にする', () => {
  assert.equal(isCardTransaction({ kind: 'expense', cardIssuer: '楽天カード' }), true)
  assert.equal(isCardTransaction({ kind: 'expense', paymentMethod: 'credit card' }), true)
  assert.equal(isCardTransaction({ kind: 'expense', paymentMethod: '現金' }), false)
  assert.equal(isCardTransaction({ kind: 'income', cardIssuer: '楽天カード' }), false)
})

test('送信失敗はthrowせず、取込側が成功を維持できる結果を返す', async () => {
  const result = await sendCardTransactionCreatedEvent(event, {
    endpoint: 'https://ai.example.test/api/integrations/flow/events',
    secret: 'test-secret',
    now: () => 1790755200000,
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  })
  assert.deepEqual(result, { status: 'failed', reason: 'http' })
})

test('未設定なら外部通信せずdisabled', async () => {
  let called = false
  const result = await sendCardTransactionCreatedEvent(event, {
    endpoint: '',
    secret: '',
    fetchImpl: async () => {
      called = true
      return new Response(null, { status: 204 })
    },
  })
  assert.deepEqual(result, { status: 'disabled' })
  assert.equal(called, false)
})

test('importは新規INSERT成功後だけ通知し、通知結果で201を壊さない', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'app/api/transactions/import/route.ts'),
    'utf8'
  )
  const insertAt = src.lastIndexOf(".from('transactions')")
  const duplicateReturnAt = src.indexOf('return Response.json({ duplicate: true', insertAt)
  const sendAt = src.indexOf('sendCardTransactionCreatedEvent({', insertAt)
  const createdReturnAt = src.indexOf('return Response.json({ transaction: data }', sendAt)

  assert.ok(insertAt >= 0 && duplicateReturnAt > insertAt)
  assert.ok(sendAt > duplicateReturnAt, 'duplicate経路より前に通知してはいけない')
  assert.ok(createdReturnAt > sendAt, '新規INSERT成功後に通知すること')
  assert.match(src, /if \(delivery\.status === 'failed'\)[\s\S]*console\.warn/)
})
