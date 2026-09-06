import test from 'node:test'
import assert from 'node:assert/strict'
import { computeEmergencyFund } from './emergency-fund'

test('生活費20万円の3か月分は60万円', () => {
  const r = computeEmergencyFund({
    monthlyEssentialExpenses: 200000, currentLiquidCash: 400000, targetMonths: 3,
  })
  assert.equal(r.requiredReserve, 600000)
  assert.equal(r.reserveGap, 200000)
  assert.equal(r.status, 'underfunded')
})

test('必要額を超えていれば不足はゼロ', () => {
  const r = computeEmergencyFund({
    monthlyEssentialExpenses: 200000, currentLiquidCash: 800000, targetMonths: 3,
  })
  assert.equal(r.reserveGap, 0)
  assert.equal(r.status, 'funded')
  assert.ok(r.fundedRatio! > 1)
})

test('ちょうど足りている場合も funded', () => {
  const r = computeEmergencyFund({
    monthlyEssentialExpenses: 200000, currentLiquidCash: 600000, targetMonths: 3,
  })
  assert.equal(r.reserveGap, 0)
  assert.equal(r.fundedRatio, 1)
})

test('現金が分からないときは0円と言わずに unknown', () => {
  const r = computeEmergencyFund({
    monthlyEssentialExpenses: 200000, currentLiquidCash: null, targetMonths: 3,
  })
  assert.equal(r.status, 'unknown')
  assert.equal(r.requiredReserve, null)
  assert.equal(r.reserveGap, null)
})

test('生活費が分からないときも unknown', () => {
  const r = computeEmergencyFund({
    monthlyEssentialExpenses: null, currentLiquidCash: 400000, targetMonths: 3,
  })
  assert.equal(r.status, 'unknown')
  assert.equal(r.reserveGap, null)
  assert.equal(r.currentReserve, 400000)
})

test('0か月なら必要額は0で充足扱い', () => {
  const r = computeEmergencyFund({
    monthlyEssentialExpenses: 200000, currentLiquidCash: 0, targetMonths: 0,
  })
  assert.equal(r.requiredReserve, 0)
  assert.equal(r.status, 'funded')
})
