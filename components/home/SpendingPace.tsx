'use client'
// 今月の利用ペース。判定は budget-engine の pace をそのまま使い、
// ここでは「どの位置に印を置くか」だけを決める。
const LABEL = { ok: '順調', fast: 'やや速い', over: '使いすぎ' } as const

export function paceState(pace: number): keyof typeof LABEL {
  if (pace > 1.15) return 'over'
  if (pace > 1.0) return 'fast'
  return 'ok'
}

export default function SpendingPace({ pace }: { pace: number }) {
  const state = paceState(pace)
  // 1.0 を中央に置き、0〜2 を 0〜100% へ写す（座標変換のみ）
  const position = Math.min(Math.max(pace, 0), 2) / 2
  const color =
    state === 'over' ? 'bg-danger' : state === 'fast' ? 'bg-warning' : 'bg-success'
  const text =
    state === 'over' ? 'text-danger' : state === 'fast' ? 'text-warning' : 'text-success'

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] text-muted">今月の利用ペース</p>
        <p className={`text-[12px] font-bold ${text}`}>
          {LABEL[state]}
          <span className="ml-1 font-normal text-muted tabular-nums">×{pace.toFixed(2)}</span>
        </p>
      </div>
      <div
        className="relative mt-2 h-1.5 rounded-full bg-border"
        role="img"
        aria-label={`利用ペース ${LABEL[state]}（理想の${pace.toFixed(2)}倍）`}
      >
        {/* 理想位置(=1.0)の目盛り。色だけで良し悪しを伝えない */}
        <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-muted/50" />
        <span
          className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${color}`}
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>ゆっくり</span>
        <span>理想</span>
        <span>速い</span>
      </div>
    </div>
  )
}
