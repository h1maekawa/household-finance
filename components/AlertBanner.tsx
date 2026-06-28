'use client'
import { useState } from 'react'

interface Alert {
  type: string
  message: string
  severity: 'warning' | 'info'
}

interface Props {
  alerts: Alert[]
}

export default function AlertBanner({ alerts }: Props) {
  const [dismissed, setDismissed] = useState<string[]>([])

  const visible = alerts.filter(a => !dismissed.includes(a.type))
  if (visible.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {visible.map(alert => (
        <div
          key={alert.type}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
            alert.severity === 'warning'
              ? 'bg-warning/10 text-warning border border-warning/20'
              : 'bg-primary/10 text-primary border border-primary/20'
          }`}
        >
          <span className="text-base mt-0.5 shrink-0">
            {alert.severity === 'warning' ? '⚠' : 'ℹ'}
          </span>
          <p className="flex-1">{alert.message}</p>
          <button
            onClick={() => setDismissed(d => [...d, alert.type])}
            className="shrink-0 opacity-60 hover:opacity-100 transition-base"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
