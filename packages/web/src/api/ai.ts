// Shared AI client using Runable AI Gateway (OpenAI-compatible)
export async function aiChat(
  env: { AI_GATEWAY_BASE_URL: string; AI_GATEWAY_API_KEY: string },
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { json?: boolean; model?: string } = {}
): Promise<string> {
  const baseUrl = env.AI_GATEWAY_BASE_URL;
  const apiKey = env.AI_GATEWAY_API_KEY;
  const model = opts.model || "gpt-4o-mini";

  const body: any = {
    model,
    messages,
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI error ${res.status}: ${err}`);
  }

  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
