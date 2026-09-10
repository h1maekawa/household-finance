// Scenario Engine の契約テスト。
//
// 「Pure Function・I/O禁止・new Date()禁止・税計算を複製しない・保証表現を出さない」
// をコードの形として固定する（スペック §4 / §10 / §26 / §31 / §32）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

/**
 * 説明コメントを落としてコードだけを見る。
 * 「new Date() を持たない」と書いた行そのものに反応してしまうため。
 * 行頭が // の行だけを落とすので、'https://' のような文字列は壊さない。
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n')
}

const engine = read('lib/services/scenario-engine.ts')
const loader = read('lib/services/scenario-loader.ts')
const route = read('app/api/scenarios/compare/route.ts')
const ui = read('components/plan/ScenarioCompare.tsx')

const engineCode = code(engine)
const loaderCode = code(loader)
const routeCode = code(route)
const uiCode = code(ui)

test('Scenario Engine は I/O を持たない', () => {
  assert.doesNotMatch(engineCode, /from ["']@supabase/)
  assert.doesNotMatch(engineCode, /createSupabaseServerClient|supabaseAdmin/)
  assert.doesNotMatch(engineCode, /new Date\(/)
  assert.doesNotMatch(engineCode, /process\.env/)
  assert.doesNotMatch(engineCode, /fetch\(/)
})

test('AI をシナリオ計算へ持ち込まない', () => {
  // 数字を決めるのはユーザーか決定論Source（スペック §27 / §28）
  for (const [name, src] of [
    ['scenario-engine', engineCode],
    ['scenario-loader', loaderCode],
    ['compare route', routeCode],
  ] as const) {
    assert.doesNotMatch(src, /gemini|openai|anthropic|explainFinance/i, `${name}: AIを呼んでいる`)
  }
})

test('利回り0%は既存 projection を再利用する', () => {
  // 単純積立の式を2つ持たない（スペック §10）
  assert.match(engine, /from '\.\/projection'/)
  assert.match(engine, /projectAssets\(\{ currentAssets, monthlyContribution, horizons \}\)/)
})

test('到達判定に必ず上限がある', () => {
  assert.match(engine, /export const MAX_PROJECTION_MONTHS = 1200/)
  assert.match(engine, /month <= MAX_PROJECTION_MONTHS/)
})

test('税計算を Scenario 側へ複製しない', () => {
  // FIRE の必要資産をそのまま目標として使うだけ（スペック §31）
  for (const [name, src] of [
    ['scenario-engine', engineCode],
    ['scenario-loader', loaderCode],
  ] as const) {
    assert.doesNotMatch(src, /taxRate|tax_rate|0\.20315/, `${name}: 税率に触れている`)
  }
  assert.match(loader, /firePlan\.primary\.requiredAssets/)
})

test('目標データを Scenario 側へ複製しない', () => {
  // 目標は既存 life_goals から取る（スペック §22）
  assert.match(loader, /listGoals\(/)
  assert.doesNotMatch(loaderCode, /from\('life_goals'\)/)
})

test('Baseline は既存の積立額を再利用する', () => {
  // 通常貯金 + 資産形成を足し直さない（スペック §6 / §7）
  assert.match(loader, /monthlyAssetContribution/)
  assert.doesNotMatch(loaderCode, /savings \+ assetBuilding/)
})

test('比較APIは USER_SESSION + RLS で、結果を保存しない', () => {
  assert.match(routeCode, /getAuthenticatedUser/)
  assert.match(routeCode, /createSupabaseServerClient/)
  assert.doesNotMatch(routeCode, /supabaseAdmin/)
  // シナリオ結果は derived data。保存しない（スペック §25）
  assert.doesNotMatch(routeCode, /\.insert\(|\.upsert\(|\.update\(/)
})

test('画面に保証と読める表現を出さない', () => {
  // スペック §32 の禁止語
  for (const banned of ['確実に', '必ず', 'これだけ儲か', 'この投資なら']) {
    assert.ok(!uiCode.includes(banned), `禁止表現が画面にある: ${banned}`)
  }
  // 仮定であることを明示している
  assert.match(uiCode, /想定|シミュレーション|仮定/)
})

test('画面で複利や削減額を計算しない', () => {
  // 金額はサーバーが出したものを表示するだけ（座標の計算だけ許す）
  assert.doesNotMatch(uiCode, /1 \+ monthlyRate|annualReturnRate \/ 12/)
  assert.doesNotMatch(uiCode, /currentMonth \* /)
})
