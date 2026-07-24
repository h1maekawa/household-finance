// lib/services/coach-rules.ts
//
// 日次コーチの「ルールベース・エンジン」(スペック §3 Phase3)。
// ここは全て純関数・LLM 不使用。V2.4 の LLM は、この出力を自然文に言い換えるだけで、
// 金額・日付・口座名を作り出すことは無い。
//
// 花形コメント
//   「来週は楽天カードの引き落としがあるため、三井住友銀行に25万円残しておくことをおすすめします」
// は upcoming_debit ルール + 口座別残高(accounts)で出している。
import type {
  CoachAccount,
  CoachContext,
  CoachInsight,
  InsightSeverity,
  UpcomingDebit,
} from '@/types/coach'
import { yen } from './money'

const SEVERITY_RANK: Record<InsightSeverity, number> = { action: 3, warning: 2, info: 1 }

/** 25万円 のように、きりが良ければ万円表記にする */
export function formatYen(amount: number): string {
  const value = yen(amount)
  if (Math.abs(value) >= 10000 && value % 10000 === 0) {
    return `${(value / 10000).toLocaleString()}万円`
  }
  return `${value.toLocaleString()}円`
}

function formatDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function daysUntil(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.POSITIVE_INFINITY
  return Math.round((end - start) / 86400000)
}

// ---------------------------------------------------------------- ルール本体

/** 引き落とし予告と、そのための口座残高の確保 */
function upcomingDebitInsights(ctx: CoachContext): CoachInsight[] {
  const horizon = ctx.debitHorizonDays ?? 7
  const accountsById = new Map(ctx.accounts.map(a => [a.id, a]))

  const inWindow = ctx.upcomingDebits.filter(debit => {
    const days = daysUntil(ctx.today, debit.date)
    return days >= 0 && days <= horizon && yen(debit.amount) > 0
  })
  if (inWindow.length === 0) return []

  // 口座ごとにまとめる。引き落とし口座が未設定のものは口座横断の注意喚起にする。
  const byAccount = new Map<string, UpcomingDebit[]>()
  const unassigned: UpcomingDebit[] = []
  for (const debit of inWindow) {
    if (!debit.accountId || !accountsById.has(debit.accountId)) {
      unassigned.push(debit)
      continue
    }
    const list = byAccount.get(debit.accountId) ?? []
    list.push(debit)
    byAccount.set(debit.accountId, list)
  }

  const insights: CoachInsight[] = []

  for (const [accountId, debits] of byAccount) {
    const account = accountsById.get(accountId) as CoachAccount
    const required = debits.reduce((sum, d) => sum + yen(d.amount), 0)
    const earliest = debits.map(d => d.date).sort()[0]
    const names = [...new Set(debits.map(d => d.name))].join('・')
    const shortfall = required - yen(account.balance)

    insights.push({
      type: 'upcoming_debit',
      severity: shortfall > 0 ? 'action' : 'info',
      title: `${formatDate(earliest)}に${names}の引き落とし`,
      body:
        shortfall > 0
          ? `${formatDate(earliest)}に${names}の引き落とし(${formatYen(required)})があります。${account.name}の残高は${formatYen(account.balance)}で、${formatYen(shortfall)}足りません。`
          : `${formatDate(earliest)}に${names}の引き落とし(${formatYen(required)})があるため、${account.name}に${formatYen(required)}残しておくことをおすすめします。`,
      payload: {
        action: 'keep_balance',
        account_id: account.id,
        account_name: account.name,
        amount: required,
        by: earliest,
      },
      priority: shortfall > 0 ? 95 : 70,
      generated_for: ctx.today,
    })

    // 不足しているなら、余裕のある口座からの資金移動を提案する(提案のみ・実行はしない)。
    if (shortfall > 0) {
      const source = [...ctx.accounts]
        .filter(a => a.id !== account.id && yen(a.balance) - shortfall >= 0)
        .sort((a, b) => yen(b.balance) - yen(a.balance))[0]
      if (source) {
        insights.push({
          type: 'transfer_suggestion',
          severity: 'action',
          title: `${source.name}から${account.name}へ${formatYen(shortfall)}`,
          body: `${formatDate(earliest)}の引き落としに${formatYen(shortfall)}足りません。残高に余裕のある${source.name}(${formatYen(source.balance)})から移しておくと安全です。`,
          payload: {
            action: 'propose_transfer',
            from_account_id: source.id,
            from_account_name: source.name,
            to_account_id: account.id,
            to_account_name: account.name,
            amount: shortfall,
            by: earliest,
          },
          priority: 100,
          generated_for: ctx.today,
        })
      } else {
        insights.push({
          type: 'cash_shortfall',
          severity: 'action',
          title: `${formatDate(earliest)}の引き落としに残高が不足`,
          body: `${account.name}の残高が${formatYen(shortfall)}不足しています。他の口座にも余裕がないため、入金または支払いの調整が必要です。`,
          payload: { action: 'none' },
          priority: 105,
          generated_for: ctx.today,
        })
      }
    }
  }

  if (unassigned.length > 0) {
    const total = unassigned.reduce((sum, d) => sum + yen(d.amount), 0)
    const earliest = unassigned.map(d => d.date).sort()[0]
    insights.push({
      type: 'upcoming_debit',
      severity: 'info',
      title: `${formatDate(earliest)}から${formatYen(total)}の引き落とし予定`,
      body: `${formatDate(earliest)}以降に${formatYen(total)}の引き落としが予定されています。引き落とし口座を設定すると、どの口座にいくら残すべきかまで計算できます。`,
      payload: { action: 'none' },
      priority: 60,
      generated_for: ctx.today,
    })
  }

  return insights
}

