import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TAX_RATE,
  SIMPLIFIED_TAX_RATE,
  TAX_RATE_PRESETS,
  buildFirePlan,
  grossAnnualAssetIncome,
  isFireType,
  requiredAssetsFor,
  requiredMonthlyAssetIncome,
  taxAssumptionLabel,
  zeroReturnAchievementMonth,
  type FireSettings,
} from './fire-planner'
import { DEFAULT_RETURN_RATE, OFFICIAL_RETURN_RATES } from './return-assumptions'

const settings = (patch: Partial<FireSettings> = {}): FireSettings => ({
  fireType: 'semi',
  monthlyLivingCost: 200_000,
  postFireMonthlyIncome: 100_000,
  targetAssetIncomeMonthly: null,
  assumedReturnRate: DEFAULT_RETURN_RATE,
  taxRate: DEFAULT_TAX_RATE,
  ...patch,
})

test('半FIRE は生活費から副業収入を引く(スペック §21)', () => {
  assert.equal(requiredMonthlyAssetIncome(settings()), 100_000)
})

test('完全FIRE は副業収入を当てにしない', () => {
  assert.equal(requiredMonthlyAssetIncome(settings({ fireType: 'full' })), 200_000)
})

test('副業収入が生活費を超えるなら必要な資産収入は0円', () => {
  const result = requiredMonthlyAssetIncome(settings({ postFireMonthlyIncome: 300_000 }))
  assert.equal(result, 0)
})

test('生活費が未入力なら null。0円にしない', () => {
  assert.equal(requiredMonthlyAssetIncome(settings({ monthlyLivingCost: null })), null)
})

test('資産収入目標が入っていれば生活費からの逆算より優先する', () => {
  const result = requiredMonthlyAssetIncome(
    settings({ targetAssetIncomeMonthly: 150_000, monthlyLivingCost: null })
  )
  assert.equal(result, 150_000)
})

test('スペック §21 の例と一致する(既定の税引前・利回り4%で3,000万円)', () => {
  const gross = grossAnnualAssetIncome(100_000, DEFAULT_TAX_RATE)
  assert.equal(gross, 1_200_000)
  assert.equal(requiredAssetsFor(gross, 0.04), 30_000_000)
})

test('既定は税引前。取り崩しへ一律課税を織り込まない', () => {
  // NISA・元本取り崩し・控除で実際の税額は変わるので、既定で課税を仮定しない
  assert.equal(DEFAULT_TAX_RATE, 0)
  assert.equal(grossAnnualAssetIncome(100_000, DEFAULT_TAX_RATE), 1_200_000)
  assert.equal(taxAssumptionLabel(DEFAULT_TAX_RATE), '税引前シミュレーション')
})

test('20.315% は参考シナリオとして選べる', () => {
  assert.equal(SIMPLIFIED_TAX_RATE, 0.20315)
  assert.deepEqual([...TAX_RATE_PRESETS], [0, 0.20315])
  assert.equal(taxAssumptionLabel(SIMPLIFIED_TAX_RATE), '課税を単純化した参考シナリオ')
  // 課税を仮定した場合は必要資産が増える側に動く
  const gross = grossAnnualAssetIncome(100_000, SIMPLIFIED_TAX_RATE)
  assert.ok(gross !== null && gross > 1_200_000)
  const required = requiredAssetsFor(gross, 0.04)
  assert.ok(required !== null && required > 30_000_000)
})

test('独自の税率は参考シナリオと区別する', () => {
  assert.equal(taxAssumptionLabel(0.15), '独自の税率の仮定')
})

test('利回り0%では必要資産は null。0円や巨大な有限額にしない', () => {
  assert.equal(requiredAssetsFor(1_200_000, 0), null)
  assert.equal(requiredAssetsFor(1_200_000, -0.01), null)
})

test('必要な資産収入が0円なら必要資産も0円(算出不能ではない)', () => {
  assert.equal(requiredAssetsFor(0, 0), 0)
})

