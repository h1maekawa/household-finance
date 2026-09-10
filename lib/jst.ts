// lib/jst.ts
//
// 「今日」「今月」は日本時間で決める。サーバーのタイムゾーンに依存させると、
// 月初・月末に一日ズレて「今月あと使える」が別の月の値になる。
//
// 同じ関数が各 route.ts に4つ複製されていたので1箇所へ寄せた。

/** 日本時間の当月 'YYYY-MM' */
export function currentMonthJst(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
}

/** 日本時間の今日 'YYYY-MM-DD' */
export function todayJst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** ?month= の値。形式が違えば当月にフォールバックする */
export function resolveMonthParam(raw: string | null): string {
  return /^\d{4}-\d{2}$/.test(raw ?? '') ? (raw as string) : currentMonthJst()
}
