'use client'
// FIRE Planner（スペック §20〜§22）。
//
// 金額はすべてサーバー（fire-planner.ts）が出したものを表示するだけ。
// ここで必要資産を割り戻したり、利回りを掛けたりしない。
//
// 利回りは仮定であって保証ではないので、その旨を必ず画面に出す。
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import { useToast } from '@/components/Toast'
import { yen, NotAvailable } from '@/components/home/AmountBlock'
import {
  FIRE_TYPES,
  FIRE_TYPE_DESCRIPTION,
  FIRE_TYPE_LABEL,
  type FirePlan,
  type FireScenario,
  type FireType,
} from '@/lib/services/fire-planner'
import type { StoredFireSettings } from '@/lib/services/fire-planner-loader'

type FirePlanResponse = FirePlan & { settings: StoredFireSettings }

// 0.03 * 100 は浮動小数で 3.0000000000000004 になる。丸めてから数値へ戻し、
// 「3%」「20.315%」のように余分な0を出さない
const percent = (rate: number) => `${Number((rate * 100).toFixed(3))}%`

const LIVING_COST_SOURCE_NOTE: Record<FirePlan['livingCostSource'], string> = {
  user: '入力した生活費で計算しています',
  budget: '生活費が未入力のため、家計の固定費と変動費予算から推定しています',
  unknown: '生活費が分からないため、必要な資産収入を計算できません',
}

