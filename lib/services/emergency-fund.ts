// lib/services/emergency-fund.ts
//
// 現金防衛資金。既存エンジンに無い独立した金融ルールなので新規の純関数にする。
//
//   必要額 = 毎月の必須生活費 × 確保したい月数
//
// 「毎月の必須生活費」をここで組み立てないこと。呼び出し側が既存の
// budget-engine / money-plan の値から渡す（同じ生活費の定義を2箇所に作らない）。
import { yen } from './money'

export type EmergencyFundStatus = 'funded' | 'underfunded' | 'unknown'

export type EmergencyFundInput = {
  /** 毎月の必須生活費。算出できないなら null */
  monthlyEssentialExpenses: number | null
  /** すぐ動かせる現金。口座残高が未登録なら null */
  currentLiquidCash: number | null
  /** 何か月分を確保するか */
  targetMonths: number
}

export type EmergencyFundResult = {
  targetMonths: number
  monthlyEssentialExpenses: number | null
  requiredReserve: number | null
  currentReserve: number | null
  /** 不足額。足りていれば0。算出できないなら null */
  reserveGap: number | null
  /** 充足率(0〜)。1.0で必要額ちょうど */
  fundedRatio: number | null
  status: EmergencyFundStatus
}

/**
 * 入力が欠けているときに0で埋めない。
 * 「生活費が分からない」と「必要額が0円」は別なので null で返す。
 */
export function computeEmergencyFund(input: EmergencyFundInput): EmergencyFundResult {
  const targetMonths = Math.max(0, Math.round(input.targetMonths))
  const essential = input.monthlyEssentialExpenses
  const cash = input.currentLiquidCash

  if (essential === null || cash === null) {
    return {
      targetMonths,
      monthlyEssentialExpenses: essential === null ? null : yen(essential),
      requiredReserve: null,
      currentReserve: cash === null ? null : yen(cash),
      reserveGap: null,
      fundedRatio: null,
      status: 'unknown',
    }
  }

  const monthly = yen(essential)
  const currentReserve = yen(cash)
  const requiredReserve = monthly * targetMonths
  const reserveGap = Math.max(requiredReserve - currentReserve, 0)

  return {
    targetMonths,
    monthlyEssentialExpenses: monthly,
    requiredReserve,
    currentReserve,
    reserveGap,
    fundedRatio: requiredReserve === 0 ? 1 : currentReserve / requiredReserve,
    status: reserveGap === 0 ? 'funded' : 'underfunded',
  }
}
