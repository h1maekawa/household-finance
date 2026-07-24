import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { listAccountsWithBalances, createAccount } from '@/lib/repositories/accounts'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()
  try {
    const accounts = await listAccountsWithBalances(user.id)
    return Response.json(accounts)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

const VALID_TYPES = ['bank', 'emoney', 'cash', 'securities'] as const

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return Response.json({ error: '口座名を入力してください' }, { status: 400 })

  const type = VALID_TYPES.includes(body.type as never)
    ? (body.type as (typeof VALID_TYPES)[number])
    : 'bank'
  const balance = body.balance === undefined ? undefined : Number(body.balance)

  try {
    const account = await createAccount(user.id, {
      name,
      type,
      institution: typeof body.institution === 'string' ? body.institution : null,
      is_primary: Boolean(body.is_primary),
      display_order: Number(body.display_order) || 0,
      balance: balance !== undefined && Number.isFinite(balance) ? balance : undefined,
    })
    return Response.json(account, { status: 201 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
