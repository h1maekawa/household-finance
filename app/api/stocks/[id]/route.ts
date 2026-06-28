import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { StockHoldingInput } from '@/types/stock'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Context) {
  const { id } = await params
  const body: Partial<StockHoldingInput> = await request.json()

  const { data, error } = await supabaseAdmin
    .from('stock_holdings')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { id } = await params

  const { error } = await supabaseAdmin
    .from('stock_holdings')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
