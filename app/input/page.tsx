'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TransactionForm from '@/components/TransactionForm'
import ChatInput from '@/components/ChatInput'

type Tab = 'form' | 'chat'

export default function InputPage() {
  const [tab, setTab] = useState<Tab>('form')
  const router = useRouter()

  function onSuccess() {
    router.push('/transactions')
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border z-10">
        <div className="px-4 pt-8 pb-0">
          <h1 className="text-xl font-bold mb-3">取引を入力</h1>
          <div className="flex gap-0 bg-surface rounded-xl p-1">
            {(['form', 'chat'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${
                  tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted'
                }`}
              >
                {t === 'form' ? '📝 フォーム' : '✨ チャット'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'form' ? (
        <TransactionForm onSuccess={onSuccess} />
      ) : (
        <ChatInput onSuccess={onSuccess} />
      )}
    </div>
  )
}
