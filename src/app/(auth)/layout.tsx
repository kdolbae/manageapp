export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-5 text-center">
          <div className="text-xl font-bold tracking-tight">집대리</div>
          <div className="text-xs text-muted mt-1">시공·계약·결제 관리</div>
        </div>
        <div className="card p-5">{children}</div>
      </div>
    </main>
  );
}
