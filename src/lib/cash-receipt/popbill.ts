import { createHash, createHmac } from "node:crypto";
import { ProviderError, type CashReceiptProvider, type IssueInput, type LookupResult } from "./provider";

/**
 * 팝빌(링크허브) 현금영수증 REST 호출. 공식 Node SDK(popbill)와 같은 서명 방식을 쓰되, 콜백 대신 Promise 로,
 * 응답이 JSON 이 아니어도 프로세스를 죽이지 않게 직접 구현했다.
 *  - 토큰: POST https://auth.linkhub.co.kr/{POPBILL|POPBILL_TEST}/Token, 사업자번호별 30분
 *    서명 = Base64(HMAC-SHA256(Base64Decode(SecretKey), "POST\n" + Base64(SHA256(body)) + "\n" + x-lh-date + "\n" + ["*\n"] + "2.0\n" + uri))
 *  - 발행: POST /Cashbill (X-HTTP-Method-Override: ISSUE), 조회: GET /Cashbill/{문서번호}
 * 환경변수: POPBILL_LINK_ID, POPBILL_SECRET_KEY, POPBILL_IS_TEST(기본 1), POPBILL_IP_RESTRICT(기본 0: 서버리스라 IP 고정 안 됨)
 */
const AUTH_HOST = "https://auth.linkhub.co.kr";
const API_VERSION = "2.0";

type Token = { session_token: string; expiration: string };
const tokens = new Map<string, Token>();

function cfg() {
  const linkId = process.env.POPBILL_LINK_ID;
  const secret = process.env.POPBILL_SECRET_KEY;
  if (!linkId || !secret) throw new ProviderError("팝빌 연동 키(POPBILL_LINK_ID, POPBILL_SECRET_KEY)가 서버에 없습니다.", "config");
  const isTest = process.env.POPBILL_IS_TEST !== "0";
  return {
    linkId, secret, isTest,
    serviceId: isTest ? "POPBILL_TEST" : "POPBILL",
    apiHost: isTest ? "https://popbill-test.linkhub.co.kr" : "https://popbill.linkhub.co.kr",
    forward: process.env.POPBILL_IP_RESTRICT === "1" ? null : "*",
  };
}

/** 링크허브 토큰 요청 헤더 (SDK TokenBuilder 와 같은 서명). 테스트에서 SDK 결과와 비교한다. */
export function linkhubTokenRequest(o: { linkId: string; secret: string; serviceId: string; corpNum: string; xDate: string; forward: string | null }) {
  const uri = `/${o.serviceId}/Token`;
  const body = JSON.stringify({ access_id: o.corpNum, scope: ["member", "140"] });
  const bodyDigest = createHash("sha256").update(body).digest("base64");
  const target = `POST\n${bodyDigest}\n${o.xDate}\n${o.forward ? `${o.forward}\n` : ""}${API_VERSION}\n${uri}`;
  const signature = createHmac("sha256", Buffer.from(o.secret, "base64")).update(target).digest("base64");
  const headers: Record<string, string> = {
    "x-lh-date": o.xDate,
    "x-lh-version": API_VERSION,
    Authorization: `LINKHUB ${o.linkId} ${signature}`,
    "Content-Type": "Application/json",
  };
  if (o.forward) headers["x-lh-forwarded"] = o.forward;
  return { uri, body, headers };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { code: `http_${res.status}`, message: text.slice(0, 200) };
  }
}

async function token(corpNum: string): Promise<string> {
  const c = cfg();
  const key = `${c.serviceId}:${corpNum}`;
  const cached = tokens.get(key);
  if (cached && Date.parse(cached.expiration) - 60_000 > Date.now()) return cached.session_token;
  const req = linkhubTokenRequest({ linkId: c.linkId, secret: c.secret, serviceId: c.serviceId, corpNum, xDate: new Date().toISOString(), forward: c.forward });
  const res = await fetch(`${AUTH_HOST}${req.uri}`, { method: "POST", headers: req.headers, body: req.body });
  const j = await readJson(res);
  if (!res.ok || typeof j.session_token !== "string") throw new ProviderError(`팝빌 인증 실패: ${String(j.message ?? res.status)}`, String(j.code ?? res.status));
  tokens.set(key, { session_token: j.session_token, expiration: String(j.expiration) });
  return j.session_token;
}

async function call(corpNum: string, path: string, init: { method: "GET" | "POST"; override?: string; body?: unknown }) {
  const c = cfg();
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(corpNum)}`, "Content-Type": "application/json;charset=utf-8" };
  if (init.override) headers["X-HTTP-Method-Override"] = init.override;
  const body = init.body === undefined ? undefined : JSON.stringify(init.body, (_k, v) => (v === null || v === "" || v === undefined ? undefined : v));
  const res = await fetch(`${c.apiHost}${path}`, { method: init.method, headers, body });
  const j = await readJson(res);
  return { ok: res.ok, status: res.status, json: j };
}

const USAGE = { income: "소득공제용", expense: "지출증빙용" } as const;

export function popbillProvider(): CashReceiptProvider {
  return {
    id: "popbill",
    async issue(input: IssueInput) {
      const cashbill = {
        mgtKey: input.mgtKey,
        tradeType: "승인거래",
        tradeUsage: USAGE[input.usage],
        tradeOpt: "일반",
        taxationType: input.taxation === "exempt" ? "비과세" : "과세",
        totalAmount: String(input.total),
        supplyCost: String(input.supply),
        tax: String(input.tax),
        serviceFee: "0",
        franchiseCorpNum: input.corpNum,
        franchiseCorpName: input.franchise?.name,
        franchiseCEOName: input.franchise?.ceo,
        franchiseAddr: input.franchise?.addr,
        franchiseTEL: input.franchise?.tel,
        identityNum: input.identityNum,
        customerName: input.customerName?.slice(0, 70),
        itemName: input.itemName.slice(0, 70),
        orderNumber: input.orderNumber,
        smssendYN: false,
      };
      const r = await call(input.corpNum, "/Cashbill", { method: "POST", override: "ISSUE", body: cashbill });
      if (r.ok && typeof r.json.confirmNum === "string") {
        return { confirmNum: r.json.confirmNum, tradeDate: String(r.json.tradeDate ?? input.tradeDate), raw: r.json };
      }
      const code = String(r.json.code ?? r.status);
      const message = String(r.json.message ?? "발행 실패");
      // 응답 오류라도 같은 문서번호가 이미 발행돼 있으면(재시도·중복) 발행된 것으로 본다
      const look = await this.lookup(input.corpNum, input.mgtKey).catch(() => ({ state: "other" as const, raw: null }));
      if (look.state === "issued") return { confirmNum: look.confirmNum, tradeDate: look.tradeDate, raw: look.raw };
      throw new ProviderError(`${message} (${code})`, code, false);
    },
    async lookup(corpNum: string, mgtKey: string): Promise<LookupResult> {
      const r = await call(corpNum, `/Cashbill/${encodeURIComponent(mgtKey)}`, { method: "GET" });
      if (r.ok && r.json.confirmNum) {
        const state = Number(r.json.stateCode ?? 0);
        if (state >= 300) return { state: "issued", confirmNum: String(r.json.confirmNum), tradeDate: String(r.json.tradeDate ?? ""), raw: r.json };
        return { state: "other", raw: r.json };
      }
      if (String(r.json.code) === "-14000003") return { state: "not_found" };
      return { state: "other", raw: r.json };
    },
  };
}
