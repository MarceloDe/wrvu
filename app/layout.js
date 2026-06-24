import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import PWARegister from "../components/PWARegister";

export const metadata = {
  title: "NeuroRVU — Neuroradiology Productivity",
  description:
    "Track neuroradiology productivity against CMS 2026 wRVU benchmarks. AI screenshot extraction, live wRVU lookup, multi-site reconciliation.",
  manifest: "/manifest.webmanifest",
  applicationName: "NeuroRVU",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "NeuroRVU" },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png" }],
  },
};

export const viewport = {
  themeColor: "#0b0f14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          {children}
          <PWARegister />
        </body>
      </html>
    </ClerkProvider>
  );
}
