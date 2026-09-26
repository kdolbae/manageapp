import { appContext, json } from "@/lib/app-server";

/** 견적 요청 분류 (platform_category). GET /api/app/v1/categories */
export async function GET(request: Request) {
  const ctx = appContext(request, { needUser: false });
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.admin.from("platform_category").select("code, label").eq("is_active", true).order("sort_order");
  if (error) return json({ error: "query failed" }, 500);
  return json({ categories: data ?? [] });
}
