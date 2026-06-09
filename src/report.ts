// Builds the branded Complyo PDF report from a real ScanReport, rendered with
// the Chromium the scanner already runs (page.pdf()). Reused by both the
// scanner /report endpoint and the monthly job.

import type { Browser } from "playwright";
import type { ScanReport, Impact } from "./types.js";

const GRADE_COLOR: Record<string, string> = {
  A: "#16a34a", B: "#65a30d", C: "#ca8a04", D: "#ea580c", F: "#dc2626",
};
const SEV_COLOR: Record<Impact, string> = {
  critical: "#dc2626", serious: "#ea580c", moderate: "#ca8a04", minor: "#65a30d",
};
const RISK_LABEL: Record<string, string> = {
  A: "Looking clean", B: "Minor issues", C: "Moderate issues",
  D: "Significant accessibility risk", F: "Severe accessibility risk",
};
const FRIENDLY: Record<string, string> = {
  "image-alt": "Images missing alternate text",
  "label": "Form fields without labels",
  "color-contrast": "Low text contrast",
  "link-name": "Links with no readable text",
  "button-name": "Buttons without accessible names",
  "region": "Missing page landmarks",
  "heading-order": "Headings out of order",
  "document-title": "Missing page title",
  "html-has-lang": "Page language not set",
  "aria-required-attr": "Invalid ARIA attributes",
  "duplicate-id": "Duplicate element IDs",
  "list": "Improperly structured lists",
};
const WCAG: Record<string, { sc: string; url: string }> = {
  "image-alt": { sc: "WCAG 1.1.1 Non-text Content", url: "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html" },
  "label": { sc: "WCAG 3.3.2 Labels or Instructions", url: "https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html" },
  "color-contrast": { sc: "WCAG 1.4.3 Contrast (Minimum)", url: "https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html" },
  "link-name": { sc: "WCAG 2.4.4 Link Purpose", url: "https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html" },
  "button-name": { sc: "WCAG 4.1.2 Name, Role, Value", url: "https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html" },
  "document-title": { sc: "WCAG 2.4.2 Page Titled", url: "https://www.w3.org/WAI/WCAG21/Understanding/page-titled.html" },
  "html-has-lang": { sc: "WCAG 3.1.1 Language of Page", url: "https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html" },
  "heading-order": { sc: "WCAG 1.3.1 Info and Relationships", url: "https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html" },
};

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function host(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function renderReportHtml(
  report: ScanReport,
  opts: { business?: string; date?: string } = {},
): string {
  const date = opts.date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const color = GRADE_COLOR[report.grade] || "#ea580c";
  const issues = report.topIssues.slice(0, 4);
  const issuesHtml = issues.length
    ? issues.map((it) => {
        const name = FRIENDLY[it.id] || it.help || it.id;
        const w = WCAG[it.id];
        const sev = it.impact.charAt(0).toUpperCase() + it.impact.slice(1);
        return `
        <div class="issue">
          <div class="head">
            <div class="nm">${esc(name)}</div>
            <span class="tag" style="background:${SEV_COLOR[it.impact] || "#ca8a04"}">${esc(sev)}</span>
          </div>
          <div class="grid2">
            <div class="col"><div class="mini">What it is</div><p>${esc(it.description || it.help || "")}</p></div>
            <div class="col"><div class="mini">Affected elements</div><p>${it.elementsAffected} on the page</p></div>
          </div>
          <div class="verify">Verify &amp; learn more:
            <a href="${esc(it.helpUrl)}">${esc(it.id)} rule</a>${w ? ` &middot; <a href="${esc(w.url)}">${esc(w.sc)}</a>` : ""}</div>
        </div>`;
      }).join("")
    : `<div class="issue"><div class="nm" style="color:#16a34a">No major issues found.</div>
        <p style="margin-top:6px;color:#5b6b7b">This site passed the automated checks for the rules tested. Complyo will keep monitoring it each month and alert you if anything changes.</p></div>`;

  const total = report.counts.critical + report.counts.serious + report.counts.moderate + report.counts.minor;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--ink:#0e2a47;--ink9:#081d33;--teal:#0d9488;--teal-soft:#e0f2f0;--paper:#fbfaf8;--border:#e6e8ec;--text:#1f2a37;--muted:#5b6b7b;
    --a:#16a34a;--c:#ca8a04;--d:#ea580c;--f:#dc2626;--font:"Hanken Grotesk",Arial,sans-serif;}
  @page{size:Letter;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--font);color:var(--text);font-size:11px;line-height:1.5}
  .page{width:8.5in;min-height:11in;page-break-after:always}
  .page:last-child{page-break-after:auto}
  .pad{padding:0 46px}
  .band{background:linear-gradient(150deg,var(--ink),var(--ink9));color:#fff;padding:26px 46px 24px}
  .lock{display:flex;align-items:center;gap:9px}
  .lock .w{font-size:20px;font-weight:700;letter-spacing:-.6px}
  .kicker{margin-top:16px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#9fc0d8;font-weight:600}
  .title{font-size:22px;font-weight:800;letter-spacing:-.5px;margin-top:3px}
  .meta{margin-top:14px;display:flex;gap:26px;font-size:11px;color:#cdddea}
  .meta b{color:#fff;font-weight:600}
  .hero{display:flex;align-items:center;gap:24px;margin-top:26px}
  .gradebox{width:104px;height:104px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:62px;font-weight:800;color:#fff;background:${color}}
  .num{font-size:38px;font-weight:800;color:var(--ink);line-height:1}
  .num span{font-size:18px;color:var(--muted);font-weight:600}
  .risk{font-size:15px;font-weight:700;color:${color};margin-top:5px}
  .sub{font-size:11.5px;color:var(--muted);margin-top:2px}
  .callout{margin-top:22px;background:var(--paper);border:1px solid var(--border);border-left:3px solid var(--teal);border-radius:10px;padding:15px 18px}
  .callout a{color:#0b7c72;font-weight:600;text-decoration:none}
  .sectlabel{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--teal);margin:26px 0 10px}
  h2.sec{font-size:15px;font-weight:800;color:var(--ink);margin-bottom:12px}
  .sev{display:flex;flex-direction:column;gap:9px}
  .sev .row{display:flex;align-items:center;gap:12px;font-size:11px}
  .sev .lab{width:120px;display:flex;align-items:center;gap:7px;font-weight:500}
  .sev .dot{width:9px;height:9px;border-radius:50%}
  .sev .track{flex:1;height:8px;background:#eef1f4;border-radius:5px;overflow:hidden}
  .sev .fill{height:100%;border-radius:5px}
  .sev .cnt{width:84px;text-align:right;color:var(--muted);font-weight:600}
  .issue{border:1px solid var(--border);border-radius:12px;padding:15px 17px;margin-bottom:12px;page-break-inside:avoid}
  .issue .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
  .issue .nm{font-size:13px;font-weight:700;color:var(--ink)}
  .tag{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:999px;color:#fff}
  .grid2{display:flex;gap:18px;margin-bottom:9px}
  .grid2 .col{flex:1}
  .mini{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
  .verify{margin-top:8px;padding-top:9px;border-top:1px dashed var(--border);font-size:10.5px;color:var(--muted)}
  .verify a{color:#0b7c72;font-weight:600;text-decoration:none}
  .trust{background:var(--ink);color:#fff;border-radius:14px;padding:20px 22px;margin-top:6px}
  .trust h3{font-size:13px;font-weight:700;margin-bottom:9px}
  .trust p{font-size:10.5px;color:#cdddea;margin-bottom:7px}
  .trust a{color:#5fd0c2;font-weight:600;text-decoration:none}
  .trust .disc{font-size:9.5px;color:#8aa6be;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.12)}
  .cta{margin-top:18px;border:1px solid var(--teal);background:var(--teal-soft);border-radius:14px;padding:22px}
  .cta h3{font-size:16px;font-weight:800;color:var(--ink)}
  .cta p{font-size:11.5px;color:var(--text);margin-top:4px}
  .foot{margin-top:24px;padding-top:14px;border-top:1px solid var(--border);font-size:9.5px;color:var(--muted);display:flex;justify-content:space-between}
  .shield{display:inline-block;vertical-align:middle}
</style></head><body>
<div class="page">
  <div class="band">
    <div class="lock">
      <svg class="shield" width="26" height="26" viewBox="0 0 64 64" fill="none"><path d="M32 6C38 6 46 8 51 11C53 12 54 14 54 17L54 31C54 43 45 52 33 57C32.4 57.3 31.6 57.3 31 57C19 52 10 43 10 31L10 17C10 14 11 12 13 11C18 8 26 6 32 6Z" fill="#0D9488"/><path d="M22 31L29 38L43 23" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="w">Complyo</span>
    </div>
    <div class="kicker">Website Accessibility Report${opts.business ? " &middot; " + esc(opts.business) : ""}</div>
    <div class="title">${total > 0 ? `Your site has ${total} issue${total === 1 ? "" : "s"} that create accessibility risk` : "Your monthly accessibility check"}</div>
    <div class="meta">
      <div>Site scanned&nbsp;&nbsp;<b>${esc(host(report.url))}</b></div>
      <div>Date&nbsp;&nbsp;<b>${esc(date)}</b></div>
      <div>Standard&nbsp;&nbsp;<b>WCAG 2.1 Level AA</b></div>
    </div>
  </div>
  <div class="pad">
    <div class="hero">
      <div class="gradebox">${report.grade}</div>
      <div>
        <div class="num">${report.score}<span>&nbsp;/100</span></div>
        <div class="risk">${RISK_LABEL[report.grade] || ""}</div>
        <div class="sub">Score reflects issues commonly cited in ADA-related demand letters.</div>
      </div>
    </div>
    <div class="callout">
      <p><b>What this means.</b> Parts of your website may be difficult or impossible to use for people with disabilities. Under the ADA, businesses open to the public are expected to make their online services accessible. The U.S. Department of Justice has stated this applies to business websites:
      <a href="https://www.ada.gov/resources/web-guidance/">ada.gov/resources/web-guidance</a>.</p>
    </div>
    <div class="sectlabel">Severity Breakdown</div>
    <h2 class="sec">What we found, by seriousness</h2>
    <div class="sev">
      <div class="row"><div class="lab"><span class="dot" style="background:var(--f)"></span>Critical</div><div class="track"><div class="fill" style="width:${Math.min(report.counts.critical * 22 + (report.counts.critical ? 20 : 0), 100)}%;background:var(--f)"></div></div><div class="cnt">${report.counts.critical} issue${report.counts.critical === 1 ? "" : "s"}</div></div>
      <div class="row"><div class="lab"><span class="dot" style="background:var(--d)"></span>Serious</div><div class="track"><div class="fill" style="width:${Math.min(report.counts.serious * 22 + (report.counts.serious ? 20 : 0), 100)}%;background:var(--d)"></div></div><div class="cnt">${report.counts.serious} issue${report.counts.serious === 1 ? "" : "s"}</div></div>
      <div class="row"><div class="lab"><span class="dot" style="background:var(--c)"></span>Moderate</div><div class="track"><div class="fill" style="width:${Math.min(report.counts.moderate * 22 + (report.counts.moderate ? 20 : 0), 100)}%;background:var(--c)"></div></div><div class="cnt">${report.counts.moderate} issue${report.counts.moderate === 1 ? "" : "s"}</div></div>
      <div class="row"><div class="lab"><span class="dot" style="background:var(--a)"></span>Checks passed</div><div class="track"><div class="fill" style="width:78%;background:var(--a)"></div></div><div class="cnt">${report.passedChecks} passed</div></div>
    </div>
    <div class="foot"><span>Complyo &middot; getcompli.com</span><span>Automated accessibility scan &middot; Page 1 of 2</span></div>
  </div>
</div>
<div class="page">
  <div class="pad" style="padding-top:36px">
    <div class="sectlabel">The Details</div>
    <h2 class="sec">${issues.length ? "The issues we found, and how to check them yourself" : "Monitoring summary"}</h2>
    ${issuesHtml}
    <div class="trust">
      <h3>How this scan works, and why you can trust it</h3>
      <p>This report was produced by an automated scan using <b>axe-core</b>, the open-source accessibility engine used by professionals worldwide. It checks your site against <b>WCAG 2.1 Level AA</b>, the standard cited in ADA-related lawsuits.</p>
      <p>Every issue links to an independent explanation so you can verify it. The standard: <a href="https://www.w3.org/WAI/standards-guidelines/wcag/">w3.org/WAI</a>. The DOJ on the ADA and websites: <a href="https://www.ada.gov/resources/web-guidance/">ada.gov</a>.</p>
      <div class="disc">This is an informational accessibility risk assessment, not legal advice. Complyo is not a law firm. There is no government-certified "ADA compliance" stamp for private websites; this measures conformance with WCAG 2.1 AA.</div>
    </div>
    <div class="cta">
      <h3>You are actively monitoring your site's accessibility.</h3>
      <p>Complyo re-checks ${esc(host(report.url))} every month and alerts you the moment something changes. Questions about anything in this report? Reply to the email this came with.</p>
    </div>
    <div class="foot"><span>Complyo &middot; getcompli.com &middot; Informational risk assessment, not legal advice</span><span>Page 2 of 2</span></div>
  </div>
</div>
</body></html>`;
}

/** Render the report to a PDF Buffer using the shared browser. */
export async function renderReportPdf(
  browser: Browser,
  report: ScanReport,
  opts: { business?: string; date?: string } = {},
): Promise<Buffer> {
  const html = renderReportHtml(report, opts);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => (document as any).fonts && (document as any).fonts.ready);
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return pdf;
  } finally {
    await context.close();
  }
}
