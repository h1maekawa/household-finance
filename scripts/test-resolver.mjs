// Node の ESM 解決は拡張子必須・パスエイリアス非対応なので、
// アプリ側のコード(`@/lib/...` や拡張子なしの相対 import)をそのまま
// `node --test` で実行できるようにする解決フック。
// アプリコードを「テストのために」書き換えないための仕組み。
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = process.cwd()
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs']

function candidatesFor(base) {
  return [
    ...EXTENSIONS.map(ext => base + ext),
    ...EXTENSIONS.map(ext => path.join(base, 'index' + ext)),
  ]
}

function firstExistingFile(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  let base = null

  if (specifier.startsWith('@/')) {
    base = path.join(root, specifier.slice(2))
  } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
  }

  if (base) {
    const resolved =
      (existsSync(base) && statSync(base).isFile() ? base : null) ??
      firstExistingFile(candidatesFor(base))
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context)
  }

  return nextResolve(specifier, context)
}
