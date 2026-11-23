export const LIVING_BUFFER_WINDOW_DAYS = 90
export const LIVING_BUFFER_MULTIPLIER = 1.2

export interface LivingBufferResult {
  amount: number
  basis: 'rolling_90d' | 'fixed'
  rolling30d: number | null
  missingData: string[]
}

/**
 * 生活用バッファ = max(直近90日の変動生活費 ÷ 90 × 30 × 1.2, 固定予備費)。
 * 90日分のデータが無い／取得失敗のときは固定予備費を使い、理由を missingData に残す。
 */
export function computeLivingBuffer(input: {
  variableSpend90d: number | null
  dataCoverageDays: number
  fixedBuffer: number
}): LivingBufferResult {
  const { variableSpend90d, dataCoverageDays, fixedBuffer } = input

  if (variableSpend90d === null || dataCoverageDays < LIVING_BUFFER_WINDOW_DAYS) {
    return {
      amount: fixedBuffer,
      basis: 'fixed',
      rolling30d: null,
      missingData: ['直近90日分の支出データが不足しているため、固定予備費を使用しました'],
    }
  }

  const rolling30d = Math.round(
    (variableSpend90d / LIVING_BUFFER_WINDOW_DAYS) * 30 * LIVING_BUFFER_MULTIPLIER
  )
  const useRolling = rolling30d > fixedBuffer
  return {
    amount: useRolling ? rolling30d : fixedBuffer,
    basis: useRolling ? 'rolling_90d' : 'fixed',
    rolling30d,
    missingData: [],
  }
}
