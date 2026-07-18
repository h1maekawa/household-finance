// app/api/transactions/import/route.ts
//
// Google Apps Script (GAS) からの取り込み専用エンドポイント。
// ブラウザのCookieセッションではなく、共有シークレットで認証する
// サーバー間通信を想定している(GASはユーザーのGmail内で完結して動くため、
// このアプリ側にGmailのOAuthトークンを一切保存しない設計になっている)。
//
// 2つの入力モードに対応する:
//   モードA(推奨・高速・無料): GAS側の正規表現パーサーが既に
//     date/amount/category/kind まで抽出済みの場合、そのまま登録する。
//     Gemini APIは呼ばない。
//   モードB(フォールバック): 正規表現で解析できなかったメールは
//     text(件名+本文)だけを送ってもらい、Geminiで解析する。
//
// 必要な環境変数:
//   GAS_IMPORT_SECRET  … GAS側と共有するランダムな秘密文字列
//   GAS_IMPORT_USER_ID … 取り込んだ取引を紐づける Supabase の auth.users.id
import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { requireActiveEntitlement } from '@/lib/entitlements'
import { hashImportSecret } from '@/lib/import-secrets'
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase'
import { parseChatInput } from '@/lib/gemini'
import { getMergedCategories } from '@/lib/categories'
import { decideCategory, MerchantRule } from '@/lib/category-rules'
import { CATEGORIES, INCOME_CATEGORIES, Kind } from '@/types/transaction'

function hasEnv(name: string): boolean {
  const value = process.env[name]
  return Boolean(value && !value.includes('placeholder'))
}

async function resolveImportUserId(request: NextRequest): Promise<string | null> {
  const provided = request.headers.get('x-import-secret')
  if (!provided) return null

  const { data } = await supabaseAdmin
    .from('user_import_secrets')
    .select('id,user_id')
    .eq('secret_hash', hashImportSecret(provided))
    .eq('is_active', true)
    .maybeSingle()

  if (data?.user_id) {
    await supabaseAdmin
      .from('user_import_secrets')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
    return data.user_id
  }

  if (process.env.GAS_IMPORT_SECRET && process.env.GAS_IMPORT_USER_ID && secretsMatch(provided, process.env.GAS_IMPORT_SECRET)) {
    return process.env.GAS_IMPORT_USER_ID
  }

  return null
}

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

function normalizeCategory(
  category: string | undefined,
  kind: Kind,
  extraNames: { expense: string[]; income: string[] } = { expense: [], income: [] }
): string {
  const list = kind === 'income' ? INCOME_CATEGORIES : CATEGORIES
  const names = [
    ...(list.map(c => c.name) as string[]),
    ...(kind === 'income' ? extraNames.income : extraNames.expense),
  ]
  if (category && names.includes(category)) return category
  return kind === 'income' ? 'その他収入' : 'その他'
}

async function getMerchantRules(userId: string): Promise<MerchantRule[]> {
  const { data } = await supabaseAdmin
    .from('merchant_rules')
    .select('id,merchant_pattern,category,payment_method,confidence')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return data ?? []
}

interface ImportFields {
  date: string
  amount: number
  category: string
  kind: Kind
  payment_method: string
  memo?: string
  card_issuer?: string | null
  needs_review?: boolean
  review_reason?: string | null
}

function normalizeIssuer(value: unknown) {
  const issuer = String(value ?? '').trim()
  if (!issuer) return null
  if (issuer.includes('三井住友') || issuer.toLowerCase().includes('smbc')) return '三井住友カード'
  if (issuer.includes('楽天')) return '楽天カード'
  return issuer
}

interface ScheduledImportFields {
  date: string
  amount: number
  category: string
  name: string
  memo?: string
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) return unauthorized()

  const gasImportUserId = process.env.GAS_IMPORT_USER_ID
  const checks = {
    supabaseUrl: isSupabaseConfigured,
    serviceRoleKey: hasEnv('SUPABASE_SERVICE_ROLE_KEY'),
    gasImportSecret: hasEnv('GAS_IMPORT_SECRET'),
    gasImportUserId: hasEnv('GAS_IMPORT_USER_ID'),
    importUserMatchesLogin: Boolean(gasImportUserId && gasImportUserId === user.id),
    geminiFallback: hasEnv('GEMINI_API_KEY'),
  }
  const ready =
    checks.supabaseUrl &&
    checks.serviceRoleKey &&
    checks.gasImportSecret &&
    checks.gasImportUserId &&
    checks.importUserMatchesLogin

  return Response.json({
    ready,
    checks,
    user: {
      id: user.id,
      email: user.email,
    },
    nextAction: ready
      ? 'GAS側で diagnoseCardEmails を実行し、Gmail検索とカードメール解析を確認してください。'
      : 'Vercelの環境変数 GAS_IMPORT_SECRET / GAS_IMPORT_USER_ID と Supabase service role key を確認してください。',
  })
}

