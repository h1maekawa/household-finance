import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAccount } from '@/lib/repositories/accounts'
import { createGoal } from '@/lib/repositories/goals'
import { upsertBudget } from '@/lib/repositories/budgets'
import { saveUserMemory } from '@/lib/repositories/insights'
import { yen } from '@/lib/services/money'
import { requiredMonthlyContribution } from '@/lib/services/goal-progress'
import type { GoalKind } from '@/types/goal'

const VALID_KINDS: GoalKind[] = ['fire', 'house', 'car', 'education', 'savings', 'travel', 'custom']

/**
 * POST /api/onboarding — オンボーディング回答を一括保存する。
 * (スペック §3 Phase1)。計算は逆算(毎月の積立額)のみで、LLM は使わない。
 *
 * body: {
 *   values?: { priorities?: string[]; risk?: string; note?: string },
 *   income?: { monthly_income, income_day },
 *   primary_account?: { name, type, balance },
 *   goal?: { kind, title, target_amount, target_date },
 *   budget?: { savings_target, investment_target, buffer }
 * }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const result: Record<string, unknown> = {}

  try {
    const supabase = await createSupabaseServerClient()

    // 1) 価値観・重視点 → ai_user_memory
    if (body.values && typeof body.values === 'object') {
      await saveUserMemory(user.id, body.values as Record<string, unknown>)
      result.memory = true
    }

    // 2) 収入・給料日 → users_profile
    const income = body.income as Record<string, unknown> | undefined
    let monthlyIncome = 0
    if (income) {
      monthlyIncome = yen(income.monthly_income ?? 0)
      const incomeDay = Math.min(Math.max(Number(income.income_day) || 25, 1), 31)
      const { error } = await supabase.from('users_profile').upsert(
        {
          user_id: user.id,
          monthly_income: monthlyIncome,
          income_day: incomeDay,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      if (error) throw new Error(error.message)
      result.profile = true
    }

    // 3) メイン口座 + 初期残高
    const account = body.primary_account as Record<string, unknown> | undefined
    if (account && typeof account.name === 'string' && account.name.trim()) {
      const created = await createAccount(user.id, {
        name: account.name.trim(),
        type: (['bank', 'emoney', 'cash', 'securities'].includes(account.type as string)
          ? account.type
          : 'bank') as 'bank',
        is_primary: true,
        balance: account.balance !== undefined ? yen(account.balance) : undefined,
      })
      result.account_id = created.id
    }

    // 4) 主目標 → life_goals + 毎月の積立額を逆算
    const goal = body.goal as Record<string, unknown> | undefined
    let savingsFromGoal = 0
    if (goal && typeof goal.title === 'string' && goal.title.trim()) {
      const targetAmount =
        goal.target_amount === null || goal.target_amount === undefined
          ? null
          : yen(goal.target_amount)
      const targetDate =
        typeof goal.target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(goal.target_date)
          ? goal.target_date
          : null
      const monthly = requiredMonthlyContribution(
        { target_amount: targetAmount, target_date: targetDate, current_amount: 0 },
        new Date().toISOString().slice(0, 7)
      )
      savingsFromGoal = monthly ?? 0
      const createdGoal = await createGoal(user.id, {
        kind: VALID_KINDS.includes(goal.kind as GoalKind) ? (goal.kind as GoalKind) : 'savings',
        title: goal.title.trim(),
        target_amount: targetAmount,
        target_date: targetDate,
        priority: 10, // オンボーディングで作る目標は主目標
        monthly_contribution: monthly,
      })
      result.goal_id = createdGoal.id
      result.monthly_contribution = monthly
    }

    // 5) 予算テンプレート(month=null) を作る。貯蓄目標は明示指定 > 目標逆算。
    const budget = body.budget as Record<string, unknown> | undefined
    const savingsTarget =
      budget?.savings_target !== undefined ? yen(budget.savings_target) : savingsFromGoal
    await upsertBudget(user.id, null, {
      income_planned: income ? monthlyIncome : null,
      savings_target: savingsTarget,
      investment_target: yen(budget?.investment_target ?? 0),
      buffer: yen(budget?.buffer ?? 0),
    })
    result.budget_template = true

    return Response.json({ ok: true, ...result }, { status: 201 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
