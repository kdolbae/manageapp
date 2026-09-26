import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { SubTabs } from "@/components/sub-tabs";

const TABS = [
  { href: "/content", label: "사진" },
  { href: "/content/reviews", label: "후기" },
  { href: "/content/posts", label: "콘텐츠" },
];

export default async function ContentLayout({ children }: LayoutProps<"/content">) {
  const session = await requireTenant();
  return (
    <div>
      <div className="panel-head">
        <h1>
          사진·후기·콘텐츠 <span className="sub">{session.current.tenant.name}</span>
        </h1>
        {session.can("content.write") && (
          <Link href="/content/posts/new" className="btn btn-primary btn-sm h-8 text-[13px]">
            콘텐츠 만들기
          </Link>
        )}
      </div>
      {session.can("content.read") ? (
        <>
          <SubTabs tabs={TABS} />
          {children}
        </>
      ) : (
        <p className="p-4 text-sm text-muted">사진·후기를 볼 수 있는 권한이 없습니다.</p>
      )}
    </div>
  );
}
