import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Case Packet Review",
  description: "Prepare employment-based immigration case packets for attorney review.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Case Packet Review
          </Link>
        </header>
        <main className="page">{children}</main>
        <footer className="site-footer">
          Attorney approval happens outside this tool. All cases shown are synthetic samples.
        </footer>
      </body>
    </html>
  );
}
