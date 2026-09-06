// lib/integrations/scopes.ts
//
// Integration Token の用途と権限の定義。文字列を各所へ直書きしない。
//
// 認可は fail-closed。DBに未知の scope が入っていても、ここに無いものは
// 「権限なし」として扱う（アプリはクラッシュさせない）。

export const INTEGRATION_SCOPES = [
  'transactions:write',
  'finance-summary:read',
  'investment-capacity:read',
  'assets:read',
] as const

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]

export const INTEGRATIONS = ['gas', 'ai_company', 'other'] as const
export type Integration = (typeof INTEGRATIONS)[number]

/**
 * 連携先ごとに付与してよい scope。
 *
 * Token 生成APIは、クライアントから渡された scope をそのまま保存せず、
 * ここを正としてサーバー側で決める（scope escalation の防止）。
 */
export const ALLOWED_SCOPES: Record<Integration, readonly IntegrationScope[]> = {
  // 取込専用。読み取り系は付けない（Least Privilege）
  gas: ['transactions:write'],
  // AI Company は read-only。書き込みは付けない
  ai_company: ['finance-summary:read', 'investment-capacity:read', 'assets:read'],
  other: [],
}

export function isIntegration(value: string): value is Integration {
  return (INTEGRATIONS as readonly string[]).includes(value)
}

export function isKnownScope(value: string): value is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(value)
}

/** DBに入っている scope 文字列のうち、アプリが理解できるものだけを残す */
export function normalizeScopes(raw: unknown): IntegrationScope[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is IntegrationScope => typeof s === 'string' && isKnownScope(s))
}

/** その連携先に付与してよい scope だけへ絞る。生成APIはこれを通す */
export function scopesForIntegration(integration: string): IntegrationScope[] {
  return isIntegration(integration) ? [...ALLOWED_SCOPES[integration]] : []
}
