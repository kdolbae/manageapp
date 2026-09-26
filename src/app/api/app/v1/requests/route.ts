import { z } from "zod";
import { appContext, json, listOwned, rpcFail } from "@/lib/app-server";

/**
 * 앱 회원의 견적 요청.
 *  GET  /api/app/v1/requests   → { requests: [...] } (requests_by_external)
 *  POST /api/app/v1/requests   → { id } 새 요청. 업체들에게 노출되고 견적이 들어오면 앱에서 비교·선택한다
 * 토큰은 앱으로 내보내지 않는다(요청 id 로만 다룬다).
 */
export async function GET(request: Request) {
  const ctx = appContext(request);
  if (ctx instanceof Response) return ctx;
  const owned = await listOwned(ctx);
  if (!owned) return json({ error: "query failed" }, 500);
  // 토큰은 빼고 내보낸다
  return json({ requests: owned.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "token"))) });
}

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const input = z.object({
  name: z.string().trim().min(1).max(40),
  phone: z.string().trim().regex(/^[0-9-+ ]{9,20}$/).transform((v) => v.replace(/\D/g, "")),
  email: z.string().trim().email().max(120).optional().or(z.literal("").transform(() => undefined)),
  region: z.string().trim().min(2).max(40),
  apt: text(60),
  address: text(120),
  area_pyeong: z.number().int().min(5).max(200).optional(),
  move_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categories: z.array(z.string().regex(/^[a-z_]{2,30}$/)).min(1).max(10),
  message: text(2000),
  budget: z.number().int().min(0).max(1_000_000_000).optional(),
  vendor_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}$/).optional(),
  utm: z.record(z.string(), z.string().max(200)).optional(),
});

export async function POST(request: Request) {
  const ctx = appContext(request);
  if (ctx instanceof Response) return ctx;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "이름·전화·지역·원하는 시공을 확인해 주세요." }, 422);
  const { data, error } = await ctx.admin.rpc("request_create", {
    p: { ...parsed.data, external_id: ctx.external, utm: { utm_source: "jipdarie_app", ...(parsed.data.utm ?? {}) } },
  });
  if (error) return rpcFail(error);
  return json({ id: (data as { id: string }).id }, 201);
}
