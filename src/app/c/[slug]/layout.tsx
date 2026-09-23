import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicTenant, brandStyle } from "@/lib/public";

export async function generateMetadata({ params }: LayoutProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const admin = createAdminClient();
  const t = admin ? await publicTenant(admin, slug) : null;
  const name = t?.brand.app_name || t?.name || "집대리";
  return { title: { default: name, template: `%s · ${name}` }, robots: { index: false } };
}

export default async function BrandLayout({ children, params }: LayoutProps<"/c/[slug]">) {
  const { slug } = await params;
  const admin = createAdminClient();
  const t = admin ? await publicTenant(admin, slug) : null;
  if (!t) {
    return <main className="min-h-dvh grid place-items-center p-6 text-center text-sm text-muted">페이지를 찾을 수 없습니다.</main>;
  }
  const name = t.brand.app_name || t.name;
  return (
    <div style={brandStyle(t.brand)} className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-10 bg-surface border-b border-border">
        <div className="max-w-[640px] mx-auto px-4 h-[52px] flex items-center justify-between">
          <a href={`/c/${t.slug}`} className="no-underline text-text"><b className="text-[15px]">{name}</b>{t.brand.app_name && t.brand.app_name !== t.name && <span className="text-xs text-muted ml-2">{t.name}</span>}</a>
          {t.brand.phone && <a href={`tel:${t.brand.phone.replace(/\D/g, "")}`} className="btn btn-primary btn-sm">전화 문의</a>}
        </div>
      </header>
      <main className="max-w-[640px] mx-auto px-4 py-5 grid gap-4">{children}</main>
      <footer className="max-w-[640px] mx-auto px-4 py-8 text-[11px] text-muted">
        {t.name}{t.brand.address ? ` · ${t.brand.address}` : ""}{t.brand.phone ? ` · ${t.brand.phone}` : ""}
      </footer>
    </div>
  );
}
