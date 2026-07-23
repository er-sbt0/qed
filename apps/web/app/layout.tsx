import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import 'katex/dist/katex.min.css';
import './globals.css';

// Hard contract: globals.css references --font-inter / --font-jetbrains-mono.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jbmono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  title: 'Math AI',
  description: 'A student math tutor that answers with live, draggable math — not video.',
};

/**
 * Runs before hydration: applies the stored light/dark theme to
 * <html data-theme> so the first paint already matches the user's choice
 * (no FOUC). Missing or unrecognised values default to light.
 */
const THEME_INIT = `(function(){var t='light';try{var s=localStorage.getItem('math-ai-theme');if(s==='dark')t='dark';}catch(e){}document.documentElement.dataset.theme=t;})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  );
}
