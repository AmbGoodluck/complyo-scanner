// Shared types for the Complyo scanner.
// Kept dependency-free so the scoring logic can be unit-tested without Playwright.

export type Impact = "minor" | "moderate" | "serious" | "critical";

/** The slim shape we care about from an axe-core violation. */
export interface AxeNode {
  target?: string[];
  html?: string;
}

export interface AxeViolation {
  id: string;
  impact?: Impact | null;
  description: string;
  help: string;
  helpUrl: string;
  tags?: string[];
  nodes: AxeNode[];
}

/** The slim shape we care about from a full axe-core run. */
export interface AxeResultsLike {
  violations: AxeViolation[];
  passes?: { id: string }[];
  incomplete?: { id: string }[];
  inapplicable?: { id: string }[];
}

export type Grade = "A" | "B" | "C" | "D" | "F";

/** A single issue, trimmed down for the report. */
export interface ReportIssue {
  id: string;
  impact: Impact;
  description: string;
  help: string;
  helpUrl: string;
  elementsAffected: number;
  /** A couple of example selectors so a developer can find the problem fast. */
  examples: string[];
}

/** The full result we store per scanned site. */
export interface ScanReport {
  url: string;
  scannedAt: string; // ISO timestamp
  ok: boolean; // false if the scan itself failed (site down, timeout, etc.)
  error?: string; // populated when ok === false
  score: number; // 0–100
  grade: Grade;
  counts: Record<Impact, number>; // number of distinct issues at each impact level
  totalElementsAffected: number;
  passedChecks: number;
  topIssues: ReportIssue[]; // worst issues first
  allIssues: ReportIssue[]; // every violation, worst first
}
