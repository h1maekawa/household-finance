'use client'
// AIライフプランナー — 意思決定を支援する場所(要件定義書 v3.1)。
//
// 現時点で稼働しているのは日次コーチ(lib/services/coach-rules.ts)のみ。
// これはルールベースの決定的エンジンで、金額・日付・口座名は全て計算で出しており
// LLM は使っていない(docs/v2-ai-coach-spec.md の「決定的エンジン + LLMナレーション」)。
//
// 対話アシスタント(lib/ai/ 一式・右下常駐ボタン)は未実装。
// 設計は docs/v3-architecture-review.md §6.5 にある。
import PageShell from '@/components/PageShell'
import CoachCard from '@/components/CoachCard'

export default function AiPage() {
  return (
    <PageShell
      title="AIライフプランナー"
      description="家計・口座・固定費・目標をまとめて見て、次の一手を提案します"
    >
      <div className="flex flex-col gap-5">
        <CoachCard />

        <section className="card p-4">
          <h2 className="text-base font-bold">今日の分析</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            毎日の分析は、口座残高・引き落とし予定・予算の実績から自動で計算しています。
            金額や日付はすべて計算によるもので、生成AIが数字を作ることはありません。
          </p>
        </section>

        <section className="card p-4">
          <h2 className="text-base font-bold">対話アシスタント</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            「今月あといくら使える？」「親へいくら返済できる？」に答える対話機能は準備中です。
            口座・固定費・目標のデータが揃ったうえで提供します。
          </p>
          <p className="mt-3 text-xs text-muted">
            現在は家計簿ページの「チャット入力」で、文章から取引を登録できます。
          </p>
        </section>
      </div>
    </PageShell>
  )
}
