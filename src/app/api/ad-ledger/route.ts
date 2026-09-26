// 광고비·매출 직접 기록 — 화면은 /sales/online 의 "광고비 대비 매출" 아래.
//   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD → 기간 안 기록
//   POST   { kind: 'revenue'|'spend', day, channel, amount, note? } → 추가
//   DELETE ?id=<uuid> → 지우기(deleted_at, 줄은 남는다)
// 자동으로 오는 광고비(광고 도구 기록)는 여기 적지 않는다. 매출은 전환에 금액을 붙이지 못한 것만.
import { apiAuth, dbError, json, readJson } from "@/lib/online/api";
import { ledgerIn } from "@/lib/online/report";
import { clampPeriod } from "@/lib/online/period";
import { isValidYmd } from "@/lib/dates";
import { PHONE_LIKE, isChannel } from "@/lib/online/channels";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiAuth("conversion.read");
  if (!a.ok) return a.res;
  const sp = new URL(req.url).searchParams;
  const { from, to } = clampPeriod(sp.get("from"), sp.get("to"));
  return json({ from, to, rows: await ledgerIn(a.db, a.tid, from, to) });
}

export async function POST(req: Request) {
  const a = await apiAuth("conversion.write");
  if (!a.ok) return a.res;
  const b = await readJson(req);
  const kind = b?.kind;
  const amount = Math.round(Number(b?.amount));
  if (kind !== "revenue" && kind !== "spend") return json({ error: "매출인지 광고비인지 골라 주세요." }, 400);
  if (!isValidYmd(b?.day)) return json({ error: "날짜가 필요합니다." }, 400);
  if (!isChannel(b?.channel)) return json({ error: "채널을 골라 주세요." }, 400);
  if (b?.amount === "" || b?.amount == null || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000_000) return json({ error: "금액은 0 이상 숫자여야 합니다." }, 400);
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 200) : "";
  if (PHONE_LIKE.test(note)) return json({ error: "메모에 전화번호를 적지 마세요." }, 400);
  const { data, error } = await a.db
    .from("ad_spend_ledger")
    .insert({ tenant_id: a.tid, kind, day: b.day, channel: b.channel, amount, note: note || null })
    .select("id, kind, day, channel, amount, note")
    .single();
  if (error || !data) return json({ error: dbError(error?.code) }, 400);
  return json({ ok: true, row: { ...data, amount: Number(data.amount) } });
}

export async function DELETE(req: Request) {
  const a = await apiAuth("conversion.write");
  if (!a.ok) return a.res;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "번호가 없습니다." }, 400);
  const { data, error } = await a.db.from("ad_spend_ledger").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", a.tid).is("deleted_at", null).select("id");
  if (error) return json({ error: dbError(error.code, "지우지 못했습니다.") }, 400);
  if (!data?.length) return json({ error: "그 기록을 찾지 못했습니다." }, 404);
  return json({ ok: true, id });
}
