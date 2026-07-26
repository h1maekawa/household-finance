// lib/holiday-jp.ts
// 日本国民の祝日・休日（昭和内閣府告示ベース）
// 出典: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
// ※ 令和10年（2028年）以降は翌年2月に内閣府から公開されるため、判明次第追記する。

/** YYYY-MM-DD 形式の祝日・振替休日・休日セット */
const HOLIDAY_SET = new Set<string>([
  // ── 令和7年（2025年） ──────────────────────────
  '2025-01-01', // 元日
  '2025-01-13', // 成人の日
  '2025-02-11', // 建国記念の日
  '2025-02-23', // 天皇誕生日
  '2025-02-24', // 振替休日（天皇誕生日）
  '2025-03-20', // 春分の日
  '2025-04-29', // 昭和の日
  '2025-05-03', // 憲法記念日
  '2025-05-04', // みどりの日
  '2025-05-05', // こどもの日
  '2025-05-06', // 振替休日（こどもの日）
  '2025-07-21', // 海の日
  '2025-08-11', // 山の日
  '2025-09-15', // 敬老の日
  '2025-09-23', // 秋分の日
  '2025-10-13', // スポーツの日
  '2025-11-03', // 文化の日
  '2025-11-23', // 勤労感謝の日
  '2025-11-24', // 振替休日（勤労感謝の日）

  // ── 令和8年（2026年） ──────────────────────────
  '2026-01-01', // 元日
  '2026-01-12', // 成人の日
  '2026-02-11', // 建国記念の日
  '2026-02-23', // 天皇誕生日
  '2026-03-20', // 春分の日
  '2026-04-29', // 昭和の日
  '2026-05-03', // 憲法記念日
  '2026-05-04', // みどりの日
  '2026-05-05', // こどもの日
  '2026-05-06', // 休日（祝日法第3条第2項）
  '2026-07-20', // 海の日
  '2026-08-11', // 山の日
  '2026-09-21', // 敬老の日
  '2026-09-22', // 休日（祝日法第3条第3項）
  '2026-09-23', // 秋分の日
  '2026-10-12', // スポーツの日
  '2026-11-03', // 文化の日
  '2026-11-23', // 勤労感謝の日

  // ── 令和9年（2027年） ──────────────────────────
  '2027-01-01', // 元日
  '2027-01-11', // 成人の日
  '2027-02-11', // 建国記念の日
  '2027-02-23', // 天皇誕生日
  '2027-03-21', // 春分の日
  '2027-03-22', // 休日（祝日法第3条第2項）
  '2027-04-29', // 昭和の日
  '2027-05-03', // 憲法記念日
  '2027-05-04', // みどりの日
  '2027-05-05', // こどもの日
  '2027-07-19', // 海の日
  '2027-08-11', // 山の日
  '2027-09-20', // 敬老の日
  '2027-09-23', // 秋分の日
  '2027-10-11', // スポーツの日
  '2027-11-03', // 文化の日
  '2027-11-23', // 勤労感謝の日
])

/**
 * 日付を YYYY-MM-DD 文字列に変換する。
 * ※ new Date() はシステムタイムゾーンに依存するため、ローカル年月日を使う。
 */
function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 土曜日か日曜日かを返す */
function isWeekend(date: Date): boolean {
  const dow = date.getDay()
  return dow === 0 || dow === 6
}

/**
 * 指定日が日本の国民の祝日・休日かどうかを返す。
 * データが存在しない年（2028年以降）は false を返す。
 */
export function isJapaneseHoliday(date: Date): boolean {
  return HOLIDAY_SET.has(toDateKey(date))
}

/**
 * 指定日が土日祝の場合、翌営業日（月〜金かつ祝日でない日）へシフトして返す。
 * 既に営業日であればそのまま返す。
 * 最大7日間シフトする（無限ループ防止）。
 */
export function nextBusinessDay(date: Date): Date {
  let result = new Date(date)
  let tries = 0
  while ((isWeekend(result) || isJapaneseHoliday(result)) && tries < 7) {
    result = new Date(result.getFullYear(), result.getMonth(), result.getDate() + 1)
    tries++
  }
  return result
}

/**
 * 指定日が土日祝の場合、前営業日へシフトして返す。
 * 一部の収納代行・給与支払いは翌営業日ではなく前営業日に寄せるため用意している。
 */
export function previousBusinessDay(date: Date): Date {
  let result = new Date(date)
  let tries = 0
  while ((isWeekend(result) || isJapaneseHoliday(result)) && tries < 7) {
    result = new Date(result.getFullYear(), result.getMonth(), result.getDate() - 1)
    tries++
  }
  return result
}

/** 営業日補正ルール。'none' は補正しない（既存データの既定値） */
export type BusinessDayRule = 'none' | 'next' | 'previous'

/**
 * ルールに従って営業日補正を適用する。
 *
 * ※ 祝日データは2027年までしか無い（ファイル冒頭の注記）。それ以降の日付は
 *   土日補正のみが効き、祝日は素通りする。内閣府の告示が出たら HOLIDAY_SET に追記すること。
 */
export function adjustBusinessDay(date: Date, rule: BusinessDayRule): Date {
  if (rule === 'next') return nextBusinessDay(date)
  if (rule === 'previous') return previousBusinessDay(date)
  return date
}
