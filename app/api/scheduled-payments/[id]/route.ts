import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import {
  deleteScheduledPayment,
  updateScheduledPayment,
} from '@/lib/repositories/scheduled-payments'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  try {
    // 書き込み可能な列の絞り込みはリポジトリ(pickWritableFields)が担う
    const payment = await updateScheduledPayment(user.id, id, body)
    return Response.json(payment)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { id } = await params

  try {
    await deleteScheduledPayment(user.id, id)
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
