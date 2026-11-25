// 開始残高の編集方法。口座がある人は口座管理で編集する（旧 account_balance へ
// 書いても開始残高は変わらない）。流動口座が0件の人だけ旧テーブルへその場で書く。
export type BalanceEditMode = 'link' | 'inline-edit' | 'none'

export function balanceEditMode(
  source: 'accounts' | 'legacy_balance' | 'none' | undefined
): BalanceEditMode {
  if (source === undefined) return 'none'
  return source === 'accounts' ? 'link' : 'inline-edit'
}
