# Analytics Tools

**17 free analytics tools that run in your terminal.** Read a GA4 export, find the quick wins in Search Console, catch content decay, grade a landing page, audit your UTMs, and check whether an A/B test actually decided anything. Every tool is one file, has zero dependencies, and does its arithmetic in code rather than asking a model to do sums.

Built by [Ammar Imtiaz](https://www.ammarimtiaz.com). MIT licensed.

```bash
git clone https://github.com/4mmar1mtiaz/Analytics-Tools.git
cd Analytics-Tools
node tools/gsc-quick-wins-finder.js --demo
```

That runs on built-in sample data and needs no API key at all. Point it at your own export when you want a real answer.

---

## Why these exist

Analytics tools are the one category where a wrong number is worse than no number. Most of them hide the formula behind a dashboard, so you get a score with no way to check it and no way to argue with it.

These do the opposite. The weights are printed. The click-through-rate curve is printed. The formula behind every score is in the detail line next to the score, with your numbers substituted in. **No model is ever asked to do arithmetic** — the model is used only for the reading, after the maths is already done in code. Set no API key at all and you still get every computed number; you just lose the commentary, and the tool says so plainly instead of pretending.

---

## The tools

| Tool | What it does | The question it answers |
|---|---|---|
| [`gsc-quick-wins-finder`](#gsc-quick-wins-finder) | Finds keywords sitting at positions 8–20 and projects the clicks from moving them | What is one push away from page one? |
| [`traffic-drop-detector`](#traffic-drop-detector) | Compares two periods and ranks pages by sessions lost, not by percent | What actually dropped, and how much did it cost? |
| [`content-decay-detector`](#content-decay-detector) | Separates real decay from a site-wide event and finds pages losing over consecutive periods | Which pages are quietly dying? |
| [`traffic-forecast-calculator`](#traffic-forecast-calculator) | Projects clicks at target positions from a stated CTR curve | What is ranking higher actually worth? |
| [`seo-opportunity-scorer`](#seo-opportunity-scorer) | Scores keywords on seven weighted factors with the weights printed | Which keyword do I work on first? |
| [`conversion-funnel-analyzer`](#conversion-funnel-analyzer) | Finds the bottleneck step and sizes the prize for fixing it | Where is the funnel leaking? |
| [`landing-page-performance-grader`](#landing-page-performance-grader) | Grades a page A–F on traffic, engagement, conversion and mechanics | How good is this page, really? |
| [`landing-page-comparator`](#landing-page-comparator) | Compares two pages metric by metric and runs a significance test on the difference | Which page wins, and is the win real? |
| [`ab-test-significance-calculator`](#ab-test-significance-calculator) | Runs the z-test, the confidence interval and the sanity checks on a split test | Can I call this test yet? |
| [`utm-tracking-auditor`](#utm-tracking-auditor) | Finds the taxonomy breaks that split one channel into five rows | Why does my source report look like that? |
| [`ga4-traffic-report`](#ga4-traffic-report) | Turns a GA4 pages export into a concentration report — which pages carry the site | Where does my traffic actually come from? |
| [`traffic-source-analyzer`](#traffic-source-analyzer) | Compares each channel's share of traffic against its share of conversions | Which channel is carrying me, and which is just noise? |
| [`low-ctr-page-finder`](#low-ctr-page-finder) | Finds pages under-performing against their ranking position, not just low CTR | Which titles are costing me clicks I already earned? |
| [`content-refresh-prioritizer`](#content-refresh-prioritizer) | Builds a ranked refresh queue from traffic at stake, decline, position and staleness | What do I update this month? |
| [`cro-audit-checker`](#cro-audit-checker) | Scores a page on eight conversion categories with the thresholds printed | Why is this page not converting? |
| [`cta-analyzer`](#cta-analyzer) | Finds every call to action, scores its wording, and checks distribution and goal fit | Are my CTAs doing anything? |
| [`attribution-gap-checker`](#attribution-gap-checker) | Compares platform-reported conversions against analytics and diagnoses the gap | Why does Meta claim 690 and GA4 claim 412? |

Three more are still in the workshop. The list above is what passes its own tests today.

---

## Quick start

**Requirements:** Node.js 18 or newer. Nothing else. No `npm install` step, because there is nothing to install.

**Try any tool with no key:**

```bash
node tools/traffic-drop-detector.js --demo
```

**Point it at your own export.** Most of these read a CSV you already have — a GA4 pages export, a Search Console queries export, a rank tracker download:

```bash
node tools/gsc-quick-wins-finder.js queries.csv
node tools/traffic-drop-detector.js before.csv after.csv
cat funnel.csv | node tools/conversion-funnel-analyzer.js -
```

**The calculators take plain key=value lines** instead of a spreadsheet:

```bash
printf 'visitors_a=1000\nconversions_a=100\nvisitors_b=1000\nconversions_b=130\n' > test.txt
node tools/ab-test-significance-calculator.js test.txt
```

**Add a key for the commentary**, whichever provider you already pay for:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or
export GEMINI_API_KEY=...
```

Without a key the numbers are identical. Only the interpretation is missing, and the report tells you it is missing.

Every tool responds to `--help` and to `--demo`.

---

## The tools in detail

### Read the report

#### `ga4-traffic-report`
*GA4 traffic report.* Turns a pages export into the one thing the GA4 interface will not show you plainly: concentration. Which pages make the first 50% of your traffic, which make the first 80%, which pages are in the top quartile of sessions but below half the site median for conversion, and how much of the site is pages under 1% that nobody should be spending time on.

```bash
node tools/ga4-traffic-report.js ga4-pages-export.csv
```

#### `traffic-source-analyzer`
*Channel mix and dependency risk.* Sets each channel's share of sessions next to its share of conversions. A channel bringing 40% of the traffic and 8% of the conversions is a different problem from one bringing 8% and 40%, and the ratio between the two shares is the number that separates them. It also states plainly when a single channel carries more than half of everything, which is the risk nobody puts in the monthly report.

### Find the opportunity

#### `gsc-quick-wins-finder`
*Search Console quick wins.* Selects keywords ranking between 8 and 20 with real impression volume behind them, because those are the ones a single push moves onto page one. Projects the clicks gained at position 5 and position 3 from a click-through-rate curve that is printed in the report, so you can check the estimate rather than trust it.

```bash
node tools/gsc-quick-wins-finder.js search-console-queries.csv
```

#### `seo-opportunity-scorer`
*Keyword priority scoring.* Scores every keyword on seven factors — volume, position, commercial intent, competition, click-through gap, freshness and trend — combined with weights declared as a visible constant. A factor missing from your export is redistributed across the ones that are present rather than scored as zero, because scoring a missing input as zero is a lie about the keyword.

#### `low-ctr-page-finder`
*Under-performing against position.* Low click-through rate is not the finding — low click-through rate *for the position you already hold* is. A page at position 18 with 1.1% CTR is behaving normally. A page at position 3 with 1.1% CTR is losing money every day. This computes the expected CTR for each row's position from a printed curve, then ranks by the clicks the gap is costing you.

#### `content-refresh-prioritizer`
*What to update this month.* Builds a ranked queue from four weighted factors — traffic at stake, decline severity, proximity to page one, staleness — with the weights printed, because a priority queue nobody can audit gets ignored. Effort is scored on a separate axis from priority, and the queue is cut at twenty, since a list longer than a month of work is not a queue.

#### `traffic-forecast-calculator`
*What is ranking worth.* Projects the clicks available at positions 10, 5, 3 and 1 for every keyword, then sums them into a site-level figure. It also states its three assumptions as findings rather than footnotes: that the position is reached and held, that the CTR curve holds for this SERP, and that no SERP feature eats the click.

### Find the damage

#### `traffic-drop-detector`
*What dropped and what it cost.* Compares two periods and ranks by sessions lost, not by percentage. A 90% drop on eleven sessions is noise, and a tool that leads with it wastes your morning. Pages below the impression floor are counted and set aside instead of dressed up as findings.

```bash
node tools/traffic-drop-detector.js last-month.csv this-month.csv
```

#### `content-decay-detector`
*Which pages are dying.* Decay is not the same as a drop. This flags a page only when it lost traffic over consecutive periods, or lost ground while the site as a whole did not — and when the whole site moved together, it says so and stops blaming individual pages for a site event.

### Judge the page

#### `landing-page-performance-grader`
*Landing page grade.* Scores a page on four axes with the thresholds written as visible constants — traffic, engagement, conversion against a stated median, and page mechanics pulled from the HTML. Each axis gets a letter, the overall is the mean, and it never rounds upward.

```bash
node tools/landing-page-performance-grader.js https://example.com/pricing
```

#### `landing-page-comparator`
*A vs B, honestly.* Measures both pages the same way, then runs a two-proportion z-test on the conversion difference. A comparison that calls a coin-flip a winner is worse than no comparison, so the significance result is reported next to the verdict.

#### `cro-audit-checker`
*Eight-category conversion audit.* Scores a page on headline, value proposition, social proof, calls to action, objection handling, risk reversal, urgency and structure. Everything countable is counted in code first — CTA positions, proof words, form fields, heading hierarchy — and the model is asked only for the judgements code cannot make, like whether the proof is credible and whether the objections a real buyer has are answered.

```bash
node tools/cro-audit-checker.js https://example.com/pricing
```

#### `cta-analyzer`
*Are your CTAs working.* Finds every call to action, scores its wording against printed constants (start, get, book and claim beat learn more, click here and submit), and maps where they sit through the page. The distribution check is the useful half: repeating one CTA is strength, five different CTAs is confusion, and most tools cannot tell those apart.

#### `conversion-funnel-analyzer`
*Where the funnel leaks.* Takes your steps in the order you give them, computes step and cumulative conversion rates, flags the largest absolute drop-off as the bottleneck, and sizes the prize — how many extra conversions you would get if the worst step matched the best one. That number is the reason anyone ever fixes it.

### Check the measurement itself

#### `ab-test-significance-calculator`
*Can I call this test.* Conversion rates, absolute and relative lift, pooled standard error, z-score, two-tailed p-value and the 95% confidence interval. It distinguishes "not significant" from "not yet" — an underpowered test has not decided anything either way, and calling an undecided test a loss is how winning variants get killed. It also runs the checks nobody runs: whole weeks, traffic split within 5% of even, and whether the observed lift sits inside the interval of no effect.

#### `attribution-gap-checker`
*Why the two numbers disagree.* Sets platform-reported conversions next to analytics-attributed conversions for the same period and prints both implied CPAs side by side, because two CPAs on the same spend is the finding. The gap is classified against stated bands — under 10% is model difference, 10–30% is the usual view-through and cross-device split, over 60% means one of the numbers is simply wrong — and it ends by naming which figure you are allowed to plan spend against.

```bash
printf 'ga4_conversions=412\nmeta_reported=690\nspend=8400\n' | node tools/attribution-gap-checker.js -
```

#### `utm-tracking-auditor`
*Why your channel report is wrong.* Finds the taxonomy breaks that silently split one channel across several rows: case variants, separator variants, non-standard mediums, a source that duplicates its medium, campaigns differing by one character, paid links with no campaign, and UTMs on internal links — that last one wipes the original attribution and is the most expensive mistake on the list.

```bash
node tools/utm-tracking-auditor.js urls.txt
```

---

## How they work

Every tool in this repo follows the same contract:

- **One file.** Copy a single `.js` out of `tools/` and it still runs. Nothing here imports anything else here.
- **Zero dependencies.** Node built-ins only. No `node_modules`, no supply chain, no install step.
- **The maths is in the code.** Every score, rate, projection and test statistic is computed in JavaScript you can read. The model is never asked to do arithmetic, because arithmetic has to be reproducible.
- **The formula is printed.** Weights, thresholds and CTR curves are declared as constants and shown in the report, so a number you disagree with can be argued with rather than taken on faith.
- **Works with no key.** Set nothing and you still get every computed number. The interpretation is skipped and the report says so.
- **Demo mode.** `--demo` runs on hand-written sample data with no key and no network call.
- **HTML reports.** A self-contained report you can send to a client without them installing anything.

---

## FAQ

**Are these free?**
Yes. MIT licensed, no signup, no account, no limits from me. Most of these produce their whole answer without any model call at all.

**Do I need an API key?**
No. Every number is computed locally. A key adds the written interpretation on top, and without one the tool tells you that is what is missing.

**Where does my data go?**
Nowhere, unless you set a key — and then only to that provider. There is no server in the middle, no telemetry, no analytics. Read the file; it is one file.

**What export formats do these read?**
Standard GA4 and Search Console CSV exports, including the comment lines and blank rows those exports put above the real header. The parsers find the header row themselves and tell you which columns they used.

**Why is a percentage the wrong way to rank a traffic drop?**
Because percentage is scale-blind. A page falling from 11 sessions to 1 is a 91% drop and costs you ten sessions. A page falling from 4,000 to 3,200 is a 20% drop and costs you eight hundred. Ranking by percentage puts the first one at the top of your report every single time.

**Can I use these commercially?**
Yes. MIT. Use them in client work, fold them into your own product, rename them, sell the output. Attribution is appreciated and not required.

---

## Contributing

Issues and pull requests welcome. If a tool gives you a wrong number, open an issue with the input you used — a wrong number in an analytics tool is a bug, not a matter of taste, and it gets fixed first.

---

## More tools

- [SEO-tools-by-Ammar-Imtiaz](https://github.com/4mmar1mtiaz/SEO-tools-by-Ammar-Imtiaz) — 20 technical SEO and answer engine optimization tools, same format.
- [Research_Tools](https://github.com/4mmar1mtiaz/Research_Tools) — 20 market research and idea validation tools, same format.
- [Content-Agent-Helpers](https://github.com/4mmar1mtiaz/Content-Agent-Helpers) — 20 ad copy, creative and brand tools, same format.

---

## About

Built by **Ammar Imtiaz**, who builds software for government contracting, SEO and marketing automation.

- Website: [www.ammarimtiaz.com](https://www.ammarimtiaz.com)
- LinkedIn: [linkedin.com/in/ammarimtiaz](https://www.linkedin.com/in/ammarimtiaz/)
- GitHub: [github.com/4mmar1mtiaz](https://github.com/4mmar1mtiaz)

If one of these saved you an afternoon, a star on the repo is the cheapest way to say so.

MIT License. Do what you like with it.
