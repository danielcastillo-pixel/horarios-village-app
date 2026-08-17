import "./globals.css";

export const metadata = {
  title: "Tipti Operaciones | Región",
  description: "Gestión regional de horarios y supervisores",
  icons: {
    icon: "/tipti-logo.png",
    shortcut: "/tipti-logo.png",
    apple: "/tipti-logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