/** カテゴリ別の超過と、戻すための具体的な行動量 */
function categoryInsights(ctx: CoachContext): CoachInsight[] {
  const insights: CoachInsight[] = []

  for (const progress of ctx.categoryProgress) {
    if (progress.budget <= 0) continue

    if (progress.spent > progress.budget) {
      const over = progress.spent - progress.budget
      // 「外食を1回減らせば戻せる」の係数は平均単価から機械的に出す。
      const times = progress.average > 0 ? Math.ceil(over / progress.average) : 0
      const howTo =
        times > 0
          ? `${progress.category}を${times}回減らせば戻せます(1回あたり平均${formatYen(progress.average)})。`
          : `残りの日数で${progress.category}を控えめにすると戻せます。`
      insights.push({
        type: 'category_over',
        severity: 'warning',
        title: `${progress.category}が${formatYen(over)}超過`,
        body: `${progress.category}は予算${formatYen(progress.budget)}に対して${formatYen(progress.spent)}使っています。${howTo}`,
        payload: { action: 'reduce_category', category: progress.category, amount: over, times },
        priority: 80,
        generated_for: ctx.today,
      })
    } else if (progress.pace > 1.3) {
      insights.push({
        type: 'category_pace_high',
        severity: 'warning',
        title: `${progress.category}のペースが速い`,
        body: `${progress.category}は経過日数に対して${Math.round(progress.pace * 100)}%のペースです。このままだと月末に予算${formatYen(progress.budget)}を超えます。`,
        payload: { action: 'reduce_category', category: progress.category, amount: 0, times: 0 },
        priority: 55,
        generated_for: ctx.today,
      })
    }
  }

  return insights
}

/** 変動費全体の状況 */
function budgetInsights(ctx: CoachContext): CoachInsight[] {
  const { variable } = ctx.budget
  if (variable.budget <= 0) return []

  if (variable.remaining < 0) {
    return [{
      type: 'over_budget',
      severity: 'action',
      title: `今月の変動費が${formatYen(Math.abs(variable.remaining))}超過`,
      body: `変動費の予算${formatYen(variable.budget)}に対して${formatYen(variable.spent)}使っています。残り${variable.daysLeft}日は支出を抑えるか、予算を見直しましょう。`,
      payload: { action: 'review_budget', month: ctx.budget.month, amount: variable.remaining },
      priority: 90,
      generated_for: ctx.today,
    }]
  }

  if (variable.pace > 1.15) {
    return [{
      type: 'pace_high',
      severity: 'warning',
      title: 'このままだと月末に予算オーバー',
      body: `変動費のペースが${Math.round(variable.pace * 100)}%です。残り${variable.daysLeft}日を1日${formatYen(variable.dailyAllowance)}に抑えると予算内に収まります。`,
      payload: { action: 'review_budget', month: ctx.budget.month, amount: variable.dailyAllowance },
      priority: 75,
      generated_for: ctx.today,
    }]
  }

  return [{
    type: 'progress_on_track',
    severity: 'info',
    title: '今月は予算内に収まりそうです',
    body: `変動費は${formatYen(variable.spent)}/${formatYen(variable.budget)}。残り${variable.daysLeft}日で1日${formatYen(variable.dailyAllowance)}使えます。`,
    payload: { action: 'none' },
    priority: 20,
    generated_for: ctx.today,
  }]
}

