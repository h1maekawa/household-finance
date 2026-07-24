import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMonthsToMonth,
  computeGoalProgress,
  monthlyPaceFrom,
  monthsBetween,
  pickPrimaryGoal,
  requiredMonthlyContribution,
} from '@/lib/services/goal-progress'
import type { LifeGoal } from '@/types/goal'

function goal(partial: Partial<LifeGoal> = {}): LifeGoal {
  return {
    id: 'g1',
    kind: 'savings',
    title: '住宅頭金',
    target_amount: 5000000,
    target_date: '2030-12-31',
    current_amount: 1000000,
    priority: 0,
    monthly_contribution: null,
    status: 'active',
    ...partial,
  }
}

test('monthsBetween and addMonthsToMonth cross year boundaries', () => {
  assert.equal(monthsBetween('2026-07', '2026-07'), 0)
  assert.equal(monthsBetween('2026-07', '2027-01'), 6)
  assert.equal(monthsBetween('2026-07-24', '2030-12-31'), 53)
  assert.equal(addMonthsToMonth('2026-07', 6), '2027-01')
  assert.equal(addMonthsToMonth('2026-12', 1), '2027-01')
  assert.equal(addMonthsToMonth('2026-07', 0), '2026-07')
})

test('requiredMonthlyContribution divides the remaining amount by the months left', () => {
  // 残り 4,000,000 円 / (53 + 当月) = 54 ヶ月
  const required = requiredMonthlyContribution(
    { target_amount: 5000000, target_date: '2030-12-31', current_amount: 1000000 },
    '2026-07'
  )
  assert.equal(required, Math.ceil(4000000 / 54))
})

test('requiredMonthlyContribution is 0 once the target is reached', () => {
  const required = requiredMonthlyContribution(
    { target_amount: 1000000, target_date: '2030-12-31', current_amount: 1200000 },
    '2026-07'
  )
  assert.equal(required, 0)
})

test('requiredMonthlyContribution is null without a target amount or date', () => {
  assert.equal(
    requiredMonthlyContribution({ target_amount: null, target_date: '2030-12-31', current_amount: 0 }, '2026-07'),
    null
  )
  assert.equal(
    requiredMonthlyContribution({ target_amount: 100, target_date: null, current_amount: 0 }, '2026-07'),
    null
  )
})

test('computeGoalProgress projects the achievement month linearly', () => {
  // 残り 4,000,000 を毎月 100,000 → 40 ヶ月後
  const progress = computeGoalProgress(goal(), { asOf: '2026-07-24', monthlyPace: 100000 })

  assert.equal(progress.progressRate, 0.2)
  assert.equal(progress.remainingAmount, 4000000)
  assert.equal(progress.projectedAchievementMonth, addMonthsToMonth('2026-07', 40))
  assert.equal(progress.projectedAchievementMonth, '2029-11')
})

test('computeGoalProgress marks behind when the pace is below the required amount', () => {
  const required = requiredMonthlyContribution(
    { target_amount: 5000000, target_date: '2030-12-31', current_amount: 1000000 },
    '2026-07'
  ) as number

  const behind = computeGoalProgress(goal(), { asOf: '2026-07-24', monthlyPace: Math.floor(required * 0.5) })
  const onTrack = computeGoalProgress(goal(), { asOf: '2026-07-24', monthlyPace: required })

  assert.equal(behind.status, 'behind')
  assert.equal(onTrack.status, 'on_track')
})

test('computeGoalProgress marks stalled with no contributions, and achieved when reached', () => {
  const stalled = computeGoalProgress(goal(), { asOf: '2026-07-24', monthlyPace: 0 })
  assert.equal(stalled.status, 'stalled')
  assert.equal(stalled.projectedAchievementMonth, null)

  const done = computeGoalProgress(goal({ current_amount: 5000000 }), {
    asOf: '2026-07-24',
    monthlyPace: 0,
  })
  assert.equal(done.status, 'achieved')
  assert.equal(done.remainingAmount, 0)
  assert.equal(done.projectedAchievementMonth, '2026-07')
})

test('computeGoalProgress falls back to the stored monthly_contribution as the pace', () => {
  const progress = computeGoalProgress(goal({ monthly_contribution: 80000 }), {
    asOf: '2026-07-24',
  })
  assert.equal(progress.monthlyPace, 80000)
})

test('monthlyPaceFrom averages contributions over the window', () => {
  const pace = monthlyPaceFrom(
    [
      { date: '2026-05-10', amount: 50000 },
      { date: '2026-06-10', amount: 70000 },
      { date: '2026-07-10', amount: 60000 },
      { date: '2026-03-10', amount: 999999 }, // 期間外
    ],
    { fromMonth: '2026-05', toMonth: '2026-07' }
  )
  assert.equal(pace, 60000)
})

test('pickPrimaryGoal prefers priority, then the nearest target date', () => {
  const goals = [
    goal({ id: 'a', title: '車', priority: 0, target_date: '2028-03-31' }),
    goal({ id: 'b', title: '住宅', priority: 5, target_date: '2032-03-31' }),
    goal({ id: 'c', title: '完了済み', priority: 9, status: 'achieved' }),
  ]
  assert.equal(pickPrimaryGoal(goals)?.id, 'b')

  const flat = [
    goal({ id: 'a', priority: 0, target_date: '2028-03-31' }),
    goal({ id: 'b', priority: 0, target_date: '2027-03-31' }),
  ]
  assert.equal(pickPrimaryGoal(flat)?.id, 'b')
  assert.equal(pickPrimaryGoal([]), null)
})
