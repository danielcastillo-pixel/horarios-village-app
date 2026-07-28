import "./globals.css";

export const metadata = {
  title: "Horarios Village",
  description: "Gestión regional de horarios y supervisores",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
