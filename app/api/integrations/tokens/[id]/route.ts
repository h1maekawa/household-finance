import type { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { revokeToken } from '@/lib/integrations/registry'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { writeFailed } from '@/lib/api-errors'

/**
 * DELETE /api/integrations/tokens/[id] — Token を失効させる。
 * 行は物理削除せず revoked_at を立てる（監査のため）。
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()
  const { id } = await params

  try {
    const revoked = await revokeToken(supabase, user.id, id)
    if (!revoked) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    return writeFailed('api/integrations/tokens/[id]', error)
  }
}
