import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { decideTransactionCategory, MerchantRule } from '@/lib/category-rules'
import { supabaseAdmin } from '@/lib/supabase'
import { Transaction } from '@/types/transaction'

type Body = {
  year?: number
  month?: number
}

function inferCardIssuer(tx: Transaction) {
  const text = `${tx.payment_method} ${tx.memo ?? ''}`.toLowerCase()
  if (text.includes('楽天カード') || text.includes('rakuten-card') || text.includes('rakutenpay')) return '楽天カード'
  if (text.includes('三井住友') || text.includes('vpass') || text.includes('smbc')) return '三井住友カード'
  if (text.includes('クレジットカード')) return '不明'
  return tx.card_issuer ?? null
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body: Body = await request.json().catch(() => ({}))
  let query = supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .eq('kind', 'expense')

  if (body.year && body.month) {
    const month = String(body.month).padStart(2, '0')
    const startDate = `${body.year}-${month}-01`
    const endDate = body.month === 12
      ? `${body.year + 1}-01-01`
      : `${body.year}-${String(body.month + 1).padStart(2, '0')}-01`
    query = query.gte('date', startDate).lt('date', endDate)
  }

  const [transactionsRes, rulesRes] = await Promise.all([
    query,
    supabaseAdmin
      .from('merchant_rules')
      .select('id,merchant_pattern,category,payment_method,confidence')
      .eq('user_id', user.id),
  ])

  if (transactionsRes.error) {
    return Response.json({ error: transactionsRes.error.message }, { status: 500 })
  }
  if (rulesRes.error) {
    return Response.json({ error: rulesRes.error.message }, { status: 500 })
  }

  const rules: MerchantRule[] = rulesRes.data ?? []
  const transactions: Transaction[] = transactionsRes.data ?? []
  let updated = 0
  let review = 0
  let issuerUpdated = 0

  for (const tx of transactions) {
    const decision = decideTransactionCategory(tx, rules)
    const cardIssuer = inferCardIssuer(tx)
    const shouldUpdate =
      tx.auto_category !== decision.category ||
      (tx.card_issuer ?? null) !== cardIssuer ||
      Boolean(tx.needs_review) !== decision.needsReview ||
      (tx.review_reason ?? null) !== decision.reviewReason

    if (!shouldUpdate) continue

    const { error } = await supabaseAdmin
      .from('transactions')
      .update({
        // Suggestions never overwrite a user's category choice.
        auto_category: decision.category,
        card_issuer: cardIssuer,
        needs_review: decision.needsReview,
        review_reason: decision.reviewReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .eq('user_id', user.id)

    if (!error) {
      updated += 1
      if (decision.needsReview) review += 1
      if ((tx.card_issuer ?? null) !== cardIssuer) issuerUpdated += 1
    }
  }

  return Response.json({
    scanned: transactions.length,
    updated,
    review,
    issuerUpdated,
  })
}
