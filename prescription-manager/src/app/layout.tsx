import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gacky 処方箋管理システム',
  description: 'グランファルマ株式会社 - オンライン処方箋受付管理',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  )
}
