export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <p className="mb-6 text-center text-2xl font-bold tracking-tight">SomaOS</p>
      {children}
    </main>
  );
}
