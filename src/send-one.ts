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
} = process.env as Record<string, string>;

function need(name: string, val: string | undefined): string {
  if (!val) throw new Error(`Missing env ${name}`);
  return val;
}

const GRADE_COLOR: Record<string, string> = {
  A: "#16a34a", B: "#65a30d", C: "#ca8a04", D: "#ea580c", F: "#dc2626",
};

function emailHtml(host: string, score: number, grade: string): string {
  const color = GRADE_COLOR[grade] || "#ea580c";
  return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#0e2a47;padding:20px 24px;border-radius:14px 14px 0 0">
      <span style="color:#fff;font-size:18px;font-weight:bold">✓ Complyo</span>
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
    <p style="font-size:11px;color:#8a96a3;text-align:center;margin-top:16px">Complyo · getcompli.com · Informational risk assessment, not legal advice.</p>
  </div>`;
}

async function sendEmail(to: string, host: string, score: number, grade: string, pdf: Buffer) {
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
      subject: `Your accessibility report for ${host} is ready (${grade}, ${score}/100)`,
      html: emailHtml(host, score, grade),
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
    await sendEmail(email, host, report.score, report.grade, pdf);
    console.log(`Sent immediate report to ${email} for ${host} (${report.grade} ${report.score})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
