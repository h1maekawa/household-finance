// Action Planner の契約テスト。
//
// 「何を見せるか」の判断が UI へ戻らないこと、判定を作り直さないことを
// コードの形として固定する（スペック §35 / §36）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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

const planner = code(read('lib/services/action-planner.ts'))
const loader = code(read('lib/services/action-planner-loader.ts'))
const home = code(read('app/dashboard/page.tsx'))
const actionsUi = code(read('components/home/MonthlyActions.tsx'))

test('Action Planner は純関数', () => {
  assert.doesNotMatch(planner, /from ["']@supabase/)
  assert.doesNotMatch(planner, /createSupabaseServerClient|supabaseAdmin/)
  assert.doesNotMatch(planner, /new Date\(/)
  assert.doesNotMatch(planner, /fetch\(/)
})

test('判定を Action Planner で作り直さない', () => {
  // 超過・ペース・引落不足の判定は coach-rules、金額は既存エンジンが正
  assert.doesNotMatch(planner, /\.pace >|\.spent >|budget -|spent -/)
  assert.doesNotMatch(planner, /computeBudget\(|computeCategoryProgress\(/)
})

test('AI を使わない', () => {
  for (const [name, src] of [
    ['action-planner', planner],
    ['action-planner-loader', loader],
  ] as const) {
    assert.doesNotMatch(src, /gemini|openai|anthropic|explainFinance/i, `${name}: AIを呼んでいる`)
  }
})

test('件数の上限がある', () => {
  assert.match(planner, /export const MAX_MONTHLY_ACTIONS = 5/)
  assert.match(planner, /export const HOME_ACTION_LIMIT = 3/)
  assert.match(planner, /\.slice\(0, MAX_MONTHLY_ACTIONS\)/)
})

test('Loader は既存エンジンの結果を集めるだけ', () => {
  for (const source of [
    'loadAssetPlanning',
    'loadCoachInputs',
    'buildCoachInsights',
    'loadCashflow',
  ]) {
    assert.ok(loader.includes(source), `${source} を使っていない`)
  }
  // 取得失敗を0件として流さない
  assert.match(loader, /throw new Error/)
})

test('Home は「何を出すか」を自分で決めない', () => {
  // 以前はここで5つのAPIを見て条件分岐していた
  assert.doesNotMatch(home, /isNegative|unassignedCardUsage|needs_review/)
  assert.doesNotMatch(home, /emergencyFund\?\.status|emergency\?\.status/)
  assert.match(home, /MonthlyActions/)
})

test('一覧の表示側も条件を足さない', () => {
  // 並べ替え・絞り込みの判断はサーバー。ここは受け取った順に出すだけ
  assert.doesNotMatch(actionsUi, /\.sort\(|\.filter\(/)
  assert.match(actionsUi, /HOME_ACTION_LIMIT/)
})

test('行動のリンク先が実在する画面・タブと一致する', () => {
  // AccountMenu で踏んだ「押せるのに存在しない導線」を繰り返さない
  const tabsFileByPage: Record<string, string> = {
    '/transactions': 'app/transactions/TransactionTabs.tsx',
    '/plan': 'app/plan/PlanTabs.tsx',
    '/investments': 'app/investments/AssetsTabs.tsx',
  }
  const pages = readdirSync(path.join(process.cwd(), 'app'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'api')
    .map(entry => `/${entry.name}`)

  const hrefs = [...planner.matchAll(/href: '([^']+)'/g)].map(match => match[1])
  assert.ok(hrefs.length > 0, 'href を読み取れない')

  for (const href of hrefs) {
    const [page, query] = href.split('?')
    assert.ok(pages.includes(page), `存在しない画面へのリンク: ${href}`)

    const tab = new URLSearchParams(query ?? '').get('tab')
    if (!tab) continue
    const tabsFile = tabsFileByPage[page]
    assert.ok(tabsFile, `${page} のタブ定義が契約テストに登録されていない`)
    const validTabs = [...read(tabsFile).matchAll(/\{ key: '([a-z]+)', label: '[^']+' \}/g)].map(
      match => match[1]
    )
    assert.ok(validTabs.length > 0, `${tabsFile} からタブを読み取れない`)
    assert.ok(validTabs.includes(tab), `存在しないタブへのリンク: ${href}（${page} の実在タブ: ${validTabs.join(', ')}）`)
  }
})

test('表示用の金額書式は1箇所', () => {
  const money = code(read('lib/services/money.ts'))
  assert.match(money, /export function formatYenPlain/)
  const amountBlock = code(read('components/home/AmountBlock.tsx'))
  assert.match(amountBlock, /formatYenPlain/)
  assert.doesNotMatch(amountBlock, /toLocaleString\('ja-JP'\)/)
})
