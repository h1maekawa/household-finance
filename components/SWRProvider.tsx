'use client'
import { SWRConfig } from 'swr'
import { fetcher } from '@/lib/fetcher'

// SWR の共通設定。ダッシュボードだけで8本のリクエストが並走するため、
// 重複排除の窓を明示的に持たせる(既定は 2000ms)。
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        dedupingInterval: 5000,
        revalidateOnFocus: false, // 家計データは秒単位で変わらない。復帰のたびの再取得は無駄
      }}
    >
      {children}
    </SWRConfig>
  )
}
