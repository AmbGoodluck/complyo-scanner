// Sends ONE subscriber their report immediately after they subscribe.
// Triggered by the Polar webhook via GitHub repository_dispatch. Scans the site
// they just paid to monitor, builds the branded PDF, and emails it from
// reports@getcompli.com with a welcome note.
//
// Env (passed by the workflow):
//   RESEND_API_KEY, FROM_EMAIL, REPLY_TO (optional)
//   SUBSCRIBER_EMAIL, SUBSCRIBER_WEBSITE

import { chromium } from "playwright";
import { scanUrl } from "./scan.js";
import { renderReportPdf } from "./report.js";

const {
  RESEND_API_KEY,
  FROM_EMAIL,
  REPLY_TO,
  SUBSCRIBER_EMAIL,
  SUBSCRIBER_WEBSITE,
  IS_PROSPECT,          // "true" when sending to a not-yet-subscribed prospect
  CHECKOUT_URL,         // subscribe link to put in the prospect CTA
} = process.env as Record<string, string>;

const isProspect = (IS_PROSPECT || "").toLowerCase() === "true";
const baseCheckout = CHECKOUT_URL || "https://getcompli.com";

// For prospect sends, tag the checkout link so the webhook knows this customer
// already received their report (and must NOT be sent a duplicate on subscribe).
// Encoded as reference_id=<website>||prospect.
function prospectCheckoutUrl(website) {
  if (!isProspect) return baseCheckout;
  const sep = baseCheckout.indexOf("?") === -1 ? "?" : "&";
  return baseCheckout + sep + "reference_id=" + encodeURIComponent(website + "||prospect");
}

function need(name: string, val: string | undefined): string {
  if (!val) throw new Error(`Missing env ${name}`);
  return val;
}

const GRADE_COLOR: Record<string, string> = {
  A: "#16a34a", B: "#65a30d", C: "#ca8a04", D: "#ea580c", F: "#dc2626",
};

// Plain-English issue names so the email reads human, not technical.
const FRIENDLY: Record<string, string> = {
  "image-alt": "images your menu and photos rely on can't be read by screen readers",
  "label": "form fields (like your reservation or contact form) aren't labeled for assistive tech",
  "color-contrast": "some text is low-contrast and hard to read for low-vision guests",
  "link-name": "links that screen readers announce as just \u201clink,\u201d with no destination",
  "button-name": "buttons (like \u201corder\u201d or \u201creserve\u201d) have no accessible name",
  "region": "the page is missing the landmarks screen-reader users rely on to navigate",
  "heading-order": "headings are out of order, which makes the page confusing to navigate by screen reader",
  "document-title": "the page is missing a clear title",
  "html-has-lang": "the page doesn't declare its language, so screen readers can mispronounce it",
};
function friendlyIssue(it: any): string {
  if (!it) return "";
  return FRIENDLY[it.id] || it.help || it.id;
}

