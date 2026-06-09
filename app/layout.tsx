import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CLP Studio — 무료 컨테이너 적재 계산기',
  description: '화물 사이즈를 입력하면 3D 알고리즘이 최적의 컨테이너 배치를 자동으로 계산해드립니다. 20GP · 40HQ 자동 선택, 상면도 · 측면도 제공. 포워더를 위한 무료 CLP 툴.',
  keywords: 'CLP, 컨테이너 적재 계산, CBM 계산기, FCL 적재, 포워더, 물류, 컨테이너 로드 플랜, container load plan',
  authors: [{ name: 'CLP Studio' }],
  openGraph: {
    title: 'CLP Studio — 무료 컨테이너 적재 계산기',
    description: '화물 사이즈를 입력하면 3D 알고리즘이 최적의 컨테이너 배치를 자동으로 계산해드립니다.',
    url: 'https://clp-site.vercel.app',
    siteName: 'CLP Studio',
    locale: 'ko_KR',
    type: 'website',
    images: [
      {
        url: 'https://clp-site.vercel.app/og-image.png',
alt: 'CLP Studio — 무료 컨테이너 적재 계산기',
        width: 1200,
        height: 630,
        alt: 'CLP Studio',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CLP Studio — 무료 컨테이너 적재 계산기',
    description: '포워더를 위한 무료 3D 컨테이너 적재 계산기',
    images: ['https://clp-site.vercel.app/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="canonical" href="https://clp-site.vercel.app" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
