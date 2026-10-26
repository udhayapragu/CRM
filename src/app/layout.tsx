import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Luxe CRM", template: "%s · Luxe CRM" },
  description: "Luxury CRM & inventory management connected to your WordPress store",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#08060d", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("luxe_theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" className={theme} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
