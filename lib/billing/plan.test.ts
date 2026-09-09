import test from 'node:test'
import assert from 'node:assert/strict'
import { isBillingEnforced, isProPlan, resolvePlan } from './plan'

const NOW = new Date('2026-09-06T00:00:00Z')
const FUTURE = '2026-10-01T00:00:00Z'
const PAST = '2026-08-01T00:00:00Z'

test('契約が無く entitlement も無ければ free', () => {
  assert.equal(resolvePlan({ subscription: null, entitlement: null, now: NOW }), 'free')
})

test('active な Subscription は pro', () => {
  const plan = resolvePlan({
    subscription: { status: 'active', current_period_end: FUTURE },
    entitlement: null,
    now: NOW,
  })
  assert.equal(plan, 'pro')
})

test('trialing も pro として扱う', () => {
  const plan = resolvePlan({
    subscription: { status: 'trialing', current_period_end: FUTURE },
    entitlement: null,
    now: NOW,
  })
  assert.equal(plan, 'pro')
})

test('active でも期間が終わっていれば pro にしない', () => {
  const plan = resolvePlan({
    subscription: { status: 'active', current_period_end: PAST },
    entitlement: null,
    now: NOW,
  })
  assert.equal(plan, 'free')
})

test('past_due の契約だけでは pro にならない', () => {
  const plan = resolvePlan({
    subscription: { status: 'past_due', current_period_end: FUTURE },
    entitlement: null,
    now: NOW,
  })
  assert.equal(plan, 'free')
})

test('既存ユーザーの legacy_pro は維持される', () => {
  const plan = resolvePlan({
    subscription: null,
    entitlement: { plan: 'legacy_pro', status: 'active' },
    now: NOW,
  })
  assert.equal(plan, 'legacy_pro')
  assert.equal(isProPlan(plan), true)
})

test('既存の買い切り pro_lifetime を壊さない', () => {
  const plan = resolvePlan({
    subscription: null,
    entitlement: { plan: 'pro_lifetime', status: 'active' },
    now: NOW,
  })
  assert.equal(plan, 'pro')
})

test('契約が切れても legacy_pro が残っていれば救われる', () => {
  const plan = resolvePlan({
    subscription: { status: 'canceled', current_period_end: PAST },
    entitlement: { plan: 'legacy_pro', status: 'active' },
    now: NOW,
  })
  assert.equal(plan, 'legacy_pro')
})

test('status が active でない entitlement は無効', () => {
  const plan = resolvePlan({
    subscription: null,
    entitlement: { plan: 'legacy_pro', status: 'revoked' },
    now: NOW,
  })
  assert.equal(plan, 'free')
})

test('free は Pro 相当ではない', () => {
  assert.equal(isProPlan('free'), false)
})

test('Production では設定漏れでも課金チェックが有効', () => {
  assert.equal(isBillingEnforced({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), true)
  // 明示的に false を入れても Production では外せない
  assert.equal(
    isBillingEnforced({ NODE_ENV: 'production', BILLING_REQUIRED: 'false' } as NodeJS.ProcessEnv),
    true
  )
})

test('開発環境も既定では有効。明示的にだけ外せる', () => {
  assert.equal(isBillingEnforced({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), true)
  assert.equal(
    isBillingEnforced({ NODE_ENV: 'development', BILLING_REQUIRED: 'false' } as NodeJS.ProcessEnv),
    false
  )
})
