'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { LogOut } from 'lucide-react'
import { useToast } from '@/components/Toast'

export default function SignOutButton({ variant = 'pill' }: { variant?: 'pill' | 'menu' } = {}) {
  const router = useRouter()
  const { showToast } = useToast()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    const { error } = await supabase.auth.signOut()

    if (typeof window !== 'undefined') {
      Object.keys(window.localStorage)
        .filter(key => key.startsWith('sb-'))
        .forEach(key => window.localStorage.removeItem(key))
    }

    if (error) {
      showToast('ログアウトに失敗しました。もう一度お試しください。', 'error')
      setIsSigningOut(false)
      return
    }

    showToast('ログアウトしました', 'success')
    router.replace('/')
    router.refresh()
  }

  const className =
    variant === 'menu'
      ? 'flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] text-danger transition-base active:bg-surface disabled:opacity-50'
      : 'rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white transition-base active:opacity-80 disabled:opacity-50'

  return (
    <button type="button" onClick={handleSignOut} disabled={isSigningOut} className={className}>
      {variant === 'menu' && <LogOut size={15} strokeWidth={1.75} aria-hidden />}
      {isSigningOut ? '処理中' : 'ログアウト'}
    </button>
  )
}
