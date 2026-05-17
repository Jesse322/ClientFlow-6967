/**
 * Thin Resend wrapper — replaces @runablehq/website-runtime sendEmail.
 * Falls back gracefully; never throws to callers.
 */

const FROM = "ClientFlow <info@usiclienttracker.com>";
const REPLY_TO = "jesse.valentine@usi.com";

interface SendOptions {
  resendKey: string;
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(opts: SendOptions): Promise<{ ok: boolean; error?: string }> {
  const { resendKey, to, subject, html, replyTo } = opts;
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  const body: Record<string, unknown> = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    reply_to: replyTo || REPLY_TO,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { ok: false, error: `Resend ${res.status}: ${text}` };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Fire-and-forget wrapper — logs errors but never throws */
export async function sendEmailSilent(opts: SendOptions): Promise<void> {
  const result = await sendEmail(opts);
  if (!result.ok) console.error("[email] send failed:", result.error);
}
