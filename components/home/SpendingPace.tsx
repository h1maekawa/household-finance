'use client'
// 今月の利用ペース。判定は spending-pace.ts の純関数が正で、
// ここでは「どの位置に印を置くか」という座標変換だけを行う。
import { getSpendingPaceState, SPENDING_PACE_LABEL } from '@/lib/services/spending-pace'

export default function SpendingPace({ pace }: { pace: number }) {
  const state = getSpendingPaceState(pace)
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
          {SPENDING_PACE_LABEL[state]}
          <span className="ml-1 font-normal text-muted tabular-nums">×{pace.toFixed(2)}</span>
        </p>
      </div>
      <div
        className="relative mt-2 h-1.5 rounded-full bg-border"
        role="img"
        aria-label={`利用ペース ${SPENDING_PACE_LABEL[state]}（理想の${pace.toFixed(2)}倍）`}
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
