import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { OPENAGENT_OG_IMAGE, SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const themeBootstrapScript = `
  (() => {
    const root = document.documentElement;
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  })();
`

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "OpenAgent — Obsidian Canvas Workspace for Codex",
    template: "%s | OpenAgent",
  },
  description: "OpenAgent turns Obsidian Canvas into a local workspace for Codex. Select nodes, create a task, stream progress locally, and write the result back into the graph.",
  keywords: ["openagent", "codex", "obsidian", "canvas", "local-first", "ai coding", "open source", "developer tools", "convos", "agent workspace"],
  authors: [{ name: "OpenAgent" }],
  creator: "OpenAgent",
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "OpenAgent — Obsidian Canvas Workspace for Codex",
    description: "OpenAgent turns Obsidian Canvas into a local workspace for Codex, with local execution, graph-native context, and mobile control through Convos.",
    url: SITE_URL,
    siteName: "OpenAgent",
    images: [OPENAGENT_OG_IMAGE],
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenAgent — Obsidian Canvas Workspace for Codex",
    description: "OpenAgent turns Obsidian Canvas into a local workspace for Codex, with local execution, graph-native context, and mobile control through Convos.",
    images: [OPENAGENT_OG_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
