// lib/fetcher.ts
//
// SWR の共有 fetcher。以前は同じ1行が16ファイルに複製されていた。
//
// ※ 現状は既存の挙動をそのまま踏襲している(レスポンスをそのまま JSON 化する)。
//    つまり 401/500 でも resolve し、`{ error: '...' }` が「正常なデータ」として
//    各画面に流れ込む。本来は res.ok を見て throw し、SWR の error に乗せるべきだが、
//    16箇所の呼び出し側が「エラー時に undefined が来る」前提で書かれているため、
//    IA リファクタとは分けて別途対応する。
export const fetcher = (url: string) => fetch(url).then(r => r.json())
