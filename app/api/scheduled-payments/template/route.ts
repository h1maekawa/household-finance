import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import {
  createScheduledPayment,
  findExistingNames,
} from '@/lib/repositories/scheduled-payments'
import { TEMPLATE_ITEMS_BY_NAME } from '@/lib/fixed-cost-templates'

type TemplateSelection = {
  name: string
  amount?: number
  due_day?: number
  category?: string
  debit_account_id?: string | null
  payment_method?: string
  credit_card_id?: string | null
  business_day_rule?: string
}

/**
 * 固定費テンプレート(要件書 §16)からの一括登録。
 *
 * 同名の固定費が既にある場合はスキップして冪等にする。初期設定を
 * やり直したユーザーが固定費を二重登録してしまうのを防ぐため。
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as { items?: TemplateSelection[] }
  const items = Array.isArray(body.items) ? body.items : []

  const valid = items.filter(item => typeof item?.name === 'string' && item.name.trim())
  if (valid.length === 0) {
    return Response.json({ error: '登録する固定費が選択されていません' }, { status: 400 })
  }

  try {
    const existing = await findExistingNames(user.id, valid.map(item => item.name.trim()))

    const created: string[] = []
    const skipped: string[] = []

    for (const item of valid) {
      const name = item.name.trim()
      if (existing.has(name)) {
        skipped.push(name)
        continue
      }

      const template = TEMPLATE_ITEMS_BY_NAME.get(name)
      await createScheduledPayment(user.id, {
        name,
        amount: Number(item.amount) || 0,
        due_day: Number(item.due_day) || template?.defaultDueDay || 27,
        category: item.category ?? template?.category ?? 'その他',
        type: 'fixed',
        is_active: true,
        debit_account_id: item.debit_account_id ?? null,
        payment_method: item.payment_method ?? 'bank_debit',
        credit_card_id: item.credit_card_id ?? null,
        business_day_rule:
          item.business_day_rule ?? template?.defaultBusinessDayRule ?? 'next',
      } as Parameters<typeof createScheduledPayment>[1])
      created.push(name)
    }

    return Response.json({ created, skipped }, { status: 201 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
