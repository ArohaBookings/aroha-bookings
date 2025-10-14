import "./globals.css";
import Sidebar from "../components/Sidebar";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex">
        <Sidebar />
        <main className="flex-1 bg-gray-50 p-6">{children}</main>
      </body>
    </html>
  );
}
