import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { botConfig, verifyBotRequest, sendToConversation, baseConversationId, type Activity } from "@/lib/teams/bot";
import { handleCashReceiptMessage } from "@/lib/cash-receipt/process";
import { parseCashReceiptAsk, plainText } from "@/lib/cash-receipt/parse";
import { won } from "@/lib/format";

/**
 * Teams 봇 메시지 받는 곳 (Bot Framework messaging endpoint).
 *  - 봇이 채팅방에 추가되면 연결 방법을 안내한다.
 *  - "집대리 연결 ABCD1234" → 연동 설정에서 받은 코드로 이 채팅방을 사업체에 연결.
 *  - 연결된 채팅방의 "현금영수증 신청" 메시지 → 계약을 찾아 발행하고 같은 채팅방에 영수증 이미지를 보낸다.
 * 처리는 응답 뒤(after)에 해서 Teams 가 기다리다 재전송하지 않게 한다. 같은 메시지 재전송은 DB 가 한 번만 받는다.
 */
export async function POST(request: Request) {
  const cfg = botConfig();
  if (!cfg) return NextResponse.json({ error: "teams bot not configured" }, { status: 503 });
  let activity: Activity & { entities?: { type: string; mentioned?: { id: string } }[] };
  try {
    activity = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!activity?.serviceUrl || !activity.conversation?.id) return NextResponse.json({ error: "invalid activity" }, { status: 400 });
  if (!(await verifyBotRequest(request.headers.get("authorization"), activity, cfg.appId))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // 우리 회사 테넌트에서 온 것만 (단일 테넌트 봇)
  const aadTenant = activity.channelData?.tenant?.id ?? activity.conversation.tenantId;
  if (aadTenant && aadTenant !== cfg.tenantId) return new NextResponse(null, { status: 200 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured" }, { status: 503 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  const convId = baseConversationId(activity.conversation.id);

  if (activity.type === "conversationUpdate") {
    const botAdded = activity.membersAdded?.some((m) => m.id === activity.recipient?.id);
    if (botAdded) {
      after(() =>
        sendToConversation(activity, {
          text: "집대리 봇이 들어왔어요. 이 채팅방을 연결하려면 집대리 > 설정 > 연동에서 '채팅방 연결 코드'를 받아 여기에 '집대리 연결 코드' 형식으로 보내 주세요. 연결되면 '현금영수증 신청합니다' 메시지를 보고 자동으로 발행합니다.",
        }).catch((e) => console.error("teams welcome", e)),
      );
    }
    return new NextResponse(null, { status: 200 });
  }
  if (activity.type !== "message" || !activity.text) return new NextResponse(null, { status: 200 });

  const text = plainText(activity.text).trim();
  const mentioned = activity.entities?.some((e) => e.type === "mention" && e.mentioned?.id === activity.recipient?.id) ?? false;

  // 1) 채팅방 연결
  const link = text.match(/집대리\s*연결\s*([A-Za-z0-9]{8})\b/);
  if (link) {
    const convType = activity.conversation.conversationType === "channel" ? "channel" : activity.conversation.conversationType === "personal" ? "personal" : "groupChat";
    after(async () => {
      const { data: tid } = await admin.rpc("link_teams_conversation", {
        p_code: link[1],
        p: {
          conversation_id: convId, conv_type: convType, title: activity.conversation.name ?? activity.channelData?.channel?.name ?? null,
          service_url: activity.serviceUrl, aad_tenant_id: aadTenant ?? null, linked_by_name: activity.from?.name ?? null,
        },
      });
      await sendToConversation(activity, {
        text: tid
          ? "연결됐어요. 이제 이 채팅방에 현장주소·계약자명·계약자연락처와 '현금영수증 신청합니다'를 보내면 자동으로 발행해 영수증을 올려 드려요."
          : "연결 코드가 맞지 않거나 30분이 지났어요. 집대리 > 설정 > 연동에서 새 코드를 받아 주세요.",
      }, { replyTo: true }).catch((e) => console.error("teams link reply", e));
    });
    return new NextResponse(null, { status: 200 });
  }

  // 2) 연결된 채팅방인지
  const { data: conv } = await admin.from("teams_conversation").select("tenant_id, is_active, purposes").eq("conversation_id", convId).maybeSingle();
  const ask = parseCashReceiptAsk(text);
  if (!conv?.is_active || !(conv.purposes as string[]).includes("cash_receipt")) {
    if (ask.isRequest || mentioned) {
      after(() =>
        sendToConversation(activity, { text: "이 채팅방은 아직 집대리에 연결되지 않았어요. 집대리 > 설정 > 연동에서 '채팅방 연결 코드'를 받아 '집대리 연결 코드' 로 보내 주세요." }, { replyTo: true })
          .catch((e) => console.error("teams not linked", e)),
      );
    }
    return new NextResponse(null, { status: 200 });
  }
  if (!ask.isRequest) {
    if (mentioned) {
      after(() =>
        sendToConversation(activity, { text: "현금영수증을 발행하려면 현장주소·계약자명·계약자연락처 줄과 '현금영수증 신청합니다'를 함께 보내 주세요. 계약이 여러 건이면 '계약번호' 줄을, 일부만 발행하려면 '금액' 줄을 넣어 주세요." }, { replyTo: true })
          .catch((e) => console.error("teams help", e)),
      );
    }
    return new NextResponse(null, { status: 200 });
  }

  // 3) 현금영수증 요청 처리
  after(async () => {
    try {
      const out = await handleCashReceiptMessage(admin, {
        tenantId: conv.tenant_id as string, text, source: "teams", conversationId: convId, messageId: activity.id,
        senderName: activity.from?.name, senderRef: activity.from?.aadObjectId, siteUrl,
      });
      if (out.status === "ignored") return;
      await sendToConversation(activity, {
        text: out.message,
        imageUrl: out.imageUrl,
        imageAlt: "현금영수증",
        facts: out.receipt && out.imageUrl ? [
          { title: "금액", value: `${won(out.receipt.total_amount)}원` },
          { title: "승인번호", value: out.receipt.confirm_num ?? "-" },
        ] : undefined,
      }, { replyTo: true });
    } catch (e) {
      console.error("teams cash receipt", e);
      await sendToConversation(activity, { text: "현금영수증 처리 중 오류가 났어요. 집대리에서 확인해 주세요." }, { replyTo: true }).catch(() => {});
    }
  });
  return new NextResponse(null, { status: 200 });
}
