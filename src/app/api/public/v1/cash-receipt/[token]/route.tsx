import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { won } from "@/lib/format";
import { maskIdentity, maskName } from "@/lib/cash-receipt/parse";

/**
 * 현금영수증 이미지(PNG). Teams 카드가 이 주소를 불러 보여준다.
 * 주소의 토큰(36자 난수)이 곧 열쇠이고, 이름·번호는 가려서 그린다. 원본 확인은 국세청 홈택스에서.
 */
export const runtime = "nodejs";

const fontCache = new Map<string, ArrayBuffer>();
async function koreanFont(weight: 400 | 700, text: string): Promise<ArrayBuffer | null> {
  const key = `${weight}:${text}`;
  if (fontCache.has(key)) return fontCache.get(key)!;
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(text)}`)).text();
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    if (!src) return null;
    const buf = await (await fetch(src)).arrayBuffer();
    if (fontCache.size > 50) fontCache.clear();
    fontCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

function fmtTradeDate(d: string | null, fallback: string | null) {
  if (d && /^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (!fallback) return "";
  return new Date(new Date(fallback).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
function fmtBiz(n: string | null | undefined) {
  const d = (n ?? "").replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d;
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const clean = token.replace(/\.png$/, "");
  if (!/^[0-9a-f]{36}$/.test(clean)) return new Response("not found", { status: 404 });
  const admin = createAdminClient();
  if (!admin) return new Response("server not configured", { status: 503 });
  const { data: r } = await admin
    .from("cash_receipt")
    .select("status, provider, trade_usage, identity_num, customer_name, item_name, taxation, total_amount, supply_cost, tax, confirm_num, trade_date, issued_at, canceled_at, tenant_id, contract_id")
    .eq("image_token", clean)
    .maybeSingle();
  if (!r || (r.status !== "issued" && r.status !== "canceled")) return new Response("not found", { status: 404 });
  const [{ data: t }, { data: cfg }, { data: c }] = await Promise.all([
    admin.from("tenant").select("name, business_no").eq("id", r.tenant_id).single(),
    admin.from("integration_config").select("config").eq("tenant_id", r.tenant_id).eq("kind", "cash_receipt").maybeSingle(),
    admin.from("contract").select("contract_no").eq("id", r.contract_id).single(),
  ]);
  const corpNum = fmtBiz(((cfg?.config ?? {}) as { corp_num?: string }).corp_num ?? t?.business_no);
  const isMock = r.provider === "mock";
  const canceled = r.status === "canceled";

  const rows: [string, string][] = [
    ["거래일자", fmtTradeDate(r.trade_date, r.issued_at)],
    ["승인번호", r.confirm_num ?? "-"],
    ["용도", r.trade_usage === "expense" ? "지출증빙용" : "소득공제용"],
    ["식별번호", maskIdentity(r.identity_num)],
    ["고객명", maskName(r.customer_name) || "-"],
    ["품목", r.item_name],
    ["계약번호", c?.contract_no ?? "-"],
  ];
  const money: [string, string][] = [
    [r.taxation === "exempt" ? "면세 금액" : "공급가액", `${won(r.supply_cost)}원`],
    ["부가세", `${won(r.tax)}원`],
  ];
  const title = "현금영수증";
  const allText = [title, "합계", "가맹점", "사업자번호", "시험 발행 · 국세청 전송 없음", "취소된 영수증", "국세청 홈택스에서 승인번호로 확인할 수 있습니다", t?.name ?? "", corpNum, won(r.total_amount), "원",
    ...rows.flat(), ...money.flat()].join("") + "0123456789-,.:*·()원";
  const [regular, bold] = await Promise.all([koreanFont(400, allText), koreanFont(700, allText)]);
  const fonts = [
    ...(regular ? [{ name: "NotoKR", data: regular, weight: 400 as const, style: "normal" as const }] : []),
    ...(bold ? [{ name: "NotoKR", data: bold, weight: 700 as const, style: "normal" as const }] : []),
  ];

  const W = 720;
  return new ImageResponse(
    (
      <div style={{ width: W, height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", color: "#111827", fontFamily: "NotoKR", padding: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{title}</div>
          {isMock && <div style={{ display: "flex", fontSize: 18, color: "#b45309", border: "2px solid #b45309", borderRadius: 8, padding: "4px 10px" }}>시험 발행 · 국세청 전송 없음</div>}
          {canceled && <div style={{ display: "flex", fontSize: 18, color: "#b91c1c", border: "2px solid #b91c1c", borderRadius: 8, padding: "4px 10px" }}>취소된 영수증</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 14, fontSize: 20, color: "#4b5563" }}>
          <div style={{ display: "flex" }}>가맹점 {t?.name ?? ""}</div>
          <div style={{ display: "flex" }}>사업자번호 {corpNum}</div>
        </div>
        <div style={{ display: "flex", height: 2, background: "#111827", marginTop: 22, marginBottom: 10 }} />
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 22, padding: "8px 0" }}>
            <div style={{ display: "flex", color: "#6b7280" }}>{k}</div>
            <div style={{ display: "flex", maxWidth: 440, textAlign: "right" }}>{v}</div>
          </div>
        ))}
        <div style={{ display: "flex", height: 1, background: "#d1d5db", marginTop: 10, marginBottom: 10 }} />
        {money.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 22, padding: "6px 0" }}>
            <div style={{ display: "flex", color: "#6b7280" }}>{k}</div>
            <div style={{ display: "flex" }}>{v}</div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14, padding: "16px 20px", background: "#f3f4f6", borderRadius: 12 }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700 }}>합계</div>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>{won(r.total_amount)}원</div>
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 16, color: "#6b7280" }}>국세청 홈택스에서 승인번호로 확인할 수 있습니다</div>
      </div>
    ),
    { width: W, height: 820, fonts: fonts.length ? fonts : undefined, headers: { "cache-control": "private, max-age=300" } },
  );
}
