// lib/credit-card-errors.ts
//
// 未適用マイグレーションで credit_cards の列が欠けているときの、原因が分かるエラー文。
//
// card_plan / card_type (013) が無いと card-payment-rules.ts の締め日ルールが
// 一度も実行されず、全カードが generic フォールバック(締め日設定そのまま)で計算される。
// 「保存できたのに引き落とし日が変わらない」という最も分かりにくい壊れ方をするので、
// 黙って列を落として再試行するのではなく、何を実行すべきかを返す。

const REQUIRED_COLUMNS: Record<string, string> = {
  card_plan: 'supabase/migrations/013_credit_card_plan.sql',
  card_type: 'supabase/migrations/013_credit_card_plan.sql',
}

/**
 * Supabase のエラーが「列が無い」ものなら、対応するマイグレーションを案内する文言を返す。
 * 該当しなければ null（呼び出し元は元のメッセージをそのまま返せばよい）。
 */
export function describeMissingColumn(message: string | undefined): string | null {
  if (!message) return null
  for (const [column, migration] of Object.entries(REQUIRED_COLUMNS)) {
    if (message.includes(column) && message.includes('does not exist')) {
      return `データベースに ${column} 列がありません。${migration} を Supabase の SQL Editor で実行してください。適用するまでカードのプラン（締め日・支払日）は保存できません。`
    }
  }
  return null
}
