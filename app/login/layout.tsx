// app/login/layout.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const dynamicParams = true;

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
