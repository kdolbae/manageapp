import { ImageResponse } from "next/og";
import { requireTenant } from "@/lib/auth/session";
import { siteOrigin } from "@/lib/origin";
import { zip } from "@/lib/zip";

/**
 * Teams 앱 패키지(.zip): manifest.json + 아이콘 2개. 채팅방 ••• > 앱 관리 > 사용자 지정 앱 업로드 로 올린다.
 * 봇 id 만 들어가고 비밀값은 없다. RSC 권한(ChatMessage.Read.Chat, ChannelMessage.Read.Group)으로 @멘션 없이도 메시지를 받는다.
 */
export const runtime = "nodejs";

async function icon(size: number, outline: boolean): Promise<Buffer> {
  const img = new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: outline ? "transparent" : "#2563eb", borderRadius: outline ? 0 : size * 0.18 }}>
        <div style={{ display: "flex", fontSize: size * 0.56, fontWeight: 700, color: "#ffffff", fontFamily: "sans-serif" }}>J</div>
      </div>
    ),
    { width: size, height: size },
  );
  return Buffer.from(await img.arrayBuffer());
}

export async function GET() {
  const session = await requireTenant();
  if (!session.can("tenant.manage")) return new Response("forbidden", { status: 403 });
  const appId = process.env.TEAMS_BOT_APP_ID;
  if (!appId) return new Response("TEAMS_BOT_APP_ID not set", { status: 503 });
  const origin = await siteOrigin();
  const host = new URL(origin).host;
  const manifest = {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id: appId,
    developer: { name: session.current.tenant.name, websiteUrl: origin, privacyUrl: origin, termsOfUseUrl: origin },
    name: { short: "집대리", full: "집대리 업무 봇" },
    description: {
      short: "현금영수증 요청을 읽고 자동으로 발행합니다",
      full: "연결된 채팅방에 현장주소·계약자명·계약자연락처와 '현금영수증 신청합니다'가 올라오면 집대리 계약 원장에서 계약을 찾아 현금영수증을 발행하고 영수증 이미지를 같은 채팅방에 올립니다.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#2563EB",
    bots: [{ botId: appId, scopes: ["team", "groupChat", "personal"], supportsFiles: false, isNotificationOnly: false }],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [host],
    webApplicationInfo: { id: appId, resource: `api://${host}/${appId}` },
    authorization: {
      permissions: {
        resourceSpecific: [
          { type: "Application", name: "ChatMessage.Read.Chat" },
          { type: "Application", name: "ChannelMessage.Read.Group" },
        ],
      },
    },
  };
  const [color, outline] = await Promise.all([icon(192, false), icon(32, true)]);
  const body = zip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "color.png", data: color },
    { name: "outline.png", data: outline },
  ]);
  return new Response(new Uint8Array(body), {
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="jipdaeri-teams-app.zip"', "cache-control": "no-store" },
  });
}
