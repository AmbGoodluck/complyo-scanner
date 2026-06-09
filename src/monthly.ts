// Monthly customer loop. Pulls active subscribers from Supabase, re-scans each
// site, renders the branded PDF, emails it via Resend, and updates the record.
// Runs on a schedule via .github/workflows/monthly.yml (or any cron host).
//
// Required env:
//   SUPABASE_URL          https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key
//   RESEND_API_KEY        from resend.com
//   FROM_EMAIL            e.g. "Complyo <reports@getcompli.com>"  (domain must be verified in Resend)
// Optional:
//   REPLY_TO              e.g. support@getcompli.com

import { chromium } from "playwright";
import { scanUrl } from "./scan.js";
import { renderReportPdf } from "./report.js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  RESEND_API_KEY,
  FROM_EMAIL,
  REPLY_TO,
} = process.env as Record<string, string>;

interface Subscriber {
  id: string;
  email: string;
  website_url: string | null;
  status: string;
}

function need(name: string, val: string | undefined): string {
  if (!val) throw new Error(`Missing env ${name}`);
  return val;
}

async function getDueSubscribers(): Promise<Subscriber[]> {
  // Only subscribers whose report day matches today (UTC). Run daily so each
  // customer is reported on their own signup day-of-month.
  const day = new Date().getUTCDate();
  const url = `${need("SUPABASE_URL", SUPABASE_URL)}/rest/v1/subscribers?status=eq.active&website_url=not.is.null&report_day=eq.${day}&select=id,email,website_url,status`;
  const res = await fetch(url, {
    headers: {
      apikey: need("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY),
      authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`supabase fetch ${res.status}: ${await res.text()}`);
  return (await res.json()) as Subscriber[];
}

async function updateSubscriber(id: string, score: number, grade: string) {
  const url = `${SUPABASE_URL}/rest/v1/subscribers?id=eq.${id}`;
  await fetch(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      last_scanned_at: new Date().toISOString(),
      last_score: score,
      last_grade: grade,
    }),
  });
}

const GRADE_COLOR: Record<string, string> = {
  A: "#16a34a", B: "#65a30d", C: "#ca8a04", D: "#ea580c", F: "#dc2626",
};

function emailHtml(host: string, score: number, grade: string): string {
  const color = GRADE_COLOR[grade] || "#ea580c";
  return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#0e2a47;padding:18px 24px;border-radius:14px 14px 0 0">
      <span style="color:#fff;font-size:18px;font-weight:bold">✓ Complyo</span>
    </div>
    <div style="border:1px solid #e6e8ec;border-top:none;border-radius:0 0 14px 14px;padding:26px 24px;color:#1f2a37">
      <p style="font-size:15px;margin:0 0 14px">Your monthly accessibility report for <b>${host}</b> is attached.</p>
      <div style="display:flex;align-items:center;gap:16px;background:#fbfaf8;border:1px solid #e6e8ec;border-radius:12px;padding:16px;margin:0 0 18px">
        <div style="width:60px;height:60px;border-radius:12px;background:${color};color:#fff;font-size:30px;font-weight:bold;text-align:center;line-height:60px">${grade}</div>
        <div><div style="font-size:24px;font-weight:bold;color:#0e2a47">${score}<span style="font-size:14px;color:#5b6b7b">/100</span></div>
        <div style="font-size:13px;color:#5b6b7b">This month's accessibility score</div></div>
      </div>
      <p style="font-size:14px;color:#5b6b7b;margin:0 0 6px">The full breakdown, including what changed and how to fix each issue, is in the attached PDF.</p>
      <p style="font-size:14px;color:#5b6b7b;margin:0">Questions? Just reply to this email.</p>
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
      subject: `Your monthly accessibility report — ${host} (${grade}, ${score}/100)`,
      html: emailHtml(host, score, grade),
      attachments: [
        { filename: "complyo-accessibility-report.pdf", content: pdf.toString("base64") },
      ],
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

async function main() {
  const subs = await getDueSubscribers();
  console.log(`Found ${subs.length} subscriber(s) due for a report today.`);
  if (!subs.length) return;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let ok = 0, failed = 0;
  for (const s of subs) {
    const site = s.website_url as string;
    const host = site.replace(/^https?:\/\//, "").replace(/\/$/, "");
    try {
      const report = await scanUrl(site, browser);
      if (!report.ok) throw new Error(report.error || "scan failed");
      const pdf = await renderReportPdf(browser, report, {});
      await sendEmail(s.email, host, report.score, report.grade, pdf);
      await updateSubscriber(s.id, report.score, report.grade);
      console.log(`  ✓ ${s.email} <- ${host} (${report.grade} ${report.score})`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${s.email} <- ${host}: ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }

  await browser.close();
  console.log(`Done. ${ok} sent, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
