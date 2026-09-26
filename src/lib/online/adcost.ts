// 자동 광고비. 광고 도구 저장소(나노마스터: kdolbae/nanomaster-ads)가 매일 data/daily_cost.json 에 남긴다.
// 형식 { updated, days: { "YYYY-MM-DD": { naver: {imp,clk,cost,conv}, meta: {imp,clk,link_clk,cost,leads} } } }, cost 는 원·부가세 별도.
// 저장소마다 10분 기억한다. 못 읽으면 null — 화면은 "자동 기록 없음" 만 보여 준다.
import type { OnlineSource } from "./sources";
import type { AutoCost } from "./money";

type DayCost = {
  naver?: { imp?: number; clk?: number; cost?: number; conv?: number };
  meta?: { imp?: number; clk?: number; link_clk?: number; cost?: number; leads?: number };
};
export type CostFile = { updated: string | null; days: Record<string, DayCost> };

const cache = new Map<string, { at: number; data: CostFile | null }>();
const TTL = 10 * 60_000;

export async function loadCosts(src: OnlineSource): Promise<CostFile | null> {
  if (!src.ads) return null;
  const { repo, path, token } = src.ads;
  const k = `${repo}/${path}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  let data: CostFile | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "jipdaeri" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const j = (await res.json()) as { updated?: string; days?: unknown };
      data = j && j.days && typeof j.days === "object" ? { updated: j.updated ?? null, days: j.days as Record<string, DayCost> } : null;
    } else console.error("[online] daily_cost", res.status);
  } catch (e) {
    console.error("[online] daily_cost", e);
  }
  cache.set(k, { at: Date.now(), data });
  return data;
}

/** from~to(한국 날짜) 사이 채널별 자동 광고비. 자료가 없는 날은 빼고, 잡힌 날 수를 같이 준다. */
export function sumCosts(costs: CostFile | null, from: string, to: string): AutoCost {
  const out: AutoCost = { naver: { cost: 0, days: 0 }, meta: { cost: 0, days: 0 }, days: 0 };
  if (!costs) return out;
  for (const [k, d] of Object.entries(costs.days)) {
    if (k < from || k > to || !d) continue;
    if (d.naver) {
      out.naver.cost += Math.round(Number(d.naver.cost) || 0);
      out.naver.days++;
    }
    if (d.meta) {
      out.meta.cost += Math.round(Number(d.meta.cost) || 0);
      out.meta.days++;
    }
    out.days++;
  }
  return out;
}