export default function FirePlanView() {
  const { data, mutate, isLoading } = useSWR<FirePlanResponse>('/api/fire-plan', fetcher)

  if (isLoading || !data) {
    return (
      <div className="card p-4">
        <div className="skeleton h-56 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <RequiredAssetsCard plan={data} />
      <ScenarioCard plan={data} />
      <FireSettingsCard settings={data.settings} onSaved={() => mutate()} />
    </div>
  )
}

function RequiredAssetsCard({ plan }: { plan: FirePlan }) {
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">{plan.fireTypeLabel}に必要な資産</h2>
        <span className="text-[11px] text-muted">利回り {percent(plan.assumedReturnRate)} の仮定</span>
      </div>

      <div className="mt-2.5">
        {plan.primary.requiredAssets === null ? (
          <NotAvailable
            hint={
              plan.monthlyLivingCost === null
                ? '月の生活費を入力すると、必要な資産を計算できます'
                : 'この利回りの仮定では、資産収入だけで生活費を賄えません'
            }
          />
        ) : (
          <p className="text-[34px] font-bold leading-none tabular-nums">
            {yen(plan.primary.requiredAssets)}
          </p>
        )}
      </div>

      <dl className="mt-4 flex flex-col gap-2 text-[13px]">
        <Row
          label="月の生活費"
          value={plan.monthlyLivingCost === null ? null : yen(plan.monthlyLivingCost)}
        />
        {plan.fireType === 'semi' && (
          <Row label="副業・事業収入" value={yen(plan.sideIncomeMonthly)} />
        )}
        <Row
          label="必要な資産収入（手取り・月）"
          value={
            plan.requiredMonthlyAssetIncome === null
              ? null
              : yen(plan.requiredMonthlyAssetIncome)
          }
        />
        <Row
          label={`必要な資産収入（税引前・年 / 税率${percent(plan.taxRate)}）`}
          value={
            plan.requiredAnnualAssetIncomeGross === null
              ? null
              : yen(plan.requiredAnnualAssetIncomeGross)
          }
        />
        <Row label="現在の総資産" value={plan.currentAssets === null ? null : yen(plan.currentAssets)} />
        <Row
          label="不足額"
          value={plan.primary.shortfall === null ? null : yen(plan.primary.shortfall)}
        />
      </dl>

      {plan.coveredBySideIncome && (
        <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          副業・事業収入だけで生活費を賄えている状態です。資産収入で補う必要はありません。
        </p>
      )}

      {plan.zeroReturnAchievementMonth && (
        <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          今の積立ペースが続いた場合、{plan.zeroReturnAchievementMonth.replace('-', '年')}月ごろに
          必要資産へ届く計算です（積立中の利回りは0%として計算）。
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {LIVING_COST_SOURCE_NOTE[plan.livingCostSource]}
      </p>

      {plan.missingData.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {plan.missingData.map(item => (
            <li key={item} className="text-[11px] leading-relaxed text-warning">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="shrink-0 font-bold tabular-nums">{value ?? '—'}</dd>
    </div>
  )
}

function ScenarioCard({ plan }: { plan: FirePlan }) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold">利回りの仮定ごとの必要資産</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        利回りはいずれも仮定です。運用成果を約束するものではありません。
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {plan.scenarios.map(scenario => (
          <ScenarioRow
            key={scenario.returnRate}
            scenario={scenario}
            isPrimary={scenario.returnRate === plan.assumedReturnRate}
          />
        ))}
      </ul>
    </section>
  )
}

function ScenarioRow({
  scenario,
  isPrimary,
}: {
  scenario: FireScenario
  isPrimary: boolean
}) {
  return (
    <li
      className={`flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5 ${
        isPrimary ? 'bg-surface' : ''
      }`}
    >
      <span className="text-[13px]">
        {percent(scenario.returnRate)}
        {!scenario.isOfficial && <span className="ml-1 text-[10px] text-muted">（独自の仮定）</span>}
      </span>
      <span className="shrink-0 text-[13px] font-bold tabular-nums">
        {scenario.requiredAssets === null ? (
          <span className="font-normal text-muted">賄えません</span>
        ) : (
          yen(scenario.requiredAssets)
        )}
      </span>
    </li>
  )
}

function FireSettingsCard({
  settings,
  onSaved,
}: {
  settings: StoredFireSettings
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [form, setForm] = useState({
    fire_type: settings.fireType as FireType,
    monthly_living_cost:
      settings.monthlyLivingCost === null ? '' : String(settings.monthlyLivingCost),
    side_income_monthly: String(settings.sideIncomeMonthly),
    target_asset_income_monthly:
      settings.targetAssetIncomeMonthly === null
        ? ''
        : String(settings.targetAssetIncomeMonthly),
    assumed_return_rate: String(settings.assumedReturnRate * 100),
    tax_rate: String(settings.taxRate * 100),
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/fire-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fire_type: form.fire_type,
        // 空欄は「未入力」として送る。0円と区別する
        monthly_living_cost: form.monthly_living_cost === '' ? null : Number(form.monthly_living_cost),
        side_income_monthly: form.side_income_monthly === '' ? 0 : Number(form.side_income_monthly),
        target_asset_income_monthly:
          form.target_asset_income_monthly === ''
            ? null
            : Number(form.target_asset_income_monthly),
        assumed_return_rate: Number(form.assumed_return_rate) / 100,
        tax_rate: Number(form.tax_rate) / 100,
      }),
    })
    setSaving(false)

    if (res.ok) {
      showToast('保存しました', 'success')
      onSaved()
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      showToast(body.error ?? '保存に失敗しました', 'error')
    }
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold">前提を設定する</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        入力した条件だけを保存します。必要資産は開くたびに計算し直します。
      </p>

      <div className="mt-3 flex flex-col gap-4">
        <div>
          <span className="mb-1.5 block text-xs text-muted">FIRE の種類</span>
          <div className="grid grid-cols-2 gap-2">
            {FIRE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setForm(f => ({ ...f, fire_type: type }))}
                aria-pressed={form.fire_type === type}
                className={`rounded-xl border px-3 py-2.5 text-sm transition-base ${
                  form.fire_type === type
                    ? 'border-primary bg-primary/5 font-bold text-primary'
                    : 'border-border bg-surface text-muted'
                }`}
              >
                {FIRE_TYPE_LABEL[type]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">{FIRE_TYPE_DESCRIPTION[form.fire_type]}</p>
        </div>

        <NumberField
          id="fire-living-cost"
          label="月の生活費（円）"
          hint="未入力なら家計の固定費と変動費予算から推定します"
          value={form.monthly_living_cost}
          onChange={value => setForm(f => ({ ...f, monthly_living_cost: value }))}
        />

        {form.fire_type === 'semi' && (
          <NumberField
            id="fire-side-income"
            label="副業・事業収入（円 / 月）"
            value={form.side_income_monthly}
            onChange={value => setForm(f => ({ ...f, side_income_monthly: value }))}
          />
        )}

        <NumberField
          id="fire-target-asset-income"
          label="資産収入の目標（円 / 月・任意）"
          hint="入れた場合は生活費からの逆算より優先します"
          value={form.target_asset_income_monthly}
          onChange={value => setForm(f => ({ ...f, target_asset_income_monthly: value }))}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="fire-return-rate"
            label="想定利回り（％）"
            value={form.assumed_return_rate}
            onChange={value => setForm(f => ({ ...f, assumed_return_rate: value }))}
            step="0.1"
          />
          <NumberField
            id="fire-tax-rate"
            label="税率の仮定（％）"
            value={form.tax_rate}
            onChange={value => setForm(f => ({ ...f, tax_rate: value }))}
            step="0.001"
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl bg-primary py-3 text-sm font-bold text-white transition-base active:opacity-80 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存する'}
        </button>
      </div>
    </section>
  )
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  step,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  step?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm font-bold tabular-nums focus:border-primary focus:bg-card focus:outline-none"
      />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  )
}
