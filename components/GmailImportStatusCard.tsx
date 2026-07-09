'use client'

import useSWR from 'swr'

type ImportStatus = {
  ready: boolean
  checks: {
    supabaseUrl: boolean
    serviceRoleKey: boolean
    gasImportSecret: boolean
    gasImportUserId: boolean
    importUserMatchesLogin: boolean
    geminiFallback: boolean
  }
  nextAction: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function GmailImportStatusCard() {
  const { data, error } = useSWR<ImportStatus>('/api/transactions/import', fetcher)

  if (error) return null

  const items = data
    ? [
        ['受け口', data.checks.gasImportSecret],
        ['保存先', data.checks.gasImportUserId && data.checks.importUserMatchesLogin],
        ['DB接続', data.checks.supabaseUrl && data.checks.serviceRoleKey],
        ['AI解析', data.checks.geminiFallback],
      ] as const
    : []

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">カード明細取り込み</p>
          <p className="mt-1 text-xs text-muted">
            {data
              ? data.ready
                ? 'アプリ側は受け取れる状態です'
                : 'アプリ側の設定確認が必要です'
              : '確認中'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${data?.ready ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          {data?.ready ? 'OK' : '確認'}
        </span>
      </div>

      {data && (
        <>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {items.map(([label, ok]) => (
              <div key={label} className="rounded-lg bg-surface px-2 py-2 text-center">
                <p className={`text-sm font-bold ${ok ? 'text-success' : 'text-danger'}`}>{ok ? '✓' : '!'}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">{data.nextAction}</p>
        </>
      )}
    </section>
  )
}
