'use client'
// components/VariableBudgetList.tsx
// 「自由に使えるお金」を食費・外食・娯楽などにいくら割り当て、いくら使ったか。
// お金の流れ(MoneyFlow)の最後のステップを、カテゴリ単位まで分解して見せる。
import type { CategoryPlan } from '@/lib/services/money-plan'
import { useCategories } from '@/lib/useCategories'

export default function VariableBudgetList({
  categories, freeBudget,
}: {
  categories: CategoryPlan[]
  freeBudget: number
}) {
  const { iconOf } = useCategories()

  const allocated = categories.reduce((sum, c) => sum + c.budget, 0)
  const unallocated = freeBudget - allocated

  if (categories.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="text-base font-bold">変動費の配分</h2>
        <p className="mt-3 text-sm text-muted">
          カテゴリ別の予算がまだありません。過去の実績から自動で配分できます。
        </p>
      </section>
    )
  }

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold">変動費の配分</h2>
        <span className="text-xs text-muted">
          {unallocated >= 0
            ? `未配分 ${unallocated.toLocaleString()}円`
            : `配分超過 ${Math.abs(unallocated).toLocaleString()}円`}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-3.5">
        {categories.map(item => (
          <CategoryRow key={item.category} item={item} icon={iconOf(item.category)} />
        ))}
      </div>
    </section>
  )
}

function CategoryRow({ item, icon }: { item: CategoryPlan; icon: string }) {
  const over = item.remaining < 0
  const nearLimit = !over && item.usage >= 0.8

  const barColor = over ? 'bg-danger' : nearLimit ? 'bg-warning' : 'bg-primary'

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {item.category}
          {item.unbudgeted && (
            <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-muted">
              予算枠なし
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {item.spent.toLocaleString()}
          {!item.unbudgeted && ` / ${item.budget.toLocaleString()}`}
          <span className="ml-0.5">円</span>
        </span>
      </div>

      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(item.usage * 100, 100)}%` }}
        />
      </div>

      <p className={`mt-1 text-[11px] ${over ? 'text-danger' : 'text-muted'}`}>
        {item.unbudgeted
          ? '予算枠が未設定のカテゴリです'
          : over
            ? `${Math.abs(item.remaining).toLocaleString()}円 オーバー`
            : `あと ${item.remaining.toLocaleString()}円`}
      </p>
    </div>
  )
}
