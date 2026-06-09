// Reads a list of URLs (one per line from urls.txt, or a path passed as an
// argument), scans each one, writes a JSON report per site into ./output, and
// writes a summary.csv ranked worst-score-first.
//
// That CSV is doing double duty: it's your QA view of the run, AND it's your
// lead list for outreach — the worst-scoring sites are the businesses with the
// most to fear and the easiest to convince.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { scanUrl, normaliseUrl } from "./scan.js";
import type { ScanReport } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUTPUT_DIR = join(ROOT, "output");

// Scan a few sites at a time. Higher = faster but heavier; 3 is safe for CI.
const CONCURRENCY = 3;

function sanitiseFilename(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9.-]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
}

async function loadUrls(): Promise<string[]> {
  const fileArg = process.argv[2];
  const path = fileArg ? fileArg : join(ROOT, "urls.txt");
  if (!existsSync(path)) {
    console.error(`No URL list found at ${path}.`);
    console.error("Create urls.txt with one website per line, or pass a path.");
    process.exit(1);
  }
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(normaliseUrl);
}

/** Run an async mapper over items with a fixed concurrency limit. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function toCsvRow(values: (string | number)[]): string {
  return values
    .map((v) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

async function main() {
  const urls = await loadUrls();
  console.log(`Scanning ${urls.length} site(s) with concurrency ${CONCURRENCY}...\n`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const reports = await mapWithConcurrency<string, ScanReport>(
    urls,
    CONCURRENCY,
    async (url, i) => {
      const report = await scanUrl(url, browser);
      const status = report.ok
        ? `score ${report.score} (${report.grade})`
        : `FAILED: ${report.error}`;
      console.log(`[${i + 1}/${urls.length}] ${url} → ${status}`);
      await writeFile(
        join(OUTPUT_DIR, `${sanitiseFilename(url)}.json`),
        JSON.stringify(report, null, 2),
      );
      return report;
    },
  );

  await browser.close();

  // Summary CSV, worst score first = best outreach leads at the top.
  const ranked = [...reports].sort((a, b) => a.score - b.score);
  const header = toCsvRow([
    "url", "ok", "score", "grade",
    "critical", "serious", "moderate", "minor",
    "elementsAffected", "topIssue", "scannedAt",
  ]);
  const rows = ranked.map((r) =>
    toCsvRow([
      r.url, r.ok, r.score, r.grade,
      r.counts.critical, r.counts.serious, r.counts.moderate, r.counts.minor,
      r.totalElementsAffected, r.topIssues[0]?.id ?? "", r.scannedAt,
    ]),
  );
  await writeFile(join(OUTPUT_DIR, "summary.csv"), [header, ...rows].join("\n"));
  await writeFile(
    join(OUTPUT_DIR, "summary.json"),
    JSON.stringify(ranked, null, 2),
  );

  const failed = reports.filter((r) => !r.ok).length;
  console.log(
    `\nDone. ${reports.length - failed} scanned, ${failed} failed.` +
      `\nResults in ./output (per-site JSON, summary.csv, summary.json).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
