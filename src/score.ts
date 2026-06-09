// The scoring engine. Pure functions only — no Playwright, no I/O — so it is
// fully testable on its own and easy to reason about.
//
// Scoring philosophy:
//   - Start every site at 100.
//   - Deduct for each distinct violation, weighted by how serious it is
//     (axe "impact") and scaled — with diminishing returns — by how many
//     elements it affects. One critical issue on 200 elements should hurt,
//     but it shouldn't be 200x a single instance, so we use a log scale.
//   - Clamp to 0–100 and map to a familiar A–F grade.
//
// This produces a stable, explainable number: "you have 3 serious issues
// affecting many elements" maps to a score you can defend to a customer.

import type {
  AxeResultsLike,
  AxeViolation,
  Grade,
  Impact,
  ReportIssue,
  ScanReport,
} from "./types.js";

// Calibrated so that: a clean site scores in the 90s (A), a typical small-
// business site with a few common issues lands in the D/C range (clearly
// "needs attention" without being the absolute bottom), and a genuinely
// broken site bottoms out at F. This spread is what makes the score useful
// in a report — if everything scored F, the number would mean nothing.
const IMPACT_WEIGHT: Record<Impact, number> = {
  critical: 8,
  serious: 5,
  moderate: 2,
  minor: 0.5,
};

/** 1 element → 1.0, 10 → 2.0, 100 → 3.0. Diminishing returns on volume. */
function nodeFactor(elementsAffected: number): number {
  return 1 + Math.log10(Math.max(1, elementsAffected));
}

function impactOf(v: AxeViolation): Impact {
  return (v.impact ?? "minor") as Impact;
}

/** Deduction contributed by a single violation. */
function deductionFor(v: AxeViolation): number {
  const impact = impactOf(v);
  const elements = v.nodes?.length ?? 1;
  return IMPACT_WEIGHT[impact] * nodeFactor(elements);
}

// Grade bands tuned for accessibility (not the academic 90/80/70/60 scale).
// These give meaningful separation: a site with fixable issues reads as a D
// ("significant issues, real risk"), while F is reserved for sites that are
// severely or pervasively inaccessible.
//   A (90–100): essentially clean
//   B (75–89):  minor issues only
//   C (60–74):  moderate issues, should address
//   D (40–59):  significant issues, real exposure
//   F (0–39):   severe / pervasive inaccessibility
export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function toReportIssue(v: AxeViolation): ReportIssue {
  const examples = (v.nodes ?? [])
    .map((n) => (n.target && n.target.length ? n.target.join(" ") : n.html ?? ""))
    .filter(Boolean)
    .slice(0, 3);

  return {
    id: v.id,
    impact: impactOf(v),
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    elementsAffected: v.nodes?.length ?? 0,
    examples,
  };
}

/**
 * Turn a raw axe-core result into a full Complyo ScanReport.
 * `url` and `scannedAt` are passed in by the caller.
 */
export function buildReport(
  url: string,
  scannedAt: string,
  results: AxeResultsLike,
): ScanReport {
  const violations = results.violations ?? [];

  const totalDeduction = violations.reduce((sum, v) => sum + deductionFor(v), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));

  const counts: Record<Impact, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  let totalElementsAffected = 0;
  for (const v of violations) {
    counts[impactOf(v)] += 1;
    totalElementsAffected += v.nodes?.length ?? 0;
  }

  // Worst issues first: sort by the deduction each one contributes.
  const sorted = [...violations].sort((a, b) => deductionFor(b) - deductionFor(a));
  const allIssues = sorted.map(toReportIssue);

  return {
    url,
    scannedAt,
    ok: true,
    score,
    grade: gradeFor(score),
    counts,
    totalElementsAffected,
    passedChecks: results.passes?.length ?? 0,
    topIssues: allIssues.slice(0, 5),
    allIssues,
  };
}

/** A report representing a scan that failed to run at all (site down, timeout). */
export function failedReport(
  url: string,
  scannedAt: string,
  error: string,
): ScanReport {
  return {
    url,
    scannedAt,
    ok: false,
    error,
    score: 0,
    grade: "F",
    counts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    totalElementsAffected: 0,
    passedChecks: 0,
    topIssues: [],
    allIssues: [],
  };
}