/** 目標の進捗 */
function goalInsights(ctx: CoachContext): CoachInsight[] {
  const insights: CoachInsight[] = []

  for (const goal of ctx.goals) {
    if (goal.targetAmount === null) continue

    if (goal.status === 'behind' && goal.requiredMonthly !== null) {
      const gap = goal.requiredMonthly - goal.monthlyPace
      insights.push({
        type: 'goal_behind',
        severity: 'warning',
        title: `「${goal.title}」の積立が${formatYen(gap)}不足`,
        body: `目標には毎月${formatYen(goal.requiredMonthly)}必要ですが、今のペースは${formatYen(goal.monthlyPace)}です。${goal.projectedAchievementMonth ? `このままだと達成は${goal.projectedAchievementMonth.replace('-', '年')}月ごろになります。` : ''}`,
        payload: {
          action: 'review_goal',
          goal_id: goal.goalId,
          required_monthly: goal.requiredMonthly,
          monthly_pace: goal.monthlyPace,
        },
        priority: 65,
        generated_for: ctx.today,
      })
      continue
    }

    // 25% 刻みの節目だけ知らせる(毎日話しかけない — スペック §7-7)
    const milestone = Math.floor(goal.progressRate * 4) / 4
    if (goal.status !== 'stalled' && milestone >= 0.25 && milestone < 1) {
      insights.push({
        type: 'goal_milestone',
        severity: 'info',
        title: `「${goal.title}」が${Math.round(milestone * 100)}%到達`,
        body: `${formatYen(goal.currentAmount)}/${formatYen(goal.targetAmount)}まで来ました。${goal.projectedAchievementMonth ? `このままなら${goal.projectedAchievementMonth.replace('-', '年')}月に達成予定です。` : ''}`,
        payload: { action: 'none' },
        priority: 30,
        generated_for: ctx.today,
      })
    }
  }

  return insights
}

/** 固定費の払い漏れ */
function fixedMissingInsights(ctx: CoachContext): CoachInsight[] {
  const missing = ctx.budget.fixed.items.filter(item => item.status === 'missing')
  if (missing.length === 0) return []
  return [{
    type: 'fixed_missing',
    severity: 'warning',
    title: `支払日を過ぎた固定費が${missing.length}件`,
    body: `${missing.map(item => `${item.name}(${formatYen(item.planned)})`).join('・')}の実績が見つかりません。支払い済みなら取引を登録してください。`,
    payload: { action: 'none' },
    priority: 85,
    generated_for: ctx.today,
  }]
}

// ---------------------------------------------------------------- 公開API

export function buildCoachInsights(ctx: CoachContext): CoachInsight[] {
  const insights = [
    ...upcomingDebitInsights(ctx),
    ...fixedMissingInsights(ctx),
    ...budgetInsights(ctx),
    ...categoryInsights(ctx),
    ...goalInsights(ctx),
  ]

  return sortInsights(insights)
}

export function sortInsights(insights: CoachInsight[]): CoachInsight[] {
  return [...insights].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (severityDiff !== 0) return severityDiff
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.title < b.title ? -1 : 1
  })
}

/**
 * 今日ユーザーに見せる 1 本を選ぶ。
 * 「うるさいと開かなくなる」ので、異常が無い日は on_track を 1 本だけ出す(スペック §7-7)。
 */
export function selectTodaysInsight(insights: CoachInsight[]): CoachInsight | null {
  return sortInsights(insights)[0] ?? null
}

/** ai_insights の一意キー(user_id, generated_for, type, title)と揃える */
export function insightKey(insight: CoachInsight): string {
  return `${insight.generated_for}|${insight.type}|${insight.title}`
}
