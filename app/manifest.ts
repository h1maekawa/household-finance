import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '家計管理',
    short_name: '家計管理',
    description: '個人向け家計管理アプリ',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4F6F9',
    theme_color: '#1476B3',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
