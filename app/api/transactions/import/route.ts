// app/api/transactions/import/route.ts
//
// Google Apps Script (GAS) からの取り込み専用エンドポイント。
// ブラウザのCookieセッションではなく、共有シークレットで認証する
// サーバー間通信を想定している(GASはユーザーのGmail内で完結して動くため、
// このアプリ側にGmailのOAuthトークンを一切保存しない設計になっている)。
//
// 必要な環境変数:
//   GAS_IMPORT_SECRET  … GAS側と共有するランダムな秘密文字列
//   GAS_IMPORT_USER_ID … 取り込んだ取引を紐づける Supabase の auth.users.id
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { parseChatInput } from '@/lib/gemini'

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

export async function POST(request: NextRequest) {
  const targetUserId = process.env.GAS_IMPORT_USER_ID
  if (!process.env.GAS_IMPORT_SECRET || !targetUserId) {
    return Response.json({ error: 'Gmail import is not configured' }, { status: 503 })
  }

  if (!isValidSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const text = body?.text

  if (!text || typeof text !== 'string') {
    return Response.json({ error: 'text is required' }, { status: 400 })
  }

  // 極端に長いメール本文でGemini APIコストが跳ねないように上限を設ける
  const trimmedText = text.slice(0, 4000)

  try {
    const parsed = await parseChatInput(trimmedText)

    // confidenceが低い(金額やカテゴリが不明瞭)ものは自動登録せずスキップする。
    // 誤った金額が家計簿に紛れ込むより、取りこぼす方が安全という判断。
    if (parsed.confidence === 'low') {
      return Response.json({ skipped: true, reason: 'low_confidence', parsed }, { status: 200 })
    }

    const { data, error } = await supabaseAdmin
      .from('transactions')
      .insert([{
        date: parsed.date,
        amount: parsed.amount,
        category: parsed.category,
        payment_method: parsed.payment_method,
        memo: parsed.memo,
        source: 'gmail',
        user_id: targetUserId,
      }])
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ transaction: data }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '解析に失敗しました'
    return Response.json({ error: message }, { status: 500 })
  }
}
