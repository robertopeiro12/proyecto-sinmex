import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// UI Etapa 1 (spec §2.1): Public Sans para todo el texto (cifras de ancho fijo con
// `tabular-nums`) y Bricolage Grotesque solo para el titulo de la pantalla y el nombre
// de la sucursal. La mono se queda donde ya se usaba (folios).
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Sin `title`: lo pone cada pantalla del portal ("Ventas | JAWA Tijuana", MarcoPortal) y el
// login trae el suyo. Dos <title> en el <head> harían que el navegador mostrara el primero.
export const metadata: Metadata = {
  description: "Portal de administración de JAWA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Las variables de la fuente van en <html>: globals.css aplica `font-sans` ahi, y
    // definidas en <body> no las veia, asi que todo el portal caia en Times.
    <html lang="es" className={`${publicSans.variable} ${bricolage.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
