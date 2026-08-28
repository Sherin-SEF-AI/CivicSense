import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'
import { Providers } from './providers'
import { GlyphSprite } from '@/components/glyphs'

export const metadata: Metadata = {
  title: 'CivicSense',
  description: 'Contextual civic intelligence: operations, forensics and prediction.',
}

export const viewport: Viewport = {
  themeColor: '#08090b',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-density="compact" suppressHydrationWarning>
      <body>
        <GlyphSprite />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
