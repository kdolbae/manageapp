import { appContext, json, ownedToken } from "@/lib/app-server";

/**
 * 요청 한 건: 요청 + 받은 견적(업체 카드) + 업체별 대화. GET /api/app/v1/requests/<id>
 * 연 순간 업체가 보낸 메시지를 읽음으로 표시한다(앱 목록의 안 읽은 수가 줄도록).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = appContext(request);
  if (ctx instanceof Response) return ctx;
  const token = await ownedToken(ctx, id);
  if (!token) return json({ error: "not found" }, 404);
  const { data, error } = await ctx.admin.rpc("request_page", { p_token: token });
  if (error || !data) return json({ error: "query failed" }, 500);
  await ctx.admin.from("request_message").update({ read_at: new Date().toISOString() }).eq("request_id", id).eq("sender", "vendor").is("read_at", null);
  return json(data);
}
