/** Teams 워크플로(Power Automate) 웹훅으로 Adaptive Card 보내기. Office 365 커넥터 방식은 종료되어 워크플로 웹훅만 지원한다. */
export type TeamsCard = {
  title: string;
  facts?: { name: string; value: string }[];
  text?: string;
  link?: { title: string; url: string };
};

export async function sendTeamsCard(webhookUrl: string, card: TeamsCard): Promise<void> {
  const body = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body: [
            { type: "TextBlock", text: card.title, weight: "Bolder", size: "Medium", wrap: true },
            ...(card.facts?.length ? [{ type: "FactSet", facts: card.facts.map((f) => ({ title: f.name, value: f.value || "-" })) }] : []),
            ...(card.text ? [{ type: "TextBlock", text: card.text, wrap: true }] : []),
          ],
          actions: card.link ? [{ type: "Action.OpenUrl", title: card.link.title, url: card.link.url }] : [],
        },
      },
    ],
  };
  const res = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Teams webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
