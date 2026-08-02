import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIXED_COST_PRESET,
  fixedCostIdentity,
  presetInvestmentTotal,
  presetLivingFixedTotal,
  presetTotal,
} from './fixed-cost-preset'

test('プリセットは8件で、生活固定費101,350円・投資15,000円・合計116,350円', () => {
  assert.equal(FIXED_COST_PRESET.length, 8)
  assert.equal(presetLivingFixedTotal(), 101350)
  assert.equal(presetInvestmentTotal(), 15000)
  assert.equal(presetTotal(), 116350)
})

test('カードへの紐付けは三井住友3件・楽天3件', () => {
  const byCard = (name: string) =>
    FIXED_COST_PRESET.filter(item => item.cardName === name).map(item => item.name)

  assert.deepEqual(byCard('三井住友カード'), ['電気代', 'ガス代', '交通費・定期代'])
  assert.deepEqual(byCard('楽天カード'), ['水道代', '楽天モバイル', '積立NISA'])
})

test('家賃と保険は口座引落で、支払日は未設定のまま', () => {
  for (const name of ['家賃', '保険']) {
    const item = FIXED_COST_PRESET.find(i => i.name === name)!
    assert.equal(item.paymentMethod, 'bank_debit')
    assert.equal(item.dueDay, null, `${name} の支払日を推測してはいけない`)
  }
})

test('固定額と変動額の区分', () => {
  const typeOf = (name: string) => FIXED_COST_PRESET.find(i => i.name === name)!.amountType
  assert.equal(typeOf('家賃'), 'fixed')
  assert.equal(typeOf('楽天モバイル'), 'fixed')
  assert.equal(typeOf('交通費・定期代'), 'fixed')
  assert.equal(typeOf('保険'), 'variable')
  assert.equal(typeOf('電気代'), 'variable')
  assert.equal(typeOf('ガス代'), 'variable')
  assert.equal(typeOf('水道代'), 'variable')
  assert.equal(typeOf('積立NISA'), 'variable')
})

test('契約会社が不明な電気・ガスには照合キーワードを入れない', () => {
  for (const name of ['電気代', 'ガス代']) {
    assert.deepEqual(FIXED_COST_PRESET.find(i => i.name === name)!.matchKeywords, [])
  }
})

// 実取引が届いている4件は、キーワードが無いと二重計上する
test('実カード利用が来ている項目には照合キーワードがある', () => {
  for (const name of ['水道代', '楽天モバイル', '交通費・定期代', '積立NISA']) {
    const keywords = FIXED_COST_PRESET.find(i => i.name === name)!.matchKeywords
    assert.ok(keywords.length > 0, `${name} にキーワードが無いと二重計上する`)
  }
})

test('積立NISAは投資カテゴリで、生活固定費に混ざらない', () => {
  const nisa = FIXED_COST_PRESET.find(i => i.name === '積立NISA')!
  assert.equal(nisa.category, '投資')
  assert.equal(presetLivingFixedTotal() + nisa.amount, presetTotal())
})

test('重複判定は名前だけでなく支払方法とカードも見る', () => {
  const bank = fixedCostIdentity({ name: '水道代', paymentMethod: 'bank_debit' })
  const card = fixedCostIdentity({ name: '水道代', paymentMethod: 'credit_card', cardId: 'c1' })
  assert.notEqual(bank, card)
  // 全角スペースや大文字小文字の揺れは同一視する
  assert.equal(
    fixedCostIdentity({ name: '楽天　モバイル', paymentMethod: 'credit_card', cardId: 'c1' }),
    fixedCostIdentity({ name: '楽天モバイル', paymentMethod: 'credit_card', cardId: 'c1' })
  )
})
