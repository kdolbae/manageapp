import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTeamsCard } from "./teams";
import { phone } from "@/lib/format";

const CHANNEL_LABEL: Record<string, string> = { web: "홈페이지", phone: "전화", kakao: "카카오", partner: "협력업체", walk_in: "방문", fair: "박람회", other: "기타" };

type Outbox = { id: string; tenant_id: string; channel: string; template: string; payload: Record<string, unknown>; attempts: number };

/** 대기 중인 알림을 보낸다. 서비스 키 클라이언트로만 호출한다. 실패는 기록하고 다음 주기에 다시 시도한다. */
export async function deliverPending(admin: SupabaseClient, opts: { tenantId?: string; limit?: number; siteUrl: string } ): Promise<{ sent: number; failed: number; skipped: number }> {
  let q = admin.from("notification_outbox").select("id, tenant_id, channel, template, payload, attempts").eq("status", "pending").lte("scheduled_at", new Date().toISOString()).lt("attempts", 5).order("scheduled_at").limit(opts.limit ?? 20);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  const { data } = await q;
  const rows = (data ?? []) as Outbox[];
  const result = { sent: 0, failed: 0, skipped: 0 };
  const webhookCache = new Map<string, string | null>();

  for (const row of rows) {
    try {
      if (row.channel === "teams") {
        if (!webhookCache.has(row.tenant_id)) {
          const { data: cfg } = await admin.from("integration_config").select("config, is_active").eq("tenant_id", row.tenant_id).eq("kind", "teams_webhook").maybeSingle();
          webhookCache.set(row.tenant_id, cfg?.is_active ? String((cfg.config as { url?: string }).url ?? "") || null : null);
        }
        const url = webhookCache.get(row.tenant_id);
        if (!url) {
          await admin.from("notification_outbox").update({ status: "skipped", last_error: "teams webhook not configured" }).eq("id", row.id);
          result.skipped++;
          continue;
        }
        const p = row.payload as { title?: string; body?: string; phone?: string; apt?: string; channel?: string; source_page?: string; inquiry_id?: string };
        if (row.template === "inquiry.new") {
          await sendTeamsCard(url, {
            title: `새 문의 · ${p.title ?? ""}`,
            facts: [
              { name: "연락처", value: phone(p.phone) },
              { name: "단지", value: p.apt ?? "" },
              { name: "경로", value: `${CHANNEL_LABEL[p.channel ?? ""] ?? p.channel ?? ""}${p.source_page ? ` ${p.source_page}` : ""}` },
            ],
            text: p.body,
            link: p.inquiry_id ? { title: "집대리에서 열기", url: `${opts.siteUrl}/inbox/${p.inquiry_id}` } : undefined,
          });
        } else {
          await sendTeamsCard(url, { title: p.title ?? row.template, text: p.body });
        }
        await admin.from("notification_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1 }).eq("id", row.id);
        result.sent++;
      } else {
        // 알림톡·문자·푸시·메일은 이후 단계에서 연결. 지금은 건너뛰고 기록만 남긴다.
        await admin.from("notification_outbox").update({ status: "skipped", last_error: `${row.channel} sender not connected yet`, attempts: row.attempts + 1 }).eq("id", row.id);
        result.skipped++;
      }
    } catch (e) {
      await admin.from("notification_outbox").update({ status: row.attempts + 1 >= 5 ? "failed" : "pending", last_error: String(e).slice(0, 300), attempts: row.attempts + 1, scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString() }).eq("id", row.id);
      result.failed++;
    }
  }
  return result;
}
