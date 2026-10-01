import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Provider Survey",
  description: "Provider survey portal",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
