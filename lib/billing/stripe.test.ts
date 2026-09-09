// Webhook 署名検証のテスト。
// 独自HMACではなく Stripe SDK の constructEvent を通ることを、
// SDK 自身のテストヘルパー(generateTestHeaderString)で確認する。
import test from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { verifyStripeEvent, WebhookVerificationError } from './stripe'

const SECRET = 'whsec_test_secret'
const stripe = new Stripe('sk_test_dummy')

const payload = JSON.stringify({
  id: 'evt_test_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', metadata: { user_id: 'user-1' } } },
})

function header(timestampSeconds: number, body = payload, secret = SECRET) {
  return stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    timestamp: timestampSeconds,
  })
}

const now = () => Math.floor(Date.now() / 1000)

test('正しい署名のイベントは検証を通る', () => {
  const event = verifyStripeEvent(payload, header(now()), SECRET, stripe)
  assert.equal(event.id, 'evt_test_1')
  assert.equal(event.type, 'checkout.session.completed')
})

test('署名が別のシークレットで作られていれば弾く', () => {
  const forged = header(now(), payload, 'whsec_wrong_secret')
  assert.throws(
    () => verifyStripeEvent(payload, forged, SECRET, stripe),
    WebhookVerificationError
  )
})

test('古い timestamp の再送(replay)は弾く', () => {
  // constructEvent は既定の許容範囲(5分)を超えた署名を拒否する。
  // 自前で timestamp を比較していないことの確認でもある
  const old = now() - 60 * 60
  assert.throws(() => verifyStripeEvent(payload, header(old), SECRET, stripe), WebhookVerificationError)
})

test('署名は正しいがボディが差し替えられていれば弾く', () => {
  const signature = header(now())
  const tampered = payload.replace('user-1', 'user-2')
  assert.throws(
    () => verifyStripeEvent(tampered, signature, SECRET, stripe),
    WebhookVerificationError
  )
})

test('壊れたペイロードは弾く', () => {
  const broken = '{ not json'
  assert.throws(
    () => verifyStripeEvent(broken, header(now(), broken), SECRET, stripe),
    WebhookVerificationError
  )
})

test('stripe-signature ヘッダーが無ければ弾く', () => {
  assert.throws(() => verifyStripeEvent(payload, null, SECRET, stripe), WebhookVerificationError)
})

test('STRIPE_WEBHOOK_SECRET が未設定なら弾く', () => {
  assert.throws(
    () => verifyStripeEvent(payload, header(now()), undefined, stripe),
    WebhookVerificationError
  )
})
