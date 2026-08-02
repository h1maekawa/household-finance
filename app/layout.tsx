import type { Metadata, Viewport } from 'next'
import './globals.css'
import MobileNav from '@/components/MobileNav'
import Sidebar from '@/components/Sidebar'
import SWRProvider from '@/components/SWRProvider'
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
  themeColor: '#1476B3',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-svh flex bg-background">
        <SWRProvider>
          <ToastProvider>
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <MobileNav />
              {/* モバイルは下部固定タブぶんの余白を確保する。
                  これが無いと最後のカードがタブに隠れて押せない */}
              <main className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
                {children}
              </main>
            </div>
          </ToastProvider>
        </SWRProvider>
      </body>
    </html>
  )
}
