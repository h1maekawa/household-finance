// lib/services/ai-fp-intent.ts
//
// AI FP への質問を「どの計算が必要か」へ落とす（スペック §32 / §33）。純関数。
//
//   User → 意図の判定 → Finance Engine → 計算結果 → AIが説明
//
// **意図と金額の判定をAIにやらせない。** AIに数字を決めさせると
// 「毎月+2万円投資したら？」の2万円をAIが3万円と読み違えても誰も気付けない。
// ここは決定論で解析し、AIには計算済みの結果を説明させるだけにする
// （スペック §28: 削減額・副業収入額・投資額・利回り・目標額をAIが決めない）。
import { EXPENSE_REDUCTION_RATIOS } from './scenario-engine'

export type FinancialIntent =
  /** 今月の状況の説明だけ。従来のふるまい */
  | { kind: 'explain' }
  /** 今月やること（Action Planner） */
  | { kind: 'actions' }
  /** 見直し候補（Expense Intelligence） */
  | { kind: 'review' }
  /** 目標額までの到達時期 */
  | { kind: 'goal_eta'; targetAssets: number }
  /** 毎月の積立を増やしたら */
  | { kind: 'scenario_contribution'; field: 'savings' | 'investment'; monthlyAmount: number }
  /** 副業・追加収入を資産形成へ回したら */
  | { kind: 'scenario_extra_income'; monthlyAmount: number }
  /** ある支出を減らしたら */
  | { kind: 'scenario_expense_cut'; category: string; ratio: number }

const UNIT_MULTIPLIER: Record<string, number> = { 億: 100_000_000, 万: 10_000, 千: 1_000 }

/**
 * 文中の最初の金額を円で返す。「2万円」「20,000円」「3,000万円」に対応。
 * 数字が無ければ null（0円として扱わない）。
 */
export function parseYenAmount(text: string): number | null {
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(億|万|千)?\s*円?/)
  if (!match) return null

  const value = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(value)) return null

  const multiplier = match[2] ? UNIT_MULTIPLIER[match[2]] : 1
  const amount = Math.round(value * multiplier)
  return amount > 0 ? amount : null
}

/**
 * 削減率。「半分」「50%」「3割」に対応。
 * 読み取れなければ null（勝手に「とりあえず半分」と決めない）。
 */
export function parseReductionRatio(text: string): number | null {
  const percent = text.match(/(\d+(?:\.\d+)?)\s*[%％]/)
  if (percent) {
    const ratio = Number(percent[1]) / 100
    return ratio > 0 && ratio <= 1 ? ratio : null
  }

  const wari = text.match(/(\d+)\s*割/)
  if (wari) {
    const ratio = Number(wari[1]) / 10
    return ratio > 0 && ratio <= 1 ? ratio : null
  }

  if (/半分|半額|はんぶん/.test(text)) return 0.5
  if (/やめ|断ち|ゼロ|0円|全部|すべて/.test(text)) return 1
  return null
}

/** 支出カテゴリの言及。ユーザー自身のカテゴリ一覧とだけ突き合わせる */
function findCategory(text: string, categories: string[]): string | null {
  // 長いカテゴリ名を優先する（「外食」と「外食費」が両方あるとき）
  const sorted = [...categories].sort((a, b) => b.length - a.length)
  return sorted.find(category => category.length > 0 && text.includes(category)) ?? null
}

const ACTION_PATTERNS = /何をすれ|何をすべ|やること|何から|今月なに|今月何/
const REVIEW_PATTERNS = /見直せ|見直し|削れ|減らせる|どこを|無駄/
const ETA_PATTERNS = /何年|何ヶ月|何か月|何カ月|いつ(まで|頃)?|あと(どれ|何)/
const SAVINGS_PATTERNS = /貯金|預金|貯蓄/
const INVESTMENT_PATTERNS = /投資|積立|運用/
const INCOME_PATTERNS = /副業|収入|給料|昇給|稼[いげ]/
const CUT_PATTERNS = /減らし|減らす|半分|半額|やめ|節約|控え/

/**
 * 質問から必要な計算を決める。
 *
 * @param categories ユーザー自身の支出カテゴリ。ここに無いカテゴリは扱わない
 *                   （「タバコ」等をシステム側で決め打ちしない）
 */
export function parseFinancialQuestion(
  question: string,
  categories: string[] = []
): FinancialIntent {
  const text = question.trim()
  if (!text) return { kind: 'explain' }

  if (ACTION_PATTERNS.test(text)) return { kind: 'actions' }

  // 支出削減は「カテゴリ」と「削減率」の両方が読み取れたときだけ。
  // どちらか欠けたまま推測で埋めない
  const category = findCategory(text, categories)
  if (category && CUT_PATTERNS.test(text)) {
    const ratio = parseReductionRatio(text)
    if (ratio !== null) return { kind: 'scenario_expense_cut', category, ratio }
  }

  const amount = parseYenAmount(text)

  if (amount !== null && INCOME_PATTERNS.test(text) && !ETA_PATTERNS.test(text)) {
    return { kind: 'scenario_extra_income', monthlyAmount: amount }
  }

  if (amount !== null && !ETA_PATTERNS.test(text)) {
    if (INVESTMENT_PATTERNS.test(text)) {
      return { kind: 'scenario_contribution', field: 'investment', monthlyAmount: amount }
    }
    if (SAVINGS_PATTERNS.test(text)) {
      return { kind: 'scenario_contribution', field: 'savings', monthlyAmount: amount }
    }
  }

  // 「3,000万円まで何年？」。目標額として意味のある大きさのときだけ扱う
  if (amount !== null && ETA_PATTERNS.test(text)) {
    return { kind: 'goal_eta', targetAssets: amount }
  }

  if (REVIEW_PATTERNS.test(text)) return { kind: 'review' }

  return { kind: 'explain' }
}

/** 画面に出す定型質問（スペック §32） */
export const QUICK_QUESTIONS = [
  '今月使いすぎ？',
  'どこを見直せそう？',
  '500万円まであと何ヶ月？',
  '3,000万円まで何年？',
  '毎月+2万円投資したら？',
  '副業が月5万円増えたら？',
  '今月何をすればいい？',
] as const

/**
 * カテゴリを差し込む定型質問（スペック §32 の「タバコを半分にしたら？」）。
 * カテゴリ名をシステムが決め打ちしないため、呼び出し側が実データから渡す。
 */
export function expenseCutQuestion(category: string): string {
  return `${category}を半分にしたら？`
}

/** 定型質問で使う既定の削減率。scenario-engine の選択肢から取る */
export const DEFAULT_CUT_RATIO = EXPENSE_REDUCTION_RATIOS[1]
