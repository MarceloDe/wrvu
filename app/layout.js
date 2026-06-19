import "./globals.css";

export const metadata = {
  title: "NeuroRVU",
  description: "Neuroradiology productivity tracker — CMS 2026",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
