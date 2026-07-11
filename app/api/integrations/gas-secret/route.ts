import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { createImportSecret, hashImportSecret } from '@/lib/import-secrets'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const { data, error } = await supabaseAdmin
    .from('user_import_secrets')
    .select('id,label,is_active,created_at,last_used_at')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ secrets: data ?? [] })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const allowed = await requireActiveEntitlement(user.id)
  if (!allowed) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const secret = createImportSecret()
  const { data, error } = await supabaseAdmin
    .from('user_import_secrets')
    .insert([{ user_id: user.id, secret_hash: hashImportSecret(secret), label: 'GAS' }])
    .select('id,label,is_active,created_at')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ secret, record: data }, { status: 201 })
}