test('正式シナリオは 0/3/5/7% のみ。想定利回りは Custom として並ぶ', () => {
  const plan = buildFirePlan({
    settings: settings({ assumedReturnRate: 0.04 }),
    livingCostSource: 'user',
    currentAssets: 2_400_000,
    monthlyContribution: 60_000,
    asOfMonth: '2026-09',
  })

  assert.deepEqual(
    plan.scenarios.map(s => s.returnRate),
    [0, 0.03, 0.04, 0.05, 0.07]
  )
  const custom = plan.scenarios.find(s => s.returnRate === 0.04)
  assert.equal(custom?.isOfficial, false)
  for (const rate of OFFICIAL_RETURN_RATES) {
    assert.equal(plan.scenarios.find(s => s.returnRate === rate)?.isOfficial, true)
  }
  // 利回りが高いほど必要資産は小さい
  const required = plan.scenarios
    .filter(s => s.requiredAssets !== null)
    .map(s => s.requiredAssets as number)
  assert.deepEqual(required, [...required].sort((a, b) => b - a))
})

test('総資産が不明なら不足額は null。0円にしない', () => {
  const plan = buildFirePlan({
    settings: settings(),
    livingCostSource: 'user',
    currentAssets: null,
    monthlyContribution: 60_000,
    asOfMonth: '2026-09',
  })
  assert.equal(plan.primary.shortfall, null)
  assert.equal(plan.primary.fundedRatio, null)
  assert.equal(plan.zeroReturnAchievementMonth, null)
  assert.ok(plan.missingData.some(m => m.includes('総資産')))
})

test('生活費が未入力なら missingData に出し、必要資産は null', () => {
  const plan = buildFirePlan({
    settings: settings({ monthlyLivingCost: null }),
    livingCostSource: 'user',
    currentAssets: 2_400_000,
    monthlyContribution: 60_000,
    asOfMonth: '2026-09',
  })
  assert.equal(plan.primary.requiredAssets, null)
  assert.equal(plan.livingCostSource, 'unknown')
  assert.ok(plan.missingData.some(m => m.includes('生活費')))
})

test('生活費を家計から推定したことが分かる', () => {
  const plan = buildFirePlan({
    settings: settings(),
    livingCostSource: 'budget',
    currentAssets: 2_400_000,
    monthlyContribution: 60_000,
    asOfMonth: '2026-09',
  })
  assert.equal(plan.livingCostSource, 'budget')
})

test('副業収入だけで賄えている状態を伝える', () => {
  const plan = buildFirePlan({
    settings: settings({ postFireMonthlyIncome: 250_000 }),
    livingCostSource: 'user',
    currentAssets: 0,
    monthlyContribution: 0,
    asOfMonth: '2026-09',
  })
  assert.equal(plan.coveredBySideIncome, true)
  assert.equal(plan.primary.requiredAssets, 0)
  assert.equal(plan.primary.shortfall, 0)
})

test('到達見込みは利回り0%の単純積立で出す', () => {
  // 必要資産 3,000万 / 現在 2,400万 / 毎月10万 → 600万 ÷ 10万 = 60ヶ月後
  assert.equal(
    zeroReturnAchievementMonth({
      requiredAssets: 30_000_000,
      currentAssets: 24_000_000,
      monthlyContribution: 100_000,
      asOfMonth: '2026-09',
    }),
    '2031-09'
  )
})

test('積立額が0なら到達見込みは出さない', () => {
  assert.equal(
    zeroReturnAchievementMonth({
      requiredAssets: 30_000_000,
      currentAssets: 24_000_000,
      monthlyContribution: 0,
      asOfMonth: '2026-09',
    }),
    null
  )
})

test('すでに必要資産へ届いているなら当月', () => {
  assert.equal(
    zeroReturnAchievementMonth({
      requiredAssets: 30_000_000,
      currentAssets: 30_000_000,
      monthlyContribution: 0,
      asOfMonth: '2026-09',
    }),
    '2026-09'
  )
})

test('isFireType は full / semi だけを通す', () => {
  assert.equal(isFireType('full'), true)
  assert.equal(isFireType('semi'), true)
  assert.equal(isFireType('coast'), false)
  assert.equal(isFireType(null), false)
})
