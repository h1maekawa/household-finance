import { createHash, randomBytes } from 'crypto'

export function createImportSecret() {
  return `gas_${randomBytes(32).toString('base64url')}`
}

export function hashImportSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex')
}
