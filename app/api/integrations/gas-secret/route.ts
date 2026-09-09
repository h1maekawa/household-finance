import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { createImportSecret, hashImportSecret } from '@/lib/import-secrets'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readFailed, writeFailed } from '@/lib/api-errors'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('user_import_secrets')
    .select('id,label,is_active,created_at,last_used_at')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return readFailed('api/integrations/gas-secret', error)
  return Response.json({ secrets: data ?? [] })
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const allowed = await requireActiveEntitlement(user.id)
  if (!allowed) return Response.json({ error: 'Pro purchase required' }, { status: 402 })

  const secret = createImportSecret()
  const { data, error } = await supabase
    .from('user_import_secrets')
    .insert([{ user_id: user.id, secret_hash: hashImportSecret(secret), label: 'GAS' }])
    .select('id,label,is_active,created_at')
    .single()

  if (error) return writeFailed('api/integrations/gas-secret', error)
  return Response.json({ secret, record: data }, { status: 201 })
}
