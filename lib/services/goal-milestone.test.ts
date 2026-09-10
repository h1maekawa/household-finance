import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMilestoneTrack, suggestMilestoneAmounts } from './goal-milestone'
import type { GoalMilestone } from '@/types/goal'

const milestone = (amount: number, id = String(amount)): GoalMilestone => ({
  id,
  goal_id: 'g1',
  amount,
  label: null,
  position: 0,
})

test('到達済みと未到達を分け、次の通過点を返す', () => {
  const track = buildMilestoneTrack({
    currentAmount: 2_400_000,
    milestones: [milestone(1_000_000), milestone(5_000_000), milestone(10_000_000)],
    monthlyPace: 60_000,
    asOfMonth: '2026-09',
  })

  assert.equal(track.reachedCount, 1)
  assert.equal(track.nextMilestone?.amount, 5_000_000)
  assert.equal(track.remainingToNext, 2_600_000)
})

test('金額が昇順でなくても並べ直す', () => {
  const track = buildMilestoneTrack({
    currentAmount: 0,
    milestones: [milestone(10_000_000), milestone(1_000_000), milestone(5_000_000)],
    monthlyPace: 0,
    asOfMonth: '2026-09',
  })
  assert.deepEqual(
    track.milestones.map(m => m.amount),
    [1_000_000, 5_000_000, 10_000_000]
  )
})

test('進捗は直前の通過点からの区間で見る', () => {
  const track = buildMilestoneTrack({
    currentAmount: 3_000_000,
    milestones: [milestone(1_000_000), milestone(5_000_000)],
    monthlyPace: 0,
    asOfMonth: '2026-09',
  })
  // 100万は到達済み、100万→500万の区間で200万進んでいる = 0.5
  assert.equal(track.milestones[0].segmentProgress, 1)
  assert.equal(track.milestones[1].segmentProgress, 0.5)
})

test('区間の進捗は0〜1に収める', () => {
  const track = buildMilestoneTrack({
    currentAmount: 99_000_000,
    milestones: [milestone(1_000_000)],
    monthlyPace: 0,
    asOfMonth: '2026-09',
  })
  assert.equal(track.milestones[0].segmentProgress, 1)
})

test('次の通過点の到達見込みは利回り0%の単純積立', () => {
  const track = buildMilestoneTrack({
    currentAmount: 2_400_000,
    milestones: [milestone(5_000_000)],
    monthlyPace: 100_000,
    asOfMonth: '2026-09',
  })
  // 260万 ÷ 10万 = 26ヶ月後
  assert.equal(track.projectedNextMonth, '2028-11')
})

test('積立ペースが0なら到達見込みを出さない', () => {
  const track = buildMilestoneTrack({
    currentAmount: 0,
    milestones: [milestone(5_000_000)],
    monthlyPace: 0,
    asOfMonth: '2026-09',
  })
  assert.equal(track.projectedNextMonth, null)
})

test('すべて到達済みなら次の通過点は無い', () => {
  const track = buildMilestoneTrack({
    currentAmount: 10_000_000,
    milestones: [milestone(1_000_000), milestone(5_000_000)],
    monthlyPace: 60_000,
    asOfMonth: '2026-09',
  })
  assert.equal(track.nextMilestone, null)
  assert.equal(track.remainingToNext, null)
  assert.equal(track.projectedNextMonth, null)
})

test('通過点が無くても壊れない', () => {
  const track = buildMilestoneTrack({
    currentAmount: 2_400_000,
    milestones: [],
    monthlyPace: 60_000,
    asOfMonth: '2026-09',
  })
  assert.deepEqual(track.milestones, [])
  assert.equal(track.nextMilestone, null)
})

test('候補はキリのいい刻みで、必ず目標額で終わる', () => {
  const amounts = suggestMilestoneAmounts(30_000_000, 2_400_000)
  assert.ok(amounts.length > 0)
  assert.equal(amounts[amounts.length - 1], 30_000_000)
  assert.deepEqual(amounts, [...amounts].sort((a, b) => a - b))
  // 現在額より下は出さない
  assert.ok(amounts.every(a => a > 2_400_000))
  // 刻みは 1/2/5 × 10^n
  const step = amounts[1] - amounts[0]
  assert.ok([1, 2, 5].includes(step / 10 ** Math.floor(Math.log10(step))))
})

test('候補は12件を超えない(DB側の上限に合わせる)', () => {
  const amounts = suggestMilestoneAmounts(100_000_000, 0, 40)
  assert.ok(amounts.length <= 12)
})

test('目標額が無いなら候補を作らない(推測で埋めない)', () => {
  assert.deepEqual(suggestMilestoneAmounts(null, 1_000_000), [])
})

test('すでに目標額へ届いているなら候補は空', () => {
  assert.deepEqual(suggestMilestoneAmounts(1_000_000, 2_000_000), [])
})
