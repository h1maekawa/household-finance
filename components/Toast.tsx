'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast-enter px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium w-full max-w-sm pointer-events-auto ${
              toast.type === 'success' ? 'bg-success' :
              toast.type === 'error'   ? 'bg-danger'  :
              toast.type === 'warning' ? 'bg-warning' :
              'bg-gray-800'
            }`}
          >
            {message_icon(toast.type)} {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function message_icon(type: ToastType) {
  if (type === 'success') return '✓'
  if (type === 'error')   return '✕'
  if (type === 'warning') return '⚠'
  return 'ℹ'
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}
