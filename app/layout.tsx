import type { Metadata, Viewport } from 'next'
import './globals.css'
import BottomNav from '@/components/BottomNav'
import { ToastProvider } from '@/components/Toast'

export const metadata: Metadata = {
  title: '家計管理',
  description: '個人向け家計管理アプリ',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '家計管理',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#3B82F6',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-svh flex flex-col bg-surface">
        <ToastProvider>
          <main className="flex-1 pb-nav">{children}</main>
          <BottomNav />
        </ToastProvider>
      </body>
    </html>
  )
}
