// Scans ONE url: launches a headless browser, loads the page, runs axe-core
// against it, and returns a ScanReport. This is the unit that batch.ts calls
// for every site, and that the monthly customer loop will reuse unchanged.

import { chromium, type Browser, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { buildReport, failedReport } from "./score.js";
import type { AxeResultsLike, ScanReport } from "./types.js";

const PAGE_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 8_000;
const SCROLL_MAX_MS = 5_000;

/** Normalise user-supplied input into a real URL (adds https:// if missing). */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Scroll from top to bottom to trigger lazy-loaded images, embeds, and
 * sections, then return to the top. Without this, below-the-fold content
 * (and its accessibility issues) is scanned inconsistently between runs,
 * which makes the score wobble. This forces every run to scan the same
 * fully-materialised page.
 */
async function settlePage(page: Page): Promise<void> {
  // Wait for the network to go quiet so async content has arrived. Many sites
  // poll/stream forever and never reach true idle, so this is capped and the
  // timeout is expected, not an error.
  try {
    await page.waitForLoadState("networkidle", {
      timeout: NETWORK_IDLE_TIMEOUT_MS,
    });
  } catch {
    /* never reached idle — fine, continue */
  }

  // Auto-scroll through the page to trigger lazy loading.
  await page.evaluate(async (maxMs) => {
    await new Promise<void>((resolve) => {
      const step = 500;
      const start = Date.now();
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        const atBottom =
          window.innerHeight + window.scrollY >=
          document.body.scrollHeight - 2;
        if (atBottom || Date.now() - start > maxMs) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }, SCROLL_MAX_MS);

  // Back to the top and let any newly-loaded content settle.
  await page.evaluate(() => window.scrollTo(0, 0));
  try {
    await page.waitForLoadState("networkidle", { timeout: 3_000 });
  } catch {
    /* fine */
  }
  await page.waitForTimeout(500);
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

  // A fresh, isolated context per site — no shared cookies/state between scans.
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (compatible; ComplyoBot/1.0; +https://getcompli.com/bot)",
    viewport: { width: 1366, height: 900 },
    // Consistent rendering between runs: no motion, fixed colour scheme.
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: "load",
      timeout: PAGE_TIMEOUT_MS,
    });

    // Make the DOM snapshot consistent run-to-run before scanning.
    await settlePage(page);

    const results = (await new AxeBuilder({ page })
      // WCAG 2.1 A & AA — the levels ADA demand letters actually cite.
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