// 홈페이지 전환 이벤트 읽기. 나노마스터 홈페이지는 자기 Supabase 의 site_events 에 전화·카톡·견적폼 누름을 쌓는다.
// 여기서는 그 표를 서버 키로 읽기만 한다(새 표를 만들지 않는다). 연결은 ./sources.ts.
//
// 같이 읽는 것(없으면 건너뛴다):
//   internal_visitors  사장님·직원 기기 표식 → 목록에서 뺀다
//   site_events 의 pageview → 그 방문의 첫 페이지(어디로 들어와서 눌렀는지)
//   call_logs          전화기 기록과 시각으로 이미 맞춰진 것 → "전화기 기록 14:03:25 · 010-****-1234 · 기존 고객" 표시만
// 전화번호는 가운데를 가려서만 내보낸다. 이름은 읽지 않는다.
import type { OnlineSource } from "./sources";
import { CHANNEL_LABEL, inflowGroup, type Channel } from "./channels";

export type EventType = "call" | "kakao" | "form";
export type EventRow = {
  id: string;
  at: string;
  type: EventType;
  label: string | null;
  path: string | null;
  channel: Channel;
  channelLabel: string;
  source: string | null;
  keyword: string | null;
  landing: string | null;
  device: string;
  city: string | null;
  call: { at: string; phone: string; gap: number | null; known: boolean } | null;
};

type Raw = {
  id: number | string; created_at: string; type: EventType; label: string | null; path: string | null; source: string | null;
  utm_campaign: string | null; utm_content: string | null; ad_query: string | null;
  session_id: string | null; ua: string | null; region: string | null; city: string | null; visitor_id: string | null;
};

const BOT_UA = /headless|bot\b|spider|crawl|python|curl\/|wget|phantom|lighthouse|pagespeed|Claude\/|GPTBot|ChatGPT|slurp|facebookexternalhit/i;
const SELECT = "id,created_at,type,label,path,source,utm_campaign,utm_content,ad_query,session_id,ua,region,city,visitor_id";
export const isEventId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

async function rest<T>(src: NonNullable<OnlineSource["events"]>, q: string): Promise<T[]> {
  const res = await fetch(`${src.url}/rest/v1/${q}`, {
    headers: { apikey: src.key, Authorization: `Bearer ${src.key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`site_events ${res.status}`);
  return (await res.json()) as T[];
}
const soft = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);

/** PostgREST in.(...) 는 주소 길이 제한이 있어 나눠 부른다. */
async function getIn<T>(src: NonNullable<OnlineSource["events"]>, table: string, col: string, ids: string[], rest_: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80).map((v) => `"${v}"`).join(",");
    out.push(...(await rest<T>(src, `${table}?${col}=in.(${part})&${rest_}`)));
  }
  return out;
}

export function maskPhone(digits: string): string {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length < 9) return "****";
  const head = d.startsWith("02") ? d.slice(0, 2) : d.slice(0, 3);
  return `${head}-${"*".repeat(Math.max(3, d.length - head.length - 4))}-${d.slice(-4)}`;
}

const device = (ua: string | null) =>
  !ua ? "" : /iPhone|Android.*Mobile|iPod|Windows Phone/i.test(ua) ? "모바일" : /iPad|Android/i.test(ua) ? "태블릿" : "PC";

const channelOf = (source: string | null): Channel => inflowGroup(source || "direct") ?? "inDirect";

/** 기간 [gte, lt) 의 전환 이벤트. 내부 기기·봇은 뺀다. 못 읽으면 throw. */
export async function loadEvents(source: OnlineSource, gte: string, lt: string): Promise<EventRow[]> {
  const src = source.events;
  if (!src) return [];
  const [raw, internal] = await Promise.all([
    rest<Raw>(src, `site_events?type=in.(call,kakao,form)&created_at=gte.${encodeURIComponent(gte)}&created_at=lt.${encodeURIComponent(lt)}&select=${SELECT}&order=created_at.desc&limit=5000`),
    soft(rest<{ visitor_id: string }>(src, "internal_visitors?select=visitor_id&limit=5000")),
  ]);
  const inside = new Set(internal.map((r) => r.visitor_id));
  const events = raw.filter((e) => !BOT_UA.test(e.ua || "") && !(e.visitor_id && inside.has(e.visitor_id)));
  const ids = events.map((e) => String(e.id)).filter(isEventId);
  const sids = [...new Set(events.map((e) => e.session_id).filter((s): s is string => !!s && /^[\w-]{1,64}$/.test(s)))];
  const [views, calls] = await Promise.all([
    soft(getIn<{ session_id: string; path: string | null }>(src, "site_events", "session_id", sids, "type=eq.pageview&select=session_id,path,created_at&order=created_at.asc")),
    soft(getIn<{ match_event: number; rang_at: string; phone: string; match_gap_sec: number | null; known: boolean }>(src, "call_logs", "match_event", ids, "select=match_event,rang_at,phone,match_gap_sec,known")),
  ]);
  const landing = new Map<string, string>();
  for (const v of views) if (!landing.has(v.session_id)) landing.set(v.session_id, v.path || "/");
  const callBy = new Map(calls.map((c) => [String(c.match_event), c]));
  return events.map((e) => {
    const ch = channelOf(e.source);
    const c = callBy.get(String(e.id));
    return {
      id: String(e.id),
      at: e.created_at,
      type: e.type,
      label: e.label,
      path: e.path,
      channel: ch,
      channelLabel: CHANNEL_LABEL[ch],
      source: e.source,
      keyword: e.ad_query || e.utm_content || e.utm_campaign || null,
      landing: e.session_id ? landing.get(e.session_id) ?? null : null,
      device: device(e.ua),
      city: e.city || e.region || null,
      call: c ? { at: c.rang_at, phone: maskPhone(c.phone), gap: c.match_gap_sec, known: !!c.known } : null,
    };
  });
}

/** 결과를 처음 붙일 때 이벤트 한 건(시각·종류·채널)을 확인한다. 없으면 null. */
export async function getEvent(source: OnlineSource, id: string): Promise<{ at: string; type: EventType; channel: Channel } | null> {
  if (!source.events || !isEventId(id)) return null;
  const [e] = await rest<Pick<Raw, "created_at" | "type" | "source">>(source.events, `site_events?id=eq.${id}&type=in.(call,kakao,form)&select=created_at,type,source`);
  return e ? { at: e.created_at, type: e.type, channel: channelOf(e.source) } : null;
}
