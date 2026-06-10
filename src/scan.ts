// Scans ONE url: launches a headless browser, loads the page, runs axe-core
// against it, and returns a ScanReport. This is the unit that batch.ts calls
// for every site, and that the monthly customer loop reuses unchanged.

import { chromium, type Browser, type Page, type Route } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { buildReport, failedReport } from "./score.js";
import type { AxeResultsLike, ScanReport } from "./types.js";

// Bounded so a heavy/slow site still finishes well within the gateway limit.
const PAGE_TIMEOUT_MS = 20_000;   // hard cap on initial navigation
const DOM_SETTLE_MS = 1_200;      // short pause after DOM ready for async content
const SCROLL_MAX_MS = 2_500;      // quick lazy-load trigger, then stop

// Resource types we don't need for an accessibility scan. axe-core reads the
// DOM and computed styles, not the actual bytes of images/fonts/media. Skipping
// these downloads cuts most of the wait without changing the result (an <img>
// with no alt is still an <img> with no alt, even if its bytes never load).
const SKIP_RESOURCE_TYPES = new Set(["image", "media", "font"]);

// Third-party noise that slows pages and never affects accessibility scoring.
const SKIP_URL_PATTERNS = [
  "googletagmanager.com", "google-analytics.com", "analytics.google.com",
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "facebook.net", "connect.facebook", "hotjar.com", "clarity.ms",
  "segment.com", "segment.io", "mixpanel.com", "amplitude.com",
  "fullstory.com", "intercom.io", "intercomcdn.com", "drift.com",
  "tiktok.com", "snapchat.com", "criteo", "taboola.com", "outbrain.com",
  "youtube.com/embed", "vimeo.com/video", "player.vimeo.com",
];

/** Normalise user-supplied input into a real URL (adds https:// if missing). */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Decide whether to block a given request to speed up the scan. */
function shouldBlock(route: Route): boolean {
  const req = route.request();
  if (SKIP_RESOURCE_TYPES.has(req.resourceType())) return true;
  const u = req.url().toLowerCase();
  return SKIP_URL_PATTERNS.some((p) => u.includes(p));
}

/**
 * Trigger lazy-loaded content with a quick scroll, then return to top. Kept
 * short and bounded: a couple of fast passes is enough to materialise
 * below-the-fold elements for a consistent DOM, without crawling the whole
 * page slowly (which is what made scans take 15-20s on heavy sites).
 */
async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async (maxMs) => {
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        window.scrollBy(0, Math.max(window.innerHeight * 0.9, 600));
        const atBottom =
          window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
        if (atBottom || Date.now() - start > maxMs) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  }, SCROLL_MAX_MS);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(DOM_SETTLE_MS);
}

/**
 * Scan a single URL. Pass in a shared `browser` when scanning many sites so we
 * don't pay browser-launch cost per site. If none is given, one is launched
 * and closed for this single scan.
 */
export async function scanUrl(
  rawUrl: string,
  browser?: Browser,
): Promise<ScanReport> {
  const url = normaliseUrl(rawUrl);
  const scannedAt = new Date().toISOString();

  const ownBrowser = !browser;
  const b = browser ?? (await chromium.launch({ headless: true }));

  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (compatible; ComplyoBot/1.0; +https://getcompli.com/bot)",
    viewport: { width: 1366, height: 900 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });

  // Block non-essential downloads at the network level. CSS and same-origin
  // scripts still load, so layout, contrast, and ARIA evaluate correctly.
  await context.route("**/*", (route) => {
    if (shouldBlock(route)) route.abort().catch(() => {});
    else route.continue().catch(() => {});
  });

  const page = await context.newPage();

  try {
    // "domcontentloaded" returns as soon as the HTML/DOM is parsed, instead of
    // waiting for every last resource. With blocking above, this is fast and
    // reliable even on heavy marketing sites.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });

    await settlePage(page);

    const results = (await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze()) as unknown as AxeResultsLike;

    return buildReport(url, scannedAt, results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failedReport(url, scannedAt, message);
  } finally {
    await context.close();
    if (ownBrowser) await b.close();
  }
}

// Allow `npm run scan:one -- https://example.com` for quick one-off checks.
const isDirectRun = process.argv[1] && process.argv[1].endsWith("scan.ts");
if (isDirectRun) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npm run scan:one -- <url>");
    process.exit(1);
  }
  scanUrl(target).then((report) => {
    console.log(JSON.stringify(report, null, 2));
  });
}