import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.headers.get('stripe-signature')
  const payload = await request.text()

  if (!webhookSecret || !signature || !verifyStripeSignature(payload, signature, webhookSecret)) {
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = JSON.parse(payload)
  if (event.type !== 'checkout.session.completed') {
    return Response.json({ received: true })
  }

  const session = event.data?.object
  const userId = session?.metadata?.user_id ?? session?.client_reference_id
  if (!userId) {
    return Response.json({ error: 'Missing user id' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('user_entitlements')
    .upsert({
      user_id: userId,
      plan: 'pro_lifetime',
      status: 'active',
      source: 'stripe',
      stripe_customer_id: session.customer ?? null,
      stripe_checkout_session_id: session.id ?? null,
      purchased_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ received: true })
}

function verifyStripeSignature(payload: string, signature: string, secret: string) {
  const timestamp = signature.split(',').find(part => part.startsWith('t='))?.slice(2)
  const signatures = signature
    .split(',')
    .filter(part => part.startsWith('v1='))
    .map(part => part.slice(3))

  if (!timestamp || signatures.length === 0) return false

  const signedPayload = `${timestamp}.${payload}`
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')

  return signatures.some(sig => {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  })
}
