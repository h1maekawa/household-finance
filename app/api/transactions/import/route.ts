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
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getAuthenticatedUser, unauthorized } from '@/lib/auth'
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase'
import { parseChatInput } from '@/lib/gemini'
import { CATEGORIES, INCOME_CATEGORIES, Kind } from '@/types/transaction'

function hasEnv(name: string): boolean {
  const value = process.env[name]
  return Boolean(value && !value.includes('placeholder'))
}

function isValidSecret(request: NextRequest): boolean {
  const provided = request.headers.get('x-import-secret')
  const expected = process.env.GAS_IMPORT_SECRET

  if (!provided || !expected) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // 長さが違うと timingSafeEqual が例外を投げるため先にガードする
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

function normalizeCategory(category: string | undefined, kind: Kind): string {
  const list = kind === 'income' ? INCOME_CATEGORIES : CATEGORIES
  const names = list.map(c => c.name) as string[]
  if (category && names.includes(category)) return category
  return kind === 'income' ? 'その他収入' : 'その他'
}

interface ImportFields {
  date: string
  amount: number
  category: string
  kind: Kind
  payment_method: string
  memo?: string
  needs_review?: boolean
  review_reason?: string | null
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
  const targetUserId = process.env.GAS_IMPORT_USER_ID
  if (!process.env.GAS_IMPORT_SECRET || !targetUserId) {
    return Response.json({ error: 'Gmail import is not configured' }, { status: 503 })
  }

  if (!isValidSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const externalId: string | undefined = body.external_id
  let fields: ImportFields

  if (body.date && body.amount && body.category) {
    // --- モードA: GAS側で既に正規表現パース済み ---
    const kind: Kind = body.kind === 'income' ? 'income' : 'expense'
    fields = {
      date: body.date,
      amount: Number(body.amount),
      category: normalizeCategory(body.category, kind),
      kind,
      payment_method: body.payment_method || (kind === 'income' ? '口座振込' : '現金'),
      memo: body.memo ?? '',
      needs_review: Boolean(body.needs_review),
      review_reason: body.review_reason ?? null,
    }
  } else if (typeof body.text === 'string' && body.text.trim()) {
    // --- モードB: Geminiにフォールバック ---
    // 極端に長いメール本文でGemini APIコストが跳ねないように上限を設ける
    const trimmedText = body.text.slice(0, 4000)

    try {
      const parsed = await parseChatInput(trimmedText)

      // confidenceが低い(金額やカテゴリが不明瞭)ものは自動登録せずスキップする。
      // 誤った金額が家計簿に紛れ込むより、取りこぼす方が安全という判断。
      if (parsed.confidence === 'low') {
        return Response.json({ skipped: true, reason: 'low_confidence', parsed }, { status: 200 })
      }

      const kind: Kind = parsed.kind === 'income' ? 'income' : 'expense'
      fields = {
        date: parsed.date,
        amount: parsed.amount,
        category: normalizeCategory(parsed.category, kind),
        kind,
        payment_method: parsed.payment_method,
        memo: parsed.memo,
        needs_review: parsed.category === 'その他' || parsed.category === 'その他収入',
        review_reason: parsed.category === 'その他' || parsed.category === 'その他収入' ? 'AI解析後のカテゴリ確認' : null,
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
      user_id: targetUserId,
    }])
    .select()
    .single()

  if (error) {
    // external_id の重複(23505: unique_violation)は「既に取り込み済み」として
    // エラーではなく成功扱いで返す。GAS側はこれを見てラベルを付ければよい。
    if (error.code === '23505') {
      return Response.json({ duplicate: true }, { status: 200 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ transaction: data }, { status: 201 })
}
