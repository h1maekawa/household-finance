// scripts/backfill-card-issuer.mjs
//
// card_issuer が NULL のカード利用を修復する一度きりのスクリプト。
//
// なぜ必要か:
//   lib/cashflow.ts の cardMatchesTransaction() は payment_method か card_issuer が
//   カード名と一致しない取引を弾く。GAS 側が card_issuer を送るようになったのは
//   2026年7月中旬で、それ以前に取り込んだカード利用は card_issuer が NULL のまま
//   どのカードの請求にも入らず、請求見込みから黙って消えていた。
//
// 発行元の判定:
//   楽天カードのメールパーサーは店名の前にコロンを残すため、memo が
//   "自動連携 (: 店名)" になる。三井住友は "自動連携 (店名)"。
//   実データ120件で確認済み(楽天側は「楽天証券投信積立」「スイドウリ」等、
//   三井住友側は "LUUP INC." "FAMILYMART" 等と、内容とも整合する)。
//
// 使い方:
//   node scripts/backfill-card-issuer.mjs --dry-run   # 変更内容だけ表示
//   node scripts/backfill-card-issuer.mjs --apply     # 実行
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const apply = process.argv.includes('--apply')
if (!apply && !process.argv.includes('--dry-run')) {
  console.error('--dry-run か --apply を指定してください')
  process.exit(1)
}

const envPath = path.join(process.cwd(), '.env.local')
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(line => line.includes('=') && !line.trimStart().startsWith('#'))
    .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])
)

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const isTestRow = tx =>
  (tx.memo ?? '').includes('テスト用取引') || (tx.external_id ?? '').startsWith('test-')

/** 楽天のメールパーサーは店名の前にコロンを残す */
const isRakutenFormat = tx => /自動連携\s*\(\s*:/.test(tx.memo ?? '')

const { data: rows, error } = await db
  .from('transactions')
  .select('id,date,amount,memo,external_id,user_id')
  .is('card_issuer', null)
  .eq('payment_method', 'クレジットカード')
  .order('date')

if (error) {
  console.error('取得に失敗しました:', error.message)
  process.exit(1)
}

const testRows = rows.filter(isTestRow)
const targets = rows.filter(tx => !isTestRow(tx))
const rakuten = targets.filter(isRakutenFormat)
const smbc = targets.filter(tx => !isRakutenFormat(tx))
const sum = list => list.reduce((total, tx) => total + tx.amount, 0)

console.log(`三井住友カードとして埋める : ${smbc.length}件 ${sum(smbc).toLocaleString()}円`)
console.log(`楽天カードとして埋める     : ${rakuten.length}件 ${sum(rakuten).toLocaleString()}円`)
console.log(`削除するテストデータ       : ${testRows.length}件 ${sum(testRows).toLocaleString()}円`)

if (!apply) {
  console.log('\n--dry-run のため何も変更していません。')
  process.exit(0)
}

for (const [issuer, list] of [['三井住友カード', smbc], ['楽天カード', rakuten]]) {
  if (list.length === 0) continue
  // in() の URL 長を避けるため 100 件ずつ流す
  for (let offset = 0; offset < list.length; offset += 100) {
    const ids = list.slice(offset, offset + 100).map(tx => tx.id)
    const { error: updateError } = await db
      .from('transactions')
      .update({ card_issuer: issuer, updated_at: new Date().toISOString() })
      .in('id', ids)
    if (updateError) {
      console.error(`${issuer} の更新に失敗しました:`, updateError.message)
      process.exit(1)
    }
  }
  console.log(`✔ ${issuer}: ${list.length}件を更新しました`)
}

if (testRows.length > 0) {
  const { error: deleteError } = await db
    .from('transactions')
    .delete()
    .in('id', testRows.map(tx => tx.id))
  if (deleteError) {
    console.error('テストデータの削除に失敗しました:', deleteError.message)
    process.exit(1)
  }
  console.log(`✔ テストデータ ${testRows.length}件を削除しました`)
}

console.log('\n完了しました。')
