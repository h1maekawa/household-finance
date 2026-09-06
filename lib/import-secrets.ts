import { createHash, randomBytes } from 'crypto'
import type { Integration } from '@/lib/integrations/scopes'

/**
 * Token の接頭辞。ログや利用者が種別を見分けるためだけのもので、
 * 認証の根拠にはしない（照合は secret_hash の完全一致）。
 * 既存の `gas_...` Token もそのまま認証できる。
 */
const PREFIX: Record<Integration, string> = {
  gas: 'flow_gas',
  ai_company: 'flow_aic',
  other: 'flow_int',
}

/** Integration Token を発行する。平文はここでしか存在しない */
export function createIntegrationSecret(integration: Integration): string {
  return `${PREFIX[integration]}_${randomBytes(32).toString('base64url')}`
}

/** 後方互換: 既存の呼び出し（GAS用）を壊さない */
export function createImportSecret(): string {
  return createIntegrationSecret('gas')
}

/** DBには平文を保存せず、このハッシュだけを保存する */
export function hashImportSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}
