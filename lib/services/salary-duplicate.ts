// lib/services/salary-duplicate.ts
//
// 給与の二重加算の判定。給与はプロフィール（users_profile.monthly_income / income_day、
// 予算の income_planned）から合成するが、同じ給与が予定入金（scheduled_payments の
// type:'income'）にも登録されていると二重に足される。
//
// 投資可能額（computeObligations）と30日予測（projectCashflow）の両方がこの1つの
// 純関数を使う（判定を2か所に書かない）。I/O も他モジュールの import も持たない。
//
//   一致：名前・カテゴリに「給与」「給料」「役員報酬」「salary」、または
//         （給料日の±3日以内 かつ 金額が planned の±10%以内）→ 予定入金だけを使う
//   あいまい：一致しないが給料日の±3日以内の予定入金 → 予定入金だけを使い（少ない側）、
//         missing_data に理由を残す（AI Company はこれで新規購入を停止する）
//   それ以外：別の収入。合成給与も予定入金も数える（従来どおり）

export const SALARY_DUPLICATE_AMBIGUOUS_MESSAGE =
  '給与が予定入金とプロフィールの月収の両方に登録されている可能性があります。どちらか一方にしてください'

/** 一致したとき、予定入金の行に付ける内訳の名前 */
export const SALARY_DUPLICATE_ITEM_LABEL = '給与（予定入金を使用・プロフィール月収と重複のため合成分は除外）'

/** 給料日からの日数の許容（両端を含む） */
export const SALARY_DUPLICATE_DAY_WINDOW = 3
/** planned に対する金額の許容（両端を含む） */
export const SALARY_DUPLICATE_AMOUNT_RATIO = 0.1

const SALARY_NAME = /給与|給料|役員報酬|salary/i

export type SalaryIncomeCandidate = {
  id: string
  name: string
  category?: string | null
  /** その月に解決された入金日 'YYYY-MM-DD' */
  date: string
  /** 円 */
  amount: number
}

export type SalaryDuplicateDecision = {
  /** none：重複なし（または判定対象外）／match：同じ給与／ambiguous：同じ給与かもしれない */
  kind: 'none' | 'match' | 'ambiguous'
  /** プロフィールから合成した給与を足すか */
  includeSynthesizedSalary: boolean
  /** 給与とみなした予定入金の ID（match のときだけ） */
  duplicateIds: string[]
  missingData: string[]
}

function dayNumber(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000
}

/**
 * @param planned プロフィールの月収（予定額）。0 以下なら給与は合成されないので判定しない
 * @param salaryDate その月の給料日 'YYYY-MM-DD'。対象月はこの日付の月
 * @param incomes 有効な type:'income' の予定入金（呼び出し側で解決した日付・円換算額）
 */
export function detectSalaryDuplicate(input: {
  planned: number
  salaryDate: string | null
  incomes: SalaryIncomeCandidate[]
}): SalaryDuplicateDecision {
  const planned = Number(input.planned)
  if (!Number.isFinite(planned) || planned <= 0 || !input.salaryDate) {
    return { kind: 'none', includeSynthesizedSalary: false, duplicateIds: [], missingData: [] }
  }
  const month = input.salaryDate.slice(0, 7)
  const salaryDay = dayNumber(input.salaryDate)
  const matched: string[] = []
  let ambiguous = false

  for (const income of input.incomes) {
    if (!income.date || income.date.slice(0, 7) !== month) continue
    const nearDate = Math.abs(dayNumber(income.date) - salaryDay) <= SALARY_DUPLICATE_DAY_WINDOW
    const nearAmount = Math.abs(Number(income.amount) - planned) <= planned * SALARY_DUPLICATE_AMOUNT_RATIO
    const named = SALARY_NAME.test(income.name ?? '') || SALARY_NAME.test(income.category ?? '')
    if (named || (nearDate && nearAmount)) matched.push(income.id)
    else if (nearDate) ambiguous = true
  }

  if (matched.length > 0) {
    return { kind: 'match', includeSynthesizedSalary: false, duplicateIds: matched, missingData: [] }
  }
  if (ambiguous) {
    return {
      kind: 'ambiguous',
      includeSynthesizedSalary: false,
      duplicateIds: [],
      missingData: [SALARY_DUPLICATE_AMBIGUOUS_MESSAGE],
    }
  }
  return { kind: 'none', includeSynthesizedSalary: true, duplicateIds: [], missingData: [] }
}
