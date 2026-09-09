// Stripe Event 受理の atomic 性テスト。
//
// 受理の判定は SQL 関数 claim_stripe_event に閉じている（アプリ側で
// SELECT → 判定 → UPSERT に分けると競合の余地が残るため）。
// したがってここでは、
//   1. SQL が原子的な構造を保っていること
//   2. 実DBがあれば、同時 claim で1つだけ勝つこと
// を確認する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION = path.join(process.cwd(), 'supabase/migrations/025_claim_stripe_event.sql')
const sql = readFileSync(MIGRATION, 'utf8')

test('受理は1文の INSERT ... ON CONFLICT DO UPDATE で原子化されている', () => {
  // 判定を別クエリに分けると、その間に別ワーカーが割り込める
  assert.match(sql, /insert into stripe_events[\s\S]*on conflict \(event_id\) do update/)
  assert.match(sql, /returning true into v_claimed/)
})

test('processed は引き取らない（二重適用しない）', () => {
  const guard = sql.slice(sql.indexOf('do update'), sql.indexOf('returning'))
  assert.match(guard, /where stripe_events\.status = 'failed'/)
  assert.match(guard, /stripe_events\.status = 'processing'/)
  assert.doesNotMatch(guard, /'processed'/)
})

test('放置された processing だけを猶予つきで引き取る', () => {
  assert.match(sql, /received_at < now\(\) - p_stale_after/)
})

test('一般ユーザーから RPC を呼べないようにしている', () => {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(sql, new RegExp(`revoke all on function claim_stripe_event[^;]*from ${role}`))
  }
  assert.match(sql, /grant execute on function claim_stripe_event[^;]*to service_role/)
})

/**
 * 実DBに対する同時 claim テスト。
 * Supabase の接続情報があるときだけ走る（CI/ローカルの両方で落とさないため）。
 *
 *   SUPABASE_TEST_URL=... SUPABASE_TEST_SERVICE_ROLE_KEY=... npm test
 */
const dbUrl = process.env.SUPABASE_TEST_URL
const dbKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const hasDb = Boolean(dbUrl && dbKey)

test(
  '同じ event_id を同時に claim すると1つだけ true になる',
  { skip: hasDb ? false : 'SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY が未設定' },
  async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(dbUrl!, dbKey!, { auth: { persistSession: false } })
    const eventId = `evt_test_${Date.now()}_${Math.random().toString(36).slice(2)}`

    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          db.rpc('claim_stripe_event', {
            p_event_id: eventId,
            p_event_type: 'checkout.session.completed',
            p_stale_after: '5 minutes',
          })
        )
      )

      for (const r of results) assert.equal(r.error, null)
      const won = results.filter(r => r.data === true).length
      assert.equal(won, 1, '同時 claim で複数のワーカーが処理権を得ている')
    } finally {
      await db.from('stripe_events').delete().eq('event_id', eventId)
    }
  }
)
