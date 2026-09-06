// UI層の契約テスト。
//
// Phase 3 までに確立した「金融計算はサーバーの純関数」「押せるのに動かない
// 導線を作らない」を、コードの形として固定する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full))
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const uiFiles = [...tsxFiles(path.join(ROOT, 'app')), ...tsxFiles(path.join(ROOT, 'components'))].map(
  file => ({ rel: path.relative(ROOT, file), src: readFileSync(file, 'utf8') })
)

test('金融計算の関数がUI層に無い', () => {
  // これらはサーバーで実行し、画面は結果を表示するだけにする
  const engines = [
    'buildMoneyPlan(',
    'computeInvestmentCapacity(',
    'computeEmergencyFund(',
    'projectAssets(',
    'computeBudget(',
    'buildAssetPlan(',
  ]
  const offenders: string[] = []
  for (const file of uiFiles) {
    for (const engine of engines) {
      if (file.src.includes(engine)) offenders.push(`${file.rel} -> ${engine}`)
    }
  }
  assert.deepEqual(offenders, [], `UI層で金融計算を呼んでいる: ${offenders.join(', ')}`)
})

test('AccountMenu のリンク先が実在する設定タブと一致する', () => {
  const menu = uiFiles.find(f => f.rel.endsWith('components/AccountMenu.tsx'))
  const settings = uiFiles.find(f => f.rel.endsWith('app/settings/page.tsx'))
  assert.ok(menu && settings)

  const validTabs = [...settings!.src.matchAll(/\{ key: '([a-z]+)', label: '[^']+' \}/g)].map(m => m[1])
  assert.ok(validTabs.length > 0, '設定タブを読み取れない')

  const linked = [...menu!.src.matchAll(/\/settings\?section=([a-z]+)/g)].map(m => m[1])
  for (const section of linked) {
    assert.ok(validTabs.includes(section), `存在しない設定セクションへのリンク: ${section}`)
  }

  // settings 側が section を読んでいること（読まないと必ず既定タブが開く）
  assert.match(settings!.src, /searchParams\.get\('section'\)/)
})

test('ログインが要る画面はすべて proxy の保護対象', () => {
  const proxy = readFileSync(path.join(ROOT, 'proxy.ts'), 'utf8')
  const protectedPaths = [...proxy.matchAll(/^\s+'(\/[a-z/-]+)',$/gm)].map(m => m[1])

  // app/ 直下のページのうち、未ログインでも見せてよいものだけを除外する
  const publicPaths = ['/', '/flow/setup']
  const pages = readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && entry.name !== 'api')
    .map(entry => `/${entry.name}`)

  const unprotected = pages.filter(
    page => !publicPaths.includes(page) && !protectedPaths.includes(page) && page !== '/flow'
  )
  assert.deepEqual(unprotected, [], `proxy.ts の保護対象に入っていない: ${unprotected.join(', ')}`)
})

test('Quick Add は実装済みの操作だけを出す', () => {
  const quickAdd = uiFiles.find(f => f.rel.endsWith('components/QuickAdd.tsx'))
  assert.ok(quickAdd)
  // 振替とカード請求の単発登録は未実装。メニューに並べると Fake Action になる。
  // 説明コメントには出てよいので、表示ラベルだけを見る
  const labels = [...quickAdd!.src.matchAll(/label="([^"]+)"/g)].map(m => m[1])
  for (const gone of ['振替', 'カード請求を追加']) {
    assert.ok(!labels.includes(gone), `未実装の操作をメニューに出している: ${gone}`)
  }
  assert.ok(labels.includes('支出を追加') && labels.includes('収入を追加'))
  // 入力フォームは既存を再利用する（同じフォームを2実装しない）
  assert.match(quickAdd!.src, /TransactionForm/)
})

test('Coach の対話は実際に回答するAPIへ繋がっている', () => {
  const chat = uiFiles.find(f => f.rel.endsWith('components/coach/CoachChat.tsx'))
  assert.ok(chat, 'CoachChat が無い')
  assert.match(chat!.src, /\/api\/coach\/chat/)
  // 「近日公開」の見せかけを完成扱いにしない
  assert.doesNotMatch(chat!.src, /近日公開/)
})
