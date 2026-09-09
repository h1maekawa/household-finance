import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { writeFailed } from '@/lib/api-errors'

type Context = { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const supabase = await createSupabaseServerClient()

  const { id } = await params
  const { error } = await supabase
    .from('merchant_rules')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return writeFailed('api/category-rules/[id]', error)
  }

  return Response.json({ success: true })
}
