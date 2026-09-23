import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const [branches, members, invites] = await Promise.all([
    supabase.from("branch").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "active").is("deleted_at", null),
    supabase.from("membership").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "active"),
    session.can("member.manage")
      ? supabase.from("invitation").select("id", { count: "exact", head: true }).eq("tenant_id", tid).is("accepted_at", null)
      : Promise.resolve({ count: null }),
  ]);

  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  return (
    <div>
      <div className="panel-head">
        <h1>
          모니터링 <span className="sub">{today}</span>
        </h1>
        {session.can("contract.write") && (
          <Link href="/contracts/new" className="btn btn-primary">계약 등록</Link>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 border-b border-border bg-surface">
        <div className="stat"><div className="k">오늘 계약</div><div className="v zero">0</div></div>
        <div className="stat"><div className="k">오늘 시공</div><div className="v zero">0</div></div>
        <div className="stat"><div className="k">미수 잔액</div><div className="v zero">0</div></div>
        <div className="stat"><div className="k">새 문의</div><div className="v zero">0</div></div>
        <div className="stat"><div className="k">운영 지점</div><div className="v">{branches.count ?? 0}</div></div>
        <div className="stat"><div className="k">구성원</div><div className="v">{members.count ?? 0}</div></div>
      </div>
      <div className="p-4 grid gap-4 md:grid-cols-2 max-w-[960px]">
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">지금 할 수 있는 것 (D1)</h2>
          <ul className="text-sm grid gap-1.5">
            <li><Link href="/settings/tenant">사업체 정보와 고객 페이지 브랜드</Link></li>
            <li><Link href="/settings/branches">지점 추가·수정</Link></li>
            <li>
              <Link href="/settings/members">구성원 초대와 권한 지정</Link>
              {invites.count ? <span className="badge badge-wait ml-2">초대 대기 {invites.count}</span> : null}
            </li>
            <li><Link href="/settings/roles">역할별 권한표</Link></li>
          </ul>
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">다음에 들어오는 것</h2>
          <ul className="text-sm text-muted grid gap-1.5">
            <li>D2 고객·시공자·협력업체 등록, 상품·단가</li>
            <li>D3 계약 등록(계약자 × 현장, 시공 건별 상태)</li>
            <li>D4 수납·원장·계약 목록</li>
            <li>D5 시공 배정 보드 (1차 데모)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
