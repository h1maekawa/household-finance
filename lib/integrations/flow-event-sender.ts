import { createHmac } from 'crypto'

const DELIVERY_TIMEOUT_MS = 3_000

export type CardTransactionCreatedEvent = {
  event: 'card_transaction.created'
  transactionId: string
  date: string
  merchant: string
  amount: number
  card: string
}

export type FlowEventDelivery =
  | { status: 'delivered' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: 'invalid_config' | 'timeout' | 'network' | 'http' }

export function isCardTransaction(input: {
  kind: string
  cardIssuer?: string | null
  paymentMethod?: string | null
}): boolean {
  if (input.kind !== 'expense') return false
  if (input.cardIssuer) return true
  const method = (input.paymentMethod ?? '').toLowerCase()
  return method.includes('カード') || method.includes('card')
}

export function createSignedFlowEvent(input: {
  event: CardTransactionCreatedEvent
  secret: string
  timestamp: string
}) {
  if (!/^\d{13}$/.test(input.timestamp)) {
    throw new Error('Flow event timestamp must be 13-digit Unix milliseconds')
  }
  const rawBody = JSON.stringify(input.event)
  const signature = createHmac('sha256', input.secret)
    .update(`${input.timestamp}.${rawBody}`)
    .digest('hex')

  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      'x-flow-timestamp': input.timestamp,
      'x-flow-signature': `sha256=${signature}`,
    },
  }
}

/**
 * Importの成否と通知の成否を分離する。通知先停止時も登録済み取引を失敗扱いにしない。
 */
export async function sendCardTransactionCreatedEvent(
  event: CardTransactionCreatedEvent,
  options: {
    fetchImpl?: typeof fetch
    now?: () => number
    endpoint?: string
    secret?: string
  } = {}
): Promise<FlowEventDelivery> {
  const endpoint = options.endpoint ?? process.env.AI_COMPANY_FLOW_EVENT_URL
  const secret = options.secret ?? process.env.FLOW_EVENT_SECRET
  if (!endpoint || !secret) return { status: 'disabled' }

  let url: URL
  try {
    url = new URL(endpoint)
    const localHttp = process.env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) {
      return { status: 'failed', reason: 'invalid_config' }
    }
  } catch {
    return { status: 'failed', reason: 'invalid_config' }
  }

  const timestamp = String((options.now ?? Date.now)())
  let signed: ReturnType<typeof createSignedFlowEvent>
  try {
    signed = createSignedFlowEvent({ event, secret, timestamp })
  } catch {
    return { status: 'failed', reason: 'invalid_config' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return { status: 'failed', reason: 'http' }
    return { status: 'delivered' }
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
    }
  } finally {
    clearTimeout(timer)
  }
}
