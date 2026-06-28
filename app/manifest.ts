import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '家計管理',
    short_name: '家計管理',
    description: '個人向け家計管理アプリ',
    start_url: '/',
    display: 'standalone',
    background_color: '#F9FAFB',
    theme_color: '#3B82F6',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
