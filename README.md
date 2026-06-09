# Complyo Scanner — Phase 1

The engine of Complyo (getcompli.com): give it a list of websites, it loads each
one in a real headless browser, runs the [axe-core](https://github.com/dequelabs/axe-core)
accessibility ruleset (WCAG 2.1 A & AA — the levels ADA demand letters actually
cite), scores each site 0–100 with an A–F grade, and writes a report per site
plus a ranked summary.

This runs **unattended** as a scheduled GitHub Action. It's the core that both
loops depend on: the outreach scans (finding restaurants to email) and the
monthly customer reports both call this same code.

> **Framing rule baked in:** this tool reports accessibility **risk** — issues
> commonly cited in ADA-related demand letters. It does not, and must not,
> claim a site is "compliant" or "legally safe." Keep that language out of
> everything downstream (reports, emails, landing page).

---

## What's in here

```
complyo-scanner/
├── src/
│   ├── types.ts     # shared types
│   ├── score.ts     # scoring engine (pure, tested) — turns axe results into a score
│   ├── scan.ts      # scans ONE url with Playwright + axe-core
│   └── batch.ts     # reads urls.txt, scans all, writes ./output
├── .github/workflows/scan.yml   # scheduled, unattended runs
├── urls.txt         # your input list (one site per line)
└── output/          # results land here
```

---

## Step-by-step: run it locally first

**1. Prerequisites.** Install [Node.js 20+](https://nodejs.org). Check with:

```bash
node --version
```

**2. Install dependencies** (from inside the `complyo-scanner` folder):

```bash
npm install
```

**3. Install the browser** Playwright drives (one-time, downloads Chromium):

```bash
npx playwright install chromium
```

**4. Add sites to scan.** Open `urls.txt` and put one website per line. `https://`
is added automatically if you leave it off. Lines starting with `#` are ignored.

**5. Run the scan:**

```bash
npm run scan
```

You'll see live progress, e.g. `[3/20] https://joespizza.com → score 48 (D)`.

**Quick one-off check of a single site:**

```bash
npm run scan:one -- https://example.com
```

---

## Reading the output

Everything lands in `./output/`:

- **`summary.csv`** — every site, **ranked worst-score-first**. This is your QA
  view *and* your lead list: the sites at the top are the businesses with the
  most accessibility risk — the easiest to convince in outreach.
- **`summary.json`** — same data, full detail.
- **`<domain>.json`** — one file per site, with the full issue breakdown:
  score, grade, counts by severity, total elements affected, and the top
  issues (each with a plain-English description, a remediation link, and
  example selectors so a developer can find the problem fast).

---

## How the score works

Every site starts at 100. Each accessibility violation deducts points, weighted
by how serious it is and scaled — with diminishing returns — by how many page
elements it affects:

| Severity  | Weight |
|-----------|--------|
| critical  | 8      |
| serious   | 5      |
| moderate  | 2      |
| minor     | 0.5    |

Grade bands (tuned for accessibility, not the academic scale):

| Grade | Score  | Meaning                              |
|-------|--------|--------------------------------------|
| A     | 90–100 | essentially clean                    |
| B     | 75–89  | minor issues only                    |
| C     | 60–74  | moderate issues, should address      |
| D     | 40–59  | significant issues, real exposure    |
| F     | 0–39   | severe / pervasive inaccessibility   |

All of this lives in `src/score.ts` and is easy to tune.

---

## Step-by-step: run it unattended on GitHub

**1.** Create a new **private** GitHub repo (keep it separate from Amadu — its
own repo, its own infra) and push this folder to it.

**2.** That's it for scheduled runs. The workflow in `.github/workflows/scan.yml`
already runs every Monday at 06:00 UTC and can be triggered manually from the
repo's **Actions** tab → **Complyo Scan** → **Run workflow**.

**3.** After a run, open the run in the **Actions** tab and download the
**`complyo-scan-results`** artifact — it contains the same `output/` files.

**Change the schedule:** edit the `cron` line in the workflow (use
[crontab.guru](https://crontab.guru)).

**Harden CI later:** after your first local `npm install`, commit the generated
`package-lock.json`, then switch the workflow's install step to `npm ci` and add
`cache: "npm"` to the setup-node step for faster, reproducible builds.

---

## What's next (not in Phase 1)

- **Phase 2:** turn each `<domain>.json` into a branded PDF report.
- **Phase 3:** landing page + payments (merchant-of-record checkout) → Supabase.
- **Phase 4:** monthly loop — re-scan paying customers, regenerate PDFs, email
  via Resend from `reports@getcompli.com`.
- **Phase 5:** outreach — scan NYC restaurants, email worst-scorers their score.
