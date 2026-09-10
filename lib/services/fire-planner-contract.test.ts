// FIRE Planner / Milestone の契約テスト。
//
// Phase 3 で決めた「計算は純関数・I/Oは Loader・null は 0 にしない」を
// 新しいモジュールでも崩さないことを、コードの形として固定する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const planner = read('lib/services/fire-planner.ts')
const milestone = read('lib/services/goal-milestone.ts')
const loader = read('lib/services/fire-planner-loader.ts')
const returnAssumptions = read('lib/services/return-assumptions.ts')

test('純関数モジュールは I/O を持たない', () => {
  for (const [name, src] of [
    ['fire-planner', planner],
    ['goal-milestone', milestone],
  ] as const) {
    assert.doesNotMatch(src, /from ["']@supabase/, `${name}: Supabase を import している`)
    assert.doesNotMatch(src, /createSupabaseServerClient|supabaseAdmin/, `${name}: DBに触っている`)
    assert.doesNotMatch(src, /new Date\(/, `${name}: 現在時刻は引数で受け取ること`)
    assert.doesNotMatch(src, /process\.env/, `${name}: 環境変数を読んでいる`)
  }
})

test('生活費の定義を FIRE 用に作り直さない', () => {
  // 必須生活費の組み立ては asset-planning の essentialMonthlyExpenses が正
  assert.doesNotMatch(planner, /variableBudget|livingFixed/)
  assert.match(loader, /emergencyFund\.monthlyEssentialExpenses/)
})

test('総資産と毎月の積立額は既存エンジンの値を使う', () => {
  assert.match(loader, /loadAssetPlanning\(/)
  assert.match(loader, /assets\.totalAssets/)
  assert.match(loader, /monthlyAssetContribution/)
  // 積立額をここで足し直さない
  assert.doesNotMatch(loader, /savings \+ assetBuilding/)
})

test('利回りの仮定の定義は return-assumptions.ts だけ', () => {
  // FIRE Planner と Scenario Engine が同じ前提を共有する。書き写さない
  assert.match(returnAssumptions, /export const OFFICIAL_RETURN_RATES/)
  for (const [name, src] of [
    ['fire-planner', planner],
    ['fire-planner-loader', loader],
  ] as const) {
    assert.doesNotMatch(src, /\[0, 0\.03, 0\.05, 0\.07\]/, `${name}: 正式シナリオを書き写している`)
  }
})

test('税率の既定は0%（税引前）。取り崩しへ一律課税を織り込まない', () => {
  assert.match(planner, /export const DEFAULT_TAX_RATE = 0\b/)
  assert.match(planner, /export const SIMPLIFIED_TAX_RATE = 0\.20315/)
})

test('日付計算を再実装していない', () => {
  assert.match(planner, /from '\.\/goal-progress'/)
  assert.match(milestone, /from '\.\/goal-progress'/)
  for (const src of [planner, milestone]) {
    assert.doesNotMatch(src, /function addMonthsToMonth|function monthsBetween/)
  }
})

test('DB取得失敗を未設定として扱わない', () => {
  assert.match(loader, /if \(error\) throw new Error/)
})

test('目標の逆算を Milestone 側で作り直さない', () => {
  // 必要月額・達成予定月・進捗率は goal-progress.ts が正
  assert.doesNotMatch(milestone, /requiredMonthly|progressRate/)
})
