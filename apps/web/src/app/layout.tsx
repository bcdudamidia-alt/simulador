import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '../lib/session';

export const metadata: Metadata = {
  title: 'Pareo — finanças do casal',
  description:
    'Contas, cartões e metas do casal em um lugar só: importação de extratos, categorização automática e planejamento de projetos de longo prazo.',
  // Dado financeiro não deve ser indexado nem pré-visualizado por terceiro.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9f9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
};

/**
 * Script anti-flash.
 *
 * Roda antes da primeira pintura e antes do React. Sem ele, quem escolheu tema
 * escuro vê um frame branco a cada navegação. É a única linha de script inline
 * da aplicação, e por isso a CSP de produção precisa liberá-la por hash —
 * nunca por `unsafe-inline`, que abriria XSS para valer.
 */
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('pareo-theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-plane antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
