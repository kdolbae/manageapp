import { createPublicKey, verify as verifySig, type JsonWebKey } from "node:crypto";

/**
 * Teams 봇(Bot Framework) 최소 구현: SDK 없이 들어오는 요청의 JWT 를 확인하고, 커넥터로 답장을 보낸다.
 * 환경변수: TEAMS_BOT_APP_ID, TEAMS_BOT_APP_PASSWORD(클라이언트 비밀), TEAMS_BOT_TENANT_ID(단일 테넌트 봇의 Entra 테넌트)
 */
export type Activity = {
  type: string;
  id?: string;
  timestamp?: string;
  serviceUrl: string;
  channelId?: string;
  from?: { id: string; name?: string; aadObjectId?: string };
  recipient?: { id: string; name?: string };
  conversation: { id: string; conversationType?: string; name?: string; tenantId?: string; isGroup?: boolean };
  text?: string;
  textFormat?: string;
  membersAdded?: { id: string; name?: string }[];
  channelData?: { tenant?: { id?: string }; team?: { id?: string; name?: string }; channel?: { id?: string; name?: string } };
  replyToId?: string;
};

export function botConfig() {
  const appId = process.env.TEAMS_BOT_APP_ID;
  const password = process.env.TEAMS_BOT_APP_PASSWORD;
  const tenantId = process.env.TEAMS_BOT_TENANT_ID;
  if (!appId || !password || !tenantId) return null;
  return { appId, password, tenantId };
}

// ---- 들어오는 요청 확인 -------------------------------------------------------
const OPENID_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";
const ISSUER = "https://api.botframework.com";
type Jwk = JsonWebKey & { kid?: string; endorsements?: string[] };
let jwksCache: { keys: Jwk[]; at: number } | null = null;

async function getKeys(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < 12 * 3600_000) return jwksCache.keys;
  const meta = (await (await fetch(OPENID_URL)).json()) as { jwks_uri: string };
  const jwks = (await (await fetch(meta.jwks_uri)).json()) as { keys: Jwk[] };
  jwksCache = { keys: jwks.keys, at: Date.now() };
  return jwks.keys;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Authorization: Bearer <jwt> 가 Bot Framework 가 서명한 이 봇 앞 토큰인지 확인한다. */
export async function verifyBotRequest(authHeader: string | null, activity: Activity, appId: string): Promise<boolean> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let header: { kid?: string; alg?: string };
  let claims: { iss?: string; aud?: string; exp?: number; nbf?: number; serviceurl?: string; serviceUrl?: string };
  try {
    header = JSON.parse(b64url(parts[0]).toString("utf8"));
    claims = JSON.parse(b64url(parts[1]).toString("utf8"));
  } catch {
    return false;
  }
  if (header.alg !== "RS256" || !header.kid) return false;
  let keys = await getKeys();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getKeys(true); // 키 교체 직후
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return false;
  if (jwk.endorsements && activity.channelId && !jwk.endorsements.includes(activity.channelId)) return false;
  const ok = verifySig("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64url(parts[2]));
  if (!ok) return false;
  const now = Math.floor(Date.now() / 1000);
  const skew = 300;
  if (claims.iss !== ISSUER || claims.aud !== appId) return false;
  if (!claims.exp || claims.exp + skew < now) return false;
  if (claims.nbf && claims.nbf - skew > now) return false;
  const su = claims.serviceurl ?? claims.serviceUrl;
  if (su && su.replace(/\/$/, "") !== activity.serviceUrl.replace(/\/$/, "")) return false;
  return true;
}

// ---- 답장 보내기 --------------------------------------------------------------
let tokenCache: { token: string; exp: number } | null = null;

async function connectorToken(cfg: { appId: string; password: string; tenantId: string }): Promise<string> {
  if (tokenCache && tokenCache.exp - 120_000 > Date.now()) return tokenCache.token;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.appId, client_secret: cfg.password, scope: "https://api.botframework.com/.default" }),
  });
  if (!res.ok) throw new Error(`bot token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export type OutgoingMessage = { text: string; imageUrl?: string; imageAlt?: string; facts?: { title: string; value: string }[] };

/** 같은 대화에 메시지(텍스트 + 선택: 영수증 이미지 카드)를 보낸다. replyTo 가 있으면 그 메시지에 대한 답장으로. */
export async function sendToConversation(activity: Pick<Activity, "serviceUrl" | "conversation" | "id">, msg: OutgoingMessage, opts: { replyTo?: boolean } = {}) {
  const cfg = botConfig();
  if (!cfg) throw new Error("teams bot not configured");
  const token = await connectorToken(cfg);
  const base = activity.serviceUrl.replace(/\/$/, "");
  const conv = encodeURIComponent(activity.conversation.id);
  const url = opts.replyTo && activity.id ? `${base}/v3/conversations/${conv}/activities/${encodeURIComponent(activity.id)}` : `${base}/v3/conversations/${conv}/activities`;
  const body: Record<string, unknown> = { type: "message", text: msg.text, textFormat: "plain" };
  if (opts.replyTo && activity.id) body.replyToId = activity.id;
  if (msg.imageUrl) {
    body.attachments = [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            ...(msg.facts?.length ? [{ type: "FactSet", facts: msg.facts }] : []),
            { type: "Image", url: msg.imageUrl, altText: msg.imageAlt ?? "현금영수증", size: "Stretch", selectAction: { type: "Action.OpenUrl", url: msg.imageUrl } },
          ],
          actions: [{ type: "Action.OpenUrl", title: "영수증 이미지 열기", url: msg.imageUrl }],
        },
      },
    ];
  }
  const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`bot send ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** 채널 스레드 id(…;messageid=123)는 채널 자체 id 로 묶는다. */
export function baseConversationId(id: string): string {
  return id.split(";messageid=")[0];
}