export async function POST(request: NextRequest) {
  const targetUserId = await resolveImportUserId(request)
  if (!targetUserId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allowed = await requireActiveEntitlement(targetUserId)
  if (!allowed) {
    return Response.json({ error: 'Pro purchase required' }, { status: 402 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const externalId: string | undefined = body.external_id
  const merchantRules = await getMerchantRules(targetUserId)
  // カスタムカテゴリ(チャットボット追加分)も取り込み時の有効カテゴリとして扱う
  const mergedCategories = await getMergedCategories(targetUserId)
  const customNames = {
    expense: mergedCategories.expense.map(c => c.name),
    income: mergedCategories.income.map(c => c.name),
  }

  if (body.import_target === 'scheduled_payment') {
    if (!body.date || !body.amount) {
      return Response.json({ error: 'scheduled_payment には date/amount が必要です' }, { status: 400 })
    }

    const categoryDecision = decideCategory({
      merchantText: String(body.name || body.merchant || body.memo || '口座引落予定'),
      currentCategory: body.category,
      rules: merchantRules,
    })
    const fields: ScheduledImportFields = {
      date: body.date,
      amount: Number(body.amount),
      category: normalizeCategory(categoryDecision.category, 'expense', customNames),
      name: String(body.name || body.merchant || '口座引落予定'),
      memo: body.memo ?? '',
    }

    const scheduledDate = new Date(fields.date)
    if (!Number.isFinite(fields.amount) || fields.amount <= 0 || Number.isNaN(scheduledDate.getTime())) {
      return Response.json({ error: '予定の日付または金額が不正です' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('scheduled_payments')
      .insert([{
        name: fields.name,
        amount: Math.round(fields.amount),
        due_day: scheduledDate.getDate(),
        category: fields.category,
        type: 'fixed',
        is_active: true,
        memo: fields.memo,
        scheduled_date: fields.date,
        external_id: externalId ?? null,
        source: 'gmail_bank',
        user_id: targetUserId,
      }])
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return Response.json({ duplicate: true }, { status: 200 })
      }
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ scheduledPayment: data }, { status: 201 })
  }

  let fields: ImportFields

  if (body.date && body.amount && body.category) {
    // --- モードA: GAS側で既に正規表現パース済み ---
    const kind: Kind = body.kind === 'income' ? 'income' : 'expense'
    const categoryDecision = decideCategory({
      merchantText: String(body.memo || body.merchant || body.name || body.category),
      kind,
      currentCategory: body.category,
      rules: merchantRules,
    })
    fields = {
      date: body.date,
      amount: Number(body.amount),
      category: normalizeCategory(categoryDecision.category, kind, customNames),
      kind,
      payment_method: body.payment_method || (kind === 'income' ? '口座振込' : '現金'),
      memo: body.memo ?? '',
      card_issuer: normalizeIssuer(body.card_issuer),
      needs_review: categoryDecision.needsReview || Boolean(body.needs_review),
      review_reason: categoryDecision.reviewReason ?? body.review_reason ?? null,
    }
  } else if (typeof body.text === 'string' && body.text.trim()) {
    // --- モードB: Geminiにフォールバック ---
    // 極端に長いメール本文でGemini APIコストが跳ねないように上限を設ける
    const trimmedText = body.text.slice(0, 4000)

    try {
      const parsed = await parseChatInput(trimmedText, { expense: mergedCategories.expense, income: mergedCategories.income })

      // confidenceが低い(金額やカテゴリが不明瞭)ものは自動登録せずスキップする。
      // 誤った金額が家計簿に紛れ込むより、取りこぼす方が安全という判断。
      if (parsed.confidence === 'low') {
        return Response.json({ skipped: true, reason: 'low_confidence', parsed }, { status: 200 })
      }

      const kind: Kind = parsed.kind === 'income' ? 'income' : 'expense'
      const categoryDecision = decideCategory({
        merchantText: parsed.memo,
        kind,
        currentCategory: parsed.category,
        rules: merchantRules,
      })
      fields = {
        date: parsed.date,
        amount: parsed.amount,
        category: normalizeCategory(categoryDecision.category, kind, customNames),
        kind,
        payment_method: parsed.payment_method,
        memo: parsed.memo,
        card_issuer: normalizeIssuer(body.card_issuer),
        needs_review: categoryDecision.needsReview || parsed.category === 'その他' || parsed.category === 'その他収入',
        review_reason: categoryDecision.reviewReason ?? (parsed.category === 'その他' || parsed.category === 'その他収入' ? 'AI解析後のカテゴリ確認' : null),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '解析に失敗しました'
      return Response.json({ error: message }, { status: 500 })
    }
  } else {
    return Response.json({ error: 'date/amount/category か text のいずれかが必要です' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .insert([{
      ...fields,
      source: 'gmail',
      external_id: externalId ?? null,
      card_issuer: fields.card_issuer ?? null,
      user_id: targetUserId,
    }])
    .select()
    .single()

  if (error) {
    // external_id の重複(23505: unique_violation)は「既に取り込み済み」として
    // エラーではなく成功扱いで返す。GAS側はこれを見てラベルを付ければよい。
    if (error.code === '23505') {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (fields.card_issuer) patch.card_issuer = fields.card_issuer
      if (['楽天カード', '三井住友カード'].includes(fields.payment_method)) {
        patch.payment_method = fields.payment_method
      }

      if (externalId && Object.keys(patch).length > 1) {
        await supabaseAdmin
          .from('transactions')
          .update(patch)
          .eq('user_id', targetUserId)
          .eq('external_id', externalId)
      }

      return Response.json({ duplicate: true, repaired: Object.keys(patch).length > 1 }, { status: 200 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ transaction: data }, { status: 201 })
}
