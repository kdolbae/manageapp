import { z } from "zod";
import { appContext, isUuid, json, ownedToken, rpcFail } from "@/lib/app-server";

/**
 * 요청에 대한 고객 행동 (앱 회원 본인 요청만).
 *  POST .../accept   { quote_id }        견적 선택 (나머지 견적은 자동 거절, 업체에 알림)
 *  POST .../messages { tenant_id, body } 견적 낸 업체에게 메시지 (전화번호 없이 앱 안에서 대화)
 *  POST .../phone    { share }           선택한 업체에 전화번호 공개/숨김
 *  POST .../close    {}                  요청 마감(선택 전이면 취소)
 */
const bodies = {
  accept: z.object({ quote_id: z.string().refine(isUuid) }),
  messages: z.object({ tenant_id: z.string().refine(isUuid), body: z.string().trim().min(1).max(2000) }),
  phone: z.object({ share: z.boolean() }),
  close: z.object({}).passthrough(),
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!(action in bodies)) return json({ error: "unknown action" }, 404);
  const ctx = appContext(request);
  if (ctx instanceof Response) return ctx;
  const parsed = bodies[action as keyof typeof bodies].safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "입력을 확인해 주세요." }, 422);
  const token = await ownedToken(ctx, id);
  if (!token) return json({ error: "not found" }, 404);

  const d = parsed.data as Record<string, unknown>;
  const call =
    action === "accept" ? ctx.admin.rpc("request_accept", { p_token: token, p_quote: d.quote_id })
    : action === "messages" ? ctx.admin.rpc("request_customer_message", { p_token: token, p_tenant: d.tenant_id, p_body: d.body })
    : action === "phone" ? ctx.admin.rpc("request_share_phone", { p_token: token, p_share: d.share })
    : ctx.admin.rpc("request_close", { p_token: token });
  const { error } = await call;
  if (error) return rpcFail(error);
  return json({ ok: true });
}
