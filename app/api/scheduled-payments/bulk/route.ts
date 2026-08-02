// app/api/scheduled-payments/bulk/route.ts
//
// 「現在の固定費を一括登録」。ログイン中のユーザー自身が画面から実行する。
// ユーザーIDを埋め込んだマイグレーションは作らない方針なので、投入はここを通す。
//
// GET  … 登録前のプレビュー。カード・口座の解決結果と、既存データとの衝突を返す。
// POST … 実際の登録。衝突した項目は mode('keep' | 'update' | 'skip') に従う。
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import {
  FIXED_COST_PRESET,
  fixedCostIdentity,
  presetInvestmentTotal,
  presetLivingFixedTotal,
  presetTotal,
  type FixedCostPresetItem,
} from '@/lib/fixed-cost-preset'
import type { CreditCardSetting, ScheduledPayment } from '@/types/cashflow'

/** カード名の表記ゆれを吸収する */
function normalizeName(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\s　()（）]/g, '')
}

type CardResolution =
  | { status: 'resolved'; cardId: string; cardName: string }
  | { status: 'missing'; cardName: string }
  | { status: 'ambiguous'; cardName: string; candidates: { id: string; name: string }[] }

/**
 * カード名 → カードID。同名が複数あるときは自動で決めず ambiguous を返す。
 * 勝手に片方へ寄せると、引き落とし日も口座も違うカードに紐づく事故になる。
 */
function resolveCard(cardName: string | undefined, cards: CreditCardSetting[]): CardResolution | null {
  if (!cardName) return null
  const target = normalizeName(cardName)
  const matches = cards.filter(card => normalizeName(card.name) === target)
  if (matches.length === 1) return { status: 'resolved', cardId: matches[0].id, cardName: matches[0].name }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      cardName,
      candidates: matches.map(card => ({ id: card.id, name: card.name })),
    }
  }
  return { status: 'missing', cardName }
}

type PreviewItem = {
  name: string
  amount: number
  category: string
  amountType: string
  paymentMethod: string
  dueDay: number | null
  matchKeywords: string[]
  note?: string
  card: CardResolution | null
  /** 既存の同一固定費。あれば keep / update / skip をユーザーに選ばせる */
  existing: { id: string; name: string; amount: number } | null
  /** 支払日・引落口座が埋まっていない。予測には出せるが「確認が必要」と出す */
  needsConfirmation: boolean
}

async function loadContext(userId: string) {
  const [cardsRes, paymentsRes] = await Promise.all([
    supabaseAdmin.from('credit_cards').select('*').eq('user_id', userId),
    supabaseAdmin.from('scheduled_payments').select('*').eq('user_id', userId),
  ])
  if (cardsRes.error) throw new Error(cardsRes.error.message)
  if (paymentsRes.error) throw new Error(paymentsRes.error.message)
  return {
    cards: (cardsRes.data ?? []) as CreditCardSetting[],
    payments: (paymentsRes.data ?? []) as ScheduledPayment[],
  }
}

function buildPreview(
  items: FixedCostPresetItem[],
  cards: CreditCardSetting[],
  payments: ScheduledPayment[]
): PreviewItem[] {
  // 既存データを「名前 + 支払方法 + カード」で引けるようにする。
  // 名前だけで判定すると、口座引落の水道代とカード払いの水道代を取り違える。
  const existingByIdentity = new Map(
    payments.map(payment => [
      fixedCostIdentity({
        name: payment.name,
        paymentMethod: payment.payment_method,
        cardId: payment.credit_card_id,
      }),
      payment,
    ])
  )

  return items.map(item => {
    const card = resolveCard(item.cardName, cards)
    const cardId = card?.status === 'resolved' ? card.cardId : null
    const existing = existingByIdentity.get(
      fixedCostIdentity({ name: item.name, paymentMethod: item.paymentMethod, cardId })
    )

    return {
      name: item.name,
      amount: item.amount,
      category: item.category,
      amountType: item.amountType,
      paymentMethod: item.paymentMethod,
      dueDay: item.dueDay,
      matchKeywords: item.matchKeywords,
      note: item.note,
      card,
      existing: existing
        ? { id: existing.id, name: existing.name, amount: existing.amount }
        : null,
      needsConfirmation: item.dueDay === null || (item.paymentMethod === 'credit_card' && !cardId),
    }
  })
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  try {
    const { cards, payments } = await loadContext(user.id)
    const preview = buildPreview(FIXED_COST_PRESET, cards, payments)
    return Response.json({
      items: preview,
      totals: {
        livingFixed: presetLivingFixedTotal(),
        investment: presetInvestmentTotal(),
        total: presetTotal(),
      },
      conflicts: preview.filter(item => item.existing).length,
      needsConfirmation: preview.filter(item => item.needsConfirmation).map(item => item.name),
    })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

type PostBody = {
  /** 既存と衝突した項目の扱い。省略時は 'skip'（既存を壊さない側に倒す） */
  onConflict?: 'keep' | 'update' | 'skip'
  /** 登録する項目名。省略時は全件 */
  names?: string[]
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as PostBody
  const onConflict = body.onConflict === 'update' ? 'update' : body.onConflict === 'keep' ? 'keep' : 'skip'
  const selected = Array.isArray(body.names) && body.names.length > 0
    ? FIXED_COST_PRESET.filter(item => body.names!.includes(item.name))
    : FIXED_COST_PRESET

  try {
    const { cards, payments } = await loadContext(user.id)
    const preview = buildPreview(selected, cards, payments)

    const created: string[] = []
    const updated: string[] = []
    const skipped: { name: string; reason: string }[] = []

    for (const item of preview) {
      if (item.card?.status === 'ambiguous') {
        skipped.push({ name: item.name, reason: `「${item.card.cardName}」が複数あるため自動で決められません` })
        continue
      }
      if (item.card?.status === 'missing') {
        skipped.push({ name: item.name, reason: `カード「${item.card.cardName}」が未登録です` })
        continue
      }

      const cardId = item.card?.status === 'resolved' ? item.card.cardId : null
      const row = {
        user_id: user.id,
        name: item.name,
        amount: item.amount,
        // 支払日が未確認の項目は 1 を入れて「未設定」として扱う。
        // due_day は NOT NULL なので値は要るが、needsConfirmation で警告に回す。
        due_day: item.dueDay ?? 1,
        category: item.category,
        type: 'fixed',
        is_active: true,
        recurrence: 'monthly',
        payment_method: item.paymentMethod,
        credit_card_id: cardId,
        amount_type: item.amountType,
        match_keywords: item.matchKeywords,
        // 引落口座は推測しない。カード払いはカード側の引落口座に合流する
        debit_account_id: null,
      }

      if (item.existing) {
        if (onConflict === 'skip' || onConflict === 'keep') {
          skipped.push({ name: item.name, reason: '既に登録済み' })
          continue
        }
        const { error } = await supabaseAdmin
          .from('scheduled_payments')
          .update(row)
          .eq('id', item.existing.id)
          .eq('user_id', user.id)
        if (error) return Response.json({ error: error.message }, { status: 500 })
        updated.push(item.name)
        continue
      }

      const { error } = await supabaseAdmin.from('scheduled_payments').insert([row])
      if (error) return Response.json({ error: error.message }, { status: 500 })
      created.push(item.name)
    }

    return Response.json({
      created,
      updated,
      skipped,
      totals: {
        livingFixed: presetLivingFixedTotal(),
        investment: presetInvestmentTotal(),
        total: presetTotal(),
      },
    })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
