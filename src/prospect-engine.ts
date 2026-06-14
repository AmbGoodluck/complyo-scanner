// prospect-engine.ts
// Reads prospects with status 'new' from Supabase, scans each site with the
// existing scanner, writes the real findings AND a personalized help-first
// email draft back to the row. You review/send from the add-prospect page,
// which opens Gmail prefilled. Nothing sends automatically.
//
// Run by the GitHub Action prospect-engine.yml (cron + manual).
//
// Env (GitHub Actions secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   BUSINESS_URL   e.g.  https://getcompli.com   (for cross-checking; optional)
//   REPLY_TO       e.g.  osman@complyohq.com     (optional, shown in signature)

import { chromium, Browser } from "playwright";
import { scanUrl } from "./scan.js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  BUSINESS_URL = "https://getcompli.com",
  REPLY_TO,
} = process.env as Record<string, string>;

function need(name: string, v?: string): string {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const FRIENDLY: Record<string, string> = {
  "image-alt": "images that screen readers can't describe (missing alt text)",
  "label": "form fields without labels, which are hard to use with a screen reader",
  "color-contrast": "text with low color contrast that's hard to read",
  "link-name": "links with no readable text",
  "button-name": "buttons without accessible names",
  "region": "missing page landmarks that help with navigation",
  "heading-order": "headings that are out of order",
  "document-title": "a missing or unclear page title",
  "html-has-lang": "the page language not being set",
  "aria-required-attr": "invalid ARIA attributes",
  "duplicate-id": "duplicate element IDs",
  "list": "improperly structured lists",
};
function friendly(issue: any): string {
  return FRIENDLY[issue.id] || issue.help || issue.id;
}

async function sbGet(path: string) {
  const res = await fetch(`${need("SUPABASE_URL", SUPABASE_URL)}/rest/v1/${path}`, {
    headers: {
      apikey: need("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY),
      authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`supabase GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPatch(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/prospects?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`supabase PATCH ${res.status}: ${await res.text()}`);
}

function draftEmail(p: any, report: any) {
  const name = p.contact_name ? p.contact_name.split(" ")[0] : "there";
  const biz = p.business_name || "your restaurant";
  const issues = (report.topIssues || []).slice(0, 3).map(friendly);
  const lead = issues[0] || "a few accessibility issues";
  const more = issues.length > 1 ? " There were a couple of other similar things too." : "";
  const place = p.city || "NYC";

  const subject = `quick note about ${biz}'s website`;
  const body =
`Hi ${name},

I'm Osman - I run Complyo, a small service that checks restaurant websites for accessibility issues (the kind that make a site hard to use for people with disabilities).

I happened to run ${biz}'s site through our checker and noticed ${lead}.${more}

I mention it because these are also the issues most commonly cited in the ADA website demand letters that have been reaching ${place} restaurants - so addressing them protects you as much as it helps your guests.

I put together a free report for ${biz} showing exactly what I found. Want me to send it over? No cost, no obligation. You're welcome to look us up at ${BUSINESS_URL}.

Either way, wishing you a great service.

Osman
Complyo - ${BUSINESS_URL}${REPLY_TO ? `\nReply to: ${REPLY_TO}` : ""}`;

  return { subject, body };
}

async function main() {
  const prospects: any[] = await sbGet("prospects?status=eq.new&select=*&order=created_at.asc");
  if (!prospects.length) { console.log("No new prospects to process."); return; }
  console.log(`Processing ${prospects.length} prospect(s)...`);

  const browser: Browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    for (const p of prospects) {
      try {
        console.log(`Scanning ${p.website_url} ...`);
        const report = await scanUrl(p.website_url, browser);
        if (!report.ok) {
          await sbPatch(p.id, { status: "error", error_message: report.error || "scan failed" });
          console.log(`  scan failed: ${report.error}`);
          continue;
        }
        const topIssues = (report.topIssues || []).slice(0, 4).map((it: any) => ({
          id: it.id, label: friendly(it), impact: it.impact,
          description: it.description || it.help || "", helpUrl: it.helpUrl || "",
        }));
        const { subject, body } = draftEmail(p, report);

        await sbPatch(p.id, {
          score: report.score,
          grade: report.grade,
          counts: report.counts,
          top_issues: topIssues,
          draft_subject: subject,
          draft_body: body,
          status: "drafted",
          error_message: null,
        });
        console.log(`  drafted (grade ${report.grade}, score ${report.score})`);
      } catch (e: any) {
        await sbPatch(p.id, { status: "error", error_message: String(e?.message || e) });
        console.log(`  error: ${e?.message || e}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log("Done. Open the prospect page to review and send drafts.");
}

main().catch((e) => { console.error(e); process.exit(1); });
