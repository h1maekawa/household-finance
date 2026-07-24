import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { updateAccount, deleteAccount, recordBalance } from '@/lib/repositories/accounts'

const VALID_TYPES = ['bank', 'emoney', 'cash', 'securities'] as const

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  const { id } = await params

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const patch: Parameters<typeof updateAccount>[2] = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (VALID_TYPES.includes(body.type as never)) patch.type = body.type as never
  if (typeof body.institution === 'string') patch.institution = body.institution
  if (typeof body.is_primary === 'boolean') patch.is_primary = body.is_primary
  if (body.display_order !== undefined) patch.display_order = Number(body.display_order) || 0
  if (body.balance !== undefined && Number.isFinite(Number(body.balance))) {
    patch.balance = Number(body.balance)
  }

  try {
    const account = await updateAccount(user.id, id, patch)
    return Response.json(account)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

/** POST /api/accounts/:id/balance 相当: 残高スナップショットだけを追加する */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  const { id } = await params

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const balance = Number(body.balance)
  if (!Number.isFinite(balance)) {
    return Response.json({ error: '残高を入力してください' }, { status: 400 })
  }

  try {
    await recordBalance(user.id, id, balance)
    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  const { id } = await params

  try {
    await deleteAccount(user.id, id)
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
