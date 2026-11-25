import test from 'node:test'
import assert from 'node:assert/strict'
import { balanceEditMode } from './balance-edit-mode'

test('口座がある（accounts）ときは口座管理へのリンク', () => {
  assert.equal(balanceEditMode('accounts'), 'link')
})
test('旧テーブル／未登録（流動口座0件）ならその場で編集', () => {
  assert.equal(balanceEditMode('legacy_balance'), 'inline-edit')
  assert.equal(balanceEditMode('none'), 'inline-edit')
})
test('読み込み前（undefined）はその場編集にしない', () => {
  assert.equal(balanceEditMode(undefined), 'none')
})
