import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_HORIZONS, projectAssets } from './projection'

test('現在100万円・毎月5万円なら1年後は160万円', () => {
  const [oneYear] = projectAssets({
    currentAssets: 1000000, monthlyContribution: 50000, horizons: [1],
  })
  assert.equal(oneYear.projectedAssets, 1600000)
  assert.equal(oneYear.months, 12)
  assert.equal(oneYear.contributed, 600000)
})

test('3年後は280万円（利回り0%で固定）', () => {
  const [threeYears] = projectAssets({
    currentAssets: 1000000, monthlyContribution: 50000, horizons: [3],
  })
  assert.equal(threeYears.projectedAssets, 2800000)
})

test('既定は1/3/5/10年', () => {
  const points = projectAssets({ currentAssets: 0, monthlyContribution: 10000 })
  assert.deepEqual(points.map(p => p.years), DEFAULT_HORIZONS)
})

test('利回りを掛けない。積立分は月数に正比例する', () => {
  const points = projectAssets({ currentAssets: 0, monthlyContribution: 10000 })
  for (const p of points) {
    assert.equal(p.projectedAssets, 10000 * p.months)
  }
})

test('現在資産が分からないときは予測を出さない', () => {
  assert.deepEqual(projectAssets({ currentAssets: null, monthlyContribution: 50000 }), [])
})

test('積立がマイナスでも資産を減らさない', () => {
  const [p] = projectAssets({ currentAssets: 1000000, monthlyContribution: -50000, horizons: [1] })
  assert.equal(p.projectedAssets, 1000000)
})
