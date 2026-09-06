import test from 'node:test'
import assert from 'node:assert/strict'
import { createImportSecret, createIntegrationSecret, hashImportSecret } from '@/lib/import-secrets'

test('Token の接頭辞で種別が見分けられる', () => {
  assert.match(createIntegrationSecret('gas'), /^flow_gas_/)
  assert.match(createIntegrationSecret('ai_company'), /^flow_aic_/)
})

test('既存の GAS 用ヘルパーは壊れていない', () => {
  assert.match(createImportSecret(), /^flow_gas_/)
})

test('Token は毎回異なる', () => {
  assert.notEqual(createIntegrationSecret('gas'), createIntegrationSecret('gas'))
})

test('接頭辞は認証の根拠にしない（照合はハッシュ）', () => {
  // 旧形式 gas_... も、同じハッシュ関数で照合できる
  const legacy = 'gas_abcdefghijklmnop'
  assert.equal(hashImportSecret(legacy), hashImportSecret(legacy))
  assert.notEqual(hashImportSecret(legacy), hashImportSecret(legacy + 'x'))
  assert.match(hashImportSecret(legacy), /^[0-9a-f]{64}$/)
})

test('ハッシュから平文は復元できない形式で保存する', () => {
  const secret = createIntegrationSecret('gas')
  const hash = hashImportSecret(secret)
  assert.ok(!hash.includes(secret))
  assert.equal(hash.length, 64)
})
