import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'

export function getBearerToken(request: NextRequest) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

export async function getAuthenticatedUser(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) return null

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null

  return data.user
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
