// app/api/credit-cards/statement/route.ts
//
// カード会社が確定させた請求額を登録する。
//
// なぜ手入力が要るのか:
//   利用通知メールの積み上げは、締め日時点では原理的に実額と一致しない。
//   売上確定日が利用日とズレる、年会費・分割手数料の通知が来ない、
//   海外利用は為替確定まで金額が動く、といった理由による。
//   楽天カードは確定額メールが来るので自動で置き換わるが(gas/gmail-import.gs)、
//   三井住友カードの支払日案内メールには金額が載っていないため、
//   Vpass の「次回お支払い金額」を人が入れる以外に正解を取る方法がない。
//
// 保存先に scheduled_payments を使う理由:
//   確定額は「日付と金額が確定した支払い」そのものなので、専用テーブルを足さずとも
//   既存の予測パイプライン(projectCashflow)にそのまま乗る。
//   external_id の unique 制約(migration 011)が同一サイクルの二重登録を防ぐ。
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { statementExternalId } from '@/lib/cashflow'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type StatementBody = {
  card_id?: string
  payment_date?: string
  amount?: number
}

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as StatementBody
  const cardId = String(body.card_id ?? '').trim()
  const paymentDate = String(body.payment_date ?? '').trim()
  const amount = Math.round(Number(body.amount))

  if (!cardId || !DATE_PATTERN.test(paymentDate)) {
    return Response.json({ error: 'カードと引き落とし日を指定してください' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return Response.json({ error: '確定額は0以上の数値で入力してください' }, { status: 400 })
  }

  // 他人のカードIDを渡して行を作られないよう、必ず本人のカードか確認する
  const { data: card, error: cardError } = await supabaseAdmin
    .from('credit_cards')
    .select('id, name, debit_account_id')
    .eq('id', cardId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (cardError) return Response.json({ error: cardError.message }, { status: 500 })
  if (!card) return Response.json({ error: 'カードが見つかりません' }, { status: 404 })

  const externalId = statementExternalId(card.id, paymentDate)
  const row = {
    user_id: user.id,
    name: `${card.name} 請求（確定）`,
    amount,
    due_day: Number(paymentDate.slice(8, 10)),
    category: 'クレカ請求',
    type: 'credit',
    is_active: true,
    memo: 'カード会社の確定請求額',
    scheduled_date: paymentDate,
    external_id: externalId,
    source: 'card_statement',
    credit_card_id: card.id,
    debit_account_id: card.debit_account_id ?? null,
  }

  // upsert は使えない。external_id の一意インデックス(migration 011)は
  // `where external_id is not null` の部分インデックスで、Postgres の ON CONFLICT は
  // 述語込みでないと推論できず "no unique or exclusion constraint matching" になる。
  const updated = await supabaseAdmin
    .from('scheduled_payments')
    .update(row)
    .eq('user_id', user.id)
    .eq('external_id', externalId)
    .select()
    .maybeSingle()

  if (updated.error) return Response.json({ error: updated.error.message }, { status: 500 })
  if (updated.data) return Response.json(updated.data)

  const inserted = await supabaseAdmin
    .from('scheduled_payments')
    .insert([row])
    .select()
    .single()

  // 同時に2回叩かれた場合は部分インデックスが二重登録を弾く。既にある行を返す。
  if (inserted.error?.code === '23505') {
    const { data, error } = await supabaseAdmin
      .from('scheduled_payments')
      .update(row)
      .eq('user_id', user.id)
      .eq('external_id', externalId)
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  if (inserted.error) return Response.json({ error: inserted.error.message }, { status: 500 })

  return Response.json(inserted.data)
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const cardId = request.nextUrl.searchParams.get('card_id') ?? ''
  const paymentDate = request.nextUrl.searchParams.get('payment_date') ?? ''
  if (!cardId || !DATE_PATTERN.test(paymentDate)) {
    return Response.json({ error: 'カードと引き落とし日を指定してください' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('scheduled_payments')
    .delete()
    .eq('user_id', user.id)
    .eq('external_id', statementExternalId(cardId, paymentDate))
    .eq('source', 'card_statement')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