function emailHtml(host: string, score: number, grade: string, topIssue?: any, issueCount?: number, fullWebsite?: string): string {
  const color = GRADE_COLOR[grade] || "#ea580c";
  const lead = friendlyIssue(topIssue);
  const countText = issueCount && issueCount > 1
    ? `We found <b>${issueCount} issues</b> worth attention` 
    : `We found a few issues worth attention`;

  if (isProspect) {
    // Help-first, founder-to-owner, trust-building sales psychology:
    // specific finding (credibility) -> calm real-world stakes (loss framing,
    // no fear) -> the free work already done (reciprocity) -> low-friction offer
    // (risk reversal) -> one clear next step.
    return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2a37">
      <div style="background:#0e2a47;padding:20px 24px;border-radius:14px 14px 0 0">
        <span style="color:#fff;font-size:18px;font-weight:bold">&#10003; Complyo</span>
      </div>
      <div style="border:1px solid #e6e8ec;border-top:none;border-radius:0 0 14px 14px;padding:28px 24px">
        <p style="font-size:16px;margin:0 0 14px">Hi, and thanks for the reply.</p>
        <p style="font-size:15px;line-height:1.55;margin:0 0 16px">As promised, your full accessibility report for <b>${host}</b> is attached. I went through your site the same way a screen reader or an assistive device would, and scored it against the WCAG 2.1 AA standard that ADA cases reference.</p>

        <div style="display:flex;align-items:center;gap:16px;background:#fbfaf8;border:1px solid #e6e8ec;border-radius:12px;padding:16px;margin:0 0 18px">
          <div style="width:60px;height:60px;border-radius:12px;background:${color};color:#fff;font-size:30px;font-weight:bold;text-align:center;line-height:60px">${grade}</div>
          <div><div style="font-size:24px;font-weight:bold;color:#0e2a47">${score}<span style="font-size:14px;color:#5b6b7b">/100</span></div>
          <div style="font-size:13px;color:#5b6b7b">${countText}</div></div>
        </div>

        ${lead ? `<p style="font-size:15px;line-height:1.55;margin:0 0 16px">The one I'd look at first: <b>${lead}</b>. The full report walks through each issue, who it affects, and exactly how to fix it, with links so you (or your web person) can verify every one.</p>` : `<p style="font-size:15px;line-height:1.55;margin:0 0 16px">The full report walks through each issue, who it affects, and exactly how to fix it, with links so you can verify every one.</p>`}

        <p style="font-size:15px;line-height:1.55;margin:0 0 16px">Here's the honest part: fixing these once is good, but websites change. A new menu PDF, a new plugin, a new photo, and issues quietly creep back, which is exactly what the demand letters hitting NYC restaurants tend to catch.</p>

        <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;padding:20px;margin:18px 0">
          <p style="font-size:16px;font-weight:bold;color:#0e2a47;margin:0 0 8px">That's what I built Complyo to handle.</p>
          <p style="font-size:14px;line-height:1.55;color:#0f3b36;margin:0 0 16px">For <b>$24.99/month</b>, I re-check ${host} every month and email you a fresh report the moment something changes, so you're never caught off guard. No contract, cancel anytime, and you'll always know exactly where your site stands. It's a small amount of peace of mind against an ADA demand letter that could cost thousands.</p>
          <a href="${prospectCheckoutUrl(fullWebsite || host)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:10px">Keep ${host} monitored &rarr;</a>
        </div>

        <p style="font-size:15px;line-height:1.55;margin:14px 0 0">And truly, no pressure, the report is yours to keep either way. If anything in it raises a question, just reply, I read every email myself.</p>
        <p style="font-size:15px;margin:18px 0 0">Osman<br><span style="color:#5b6b7b;font-size:13px">Founder, Complyo</span></p>
      </div>
      <p style="font-size:11px;color:#8a96a3;text-align:center;margin-top:16px">Complyo &middot; getcompli.com &middot; Informational risk assessment, not legal advice.</p>
    </div>`;
  }

  // Subscriber / monthly version: no sales pitch, they already pay.
  return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#0e2a47;padding:20px 24px;border-radius:14px 14px 0 0">
      <span style="color:#fff;font-size:18px;font-weight:bold">&#10003; Complyo</span>
    </div>
    <div style="border:1px solid #e6e8ec;border-top:none;border-radius:0 0 14px 14px;padding:28px 24px;color:#1f2a37">
      <p style="font-size:16px;margin:0 0 6px;font-weight:bold;color:#0e2a47">Welcome aboard, and thank you.</p>
      <p style="font-size:15px;margin:0 0 18px">Here is the full accessibility report for <b>${host}</b> that you just unlocked. It is attached as a PDF.</p>
      <div style="display:flex;align-items:center;gap:16px;background:#fbfaf8;border:1px solid #e6e8ec;border-radius:12px;padding:16px;margin:0 0 18px">
        <div style="width:60px;height:60px;border-radius:12px;background:${color};color:#fff;font-size:30px;font-weight:bold;text-align:center;line-height:60px">${grade}</div>
        <div><div style="font-size:24px;font-weight:bold;color:#0e2a47">${score}<span style="font-size:14px;color:#5b6b7b">/100</span></div>
        <div style="font-size:13px;color:#5b6b7b">Your accessibility score</div></div>
      </div>
      <p style="font-size:14px;color:#5b6b7b;margin:0 0 6px">The attached report shows every issue we found, who it affects, and exactly how to fix it, with links so you can verify each one.</p>
      <p style="font-size:14px;color:#5b6b7b;margin:0 0 6px">From here, we re-check your site every month and email you a fresh report on your monthly date, alerting you if anything changes.</p>
      <p style="font-size:14px;color:#5b6b7b;margin:14px 0 0">Questions about anything in the report? Just reply to this email.</p>
    </div>
    <p style="font-size:11px;color:#8a96a3;text-align:center;margin-top:16px">Complyo &middot; getcompli.com &middot; Informational risk assessment, not legal advice.</p>
  </div>`;
}

async function sendEmail(to: string, host: string, score: number, grade: string, pdf: Buffer, topIssue?: any, issueCount?: number, fullWebsite?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${need("RESEND_API_KEY", RESEND_API_KEY)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: need("FROM_EMAIL", FROM_EMAIL),
      to: [to],
      ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
      subject: isProspect
        ? `The accessibility report for ${host} you asked for (${grade}, ${score}/100)`
        : `Your accessibility report for ${host} is ready (${grade}, ${score}/100)`,
      html: emailHtml(host, score, grade, topIssue, issueCount, fullWebsite),
      attachments: [
        { filename: "complyo-accessibility-report.pdf", content: pdf.toString("base64") },
      ],
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

async function main() {
  const email = need("SUBSCRIBER_EMAIL", SUBSCRIBER_EMAIL);
  const website = need("SUBSCRIBER_WEBSITE", SUBSCRIBER_WEBSITE);
  const host = website.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const report = await scanUrl(website, browser);
    if (!report.ok) throw new Error(report.error || "scan failed");
    const pdf = await renderReportPdf(browser, report, {});
    const topIssue = (report.topIssues && report.topIssues[0]) || null;
    const issueCount = report.counts
      ? (report.counts.critical + report.counts.serious + report.counts.moderate + report.counts.minor)
      : undefined;
    await sendEmail(email, host, report.score, report.grade, pdf, topIssue, issueCount, website);
    console.log(`Sent immediate report to ${email} for ${host} (${report.grade} ${report.score})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
