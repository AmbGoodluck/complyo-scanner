// Wraps the scanner as an HTTP service.
//   GET /health            -> { ok: true }
//   GET /scan?url=<site>   -> full ScanReport JSON
//   GET /report?url=<site>&business=<name>  -> branded PDF (application/pdf)
// All scan/report routes require the bearer token.

import http from "node:http";
import { chromium, type Browser } from "playwright";
import { scanUrl } from "./scan.js";
import { renderReportPdf } from "./report.js";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.SCANNER_TOKEN || "";
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);

let browser: Browser | null = null;
let active = 0;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  return browser;
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function authed(req: http.IncomingMessage): boolean {
  if (!TOKEN) return true;
  return (req.headers["authorization"] || "") === `Bearer ${TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "", `http://localhost:${PORT}`);

    if (u.pathname === "/health") return sendJson(res, 200, { ok: true });

    if (u.pathname === "/scan" || u.pathname === "/report") {
      if (!authed(req)) return sendJson(res, 401, { error: "unauthorized" });
      const target = u.searchParams.get("url");
      if (!target) return sendJson(res, 400, { error: "missing url" });
      if (active >= MAX_CONCURRENT) return sendJson(res, 503, { error: "busy, retry shortly" });

      active++;
      try {
        const b = await getBrowser();
        const report = await scanUrl(target, b);

        if (u.pathname === "/scan") {
          return sendJson(res, 200, report);
        }

        // /report -> PDF
        const business = u.searchParams.get("business") || undefined;
        const pdf = await renderReportPdf(b, report, { business });
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="complyo-report.pdf"`,
        });
        res.end(pdf);
        return;
      } finally {
        active--;
      }
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (err) {
    return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Complyo scanner service listening on :${PORT}`);
});
