// AI FP の契約テスト（スペック §33 / §34）。
//
// 「AIは金融計算しない」「AIが数字を決めない」をコードの形として固定する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

/** 説明コメントに反応しないよう、コードだけを見る */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n')
}

const intent = code(read('lib/services/ai-fp-intent.ts'))
const context = code(read('lib/services/ai-fp-context.ts'))
const loader = code(read('lib/services/ai-fp-loader.ts'))
const route = code(read('app/api/coach/chat/route.ts'))
const prompt = read('lib/gemini.ts')
const chatUi = code(read('components/coach/CoachChat.tsx'))

test('意図と金額の判定に AI を使わない', () => {
  // AIに数字を読ませると、読み違えても誰も気付けない（スペック §28）
  for (const [name, src] of [
    ['ai-fp-intent', intent],
    ['ai-fp-context', context],
  ] as const) {
    assert.doesNotMatch(src, /gemini|openai|anthropic|explainFinance/i, `${name}: AIを呼んでいる`)
    assert.doesNotMatch(src, /from ["']@supabase/, `${name}: DBに触っている`)
    assert.doesNotMatch(src, /new Date\(/, `${name}: 現在時刻を読んでいる`)
  }
})

test('計算はすべて既存エンジンに任せる', () => {
  for (const engine of [
    'buildScenarioComparisonSet',
    'expenseReductionAmount',
    'loadMonthlyActions',
    'reviewCandidates',
    'pickPrimaryGoal',
    'buildCoachExplainContext',
  ]) {
    assert.ok(loader.includes(engine), `${engine} を使っていない`)
  }
  // Loader で金融式を書かない
  assert.doesNotMatch(loader, /\* 12|\/ 12|Math\.pow|\*\* /)
})

test('AI へ渡す前に必ず計算結果を作る', () => {
  // route は「意図の判定 → 計算 → 説明」の順を守る
  const loadAt = route.indexOf('loadAiFpAnswerSource')
  const explainAt = route.indexOf('explainFinance')
  assert.ok(loadAt > 0 && explainAt > loadAt, 'explainFinance が計算より先に呼ばれている')
  // 生の取引を渡していない
  assert.doesNotMatch(route, /from\('transactions'\)/)
})

test('AI への指示に §34 の禁止事項が入っている', () => {
  for (const rule of [
    'データに無い金額を推測して答えない',
    '独自に決めない',
    '銘柄',
    '売買のタイミング',
    '保証',
  ]) {
    assert.ok(prompt.includes(rule), `AIへの指示に「${rule}」が無い`)
  }
})

test('画面の数字は AI の文章ではなくサーバーの値を出す', () => {
  // ScenarioResultCard は scenario（サーバーの計算結果）だけを読む
  assert.match(chatUi, /message\.scenario/)
  assert.match(chatUi, /scenario\.comparison/)
  // 文章から数字を抜き出すような処理を持たない
  assert.doesNotMatch(chatUi, /answer\.match|answer\.replace|parseFloat|parseInt/)
})

test('UI で金融計算をしない', () => {
  assert.doesNotMatch(chatUi, /buildScenarioComparisonSet\(|expenseReductionAmount\(|runScenario\(/)
  assert.doesNotMatch(chatUi, /1 \+ |annualReturnRate \/ 12/)
})

test('定型質問はカテゴリ名を決め打ちしない', () => {
  // 「タバコ」等をコードに埋め込まず、ユーザーの実データから作る
  assert.doesNotMatch(intent, /タバコ|外食|コンビニ/)
  assert.match(chatUi, /expenseCutQuestion\(/)
})

test('月数の表示整形は1箇所', () => {
  const engine = code(read('lib/services/scenario-engine.ts'))
  assert.match(engine, /export function formatMonthsDuration/)
  for (const rel of [
    'lib/services/ai-fp-context.ts',
    'components/coach/CoachChat.tsx',
    'components/plan/ScenarioCompare.tsx',
  ]) {
    const src = code(read(rel))
    assert.match(src, /formatMonthsDuration/, `${rel}: 共通の整形を使っていない`)
    assert.doesNotMatch(src, /Math\.floor\(months \/ 12\)/, `${rel}: 整形を書き写している`)
  }
})

test('AI FP のルートは /coach のまま', () => {
  const nav = code(read('lib/nav.ts'))
  assert.match(nav, /href: '\/coach', label: 'AI FP'/)
  assert.doesNotMatch(nav, /label: 'コーチ'/)
})
