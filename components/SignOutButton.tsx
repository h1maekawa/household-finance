'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'

export default function SignOutButton() {
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

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white transition-base active:opacity-80 disabled:opacity-50"
    >
      {isSigningOut ? '処理中' : 'ログアウト'}
    </button>
  )
}
