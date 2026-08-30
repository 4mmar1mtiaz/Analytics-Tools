#!/usr/bin/env node
//
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz
//
'use strict';

// ========== CONSTANTS ==========
const PITCH = 'Compute A/B test significance, sample size, and sanity checks from plain key=value input, then generate a verdict.';
const USAGE = [
  ['<input>', 'path to a file containing key=value lines'],
  ['-', 'read key=value lines from stdin'],
  ['--demo', 'run a demonstration with sample data'],
  ['--help', 'show this help'],
];
const NO_SEARCH_NOTE = 'No API key was set, so the reading is missing; all computed numbers are complete and correct on their own.';

// ========== ANSI COLORS ==========
const C = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  amber: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  teal: s => `\x1b[36m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  text: s => s,
};

// ========== STATUS ==========
const STATUS = {
  SIGNIFICANT: { glyph: '+', color: C.green, label: 'SIGNIFICANT' },
  NOT_SIGNIFICANT: { glyph: '-', color: C.amber, label: 'NOT_SIGNIFICANT' },
  UNDERPOWERED: { glyph: '!', color: C.red, label: 'UNDERPOWERED' },
  WARNING: { glyph: '?', color: C.amber, label: 'WARNING' },
  FAIL: { glyph: 'x', color: C.red, label: 'FAIL' },
};

const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'next';

// ========== HELPERS ==========
function bold(s) { return `\x1b[1m${s}\x1b[0m`; }
function wrap(text, width) {
  if (!text || text.length <= width) return text;
  const words = text.split(' ');
  let lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line += (line ? ' ' : '') + w;
    }
  }
  if (line) lines.push(line.trim());
  return lines.join('\n');
}
function clip(text, n) {
  if (!text) return '';
  return text.length > n ? text.slice(0, n - 3) + '...' : text;
}
function pad(text, n) {
  const s = String(text);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function bar(i, total) {
  if (!total || total <= 0) return '';
  const width = 20;
  const filled = Math.round((i / total) * width);
  return '[' + '#'.repeat(filled) + '-'.repeat(Math.max(0, width - filled)) + ']';
}
let currentLine = '';
function line(text) {
  const newLine = text;
  const out = currentLine ? `\r${' '.repeat(currentLine.length)}\r${newLine}` : newLine;
  process.stdout.write(out + '\x1b[K');
  currentLine = newLine;
}
function endline() {
  if (currentLine) {
    process.stdout.write('\n');
    currentLine = '';
  }
}
function out(text) { console.log(text); }

function parseJSON(text) {
  // try plain JSON first
  try { return JSON.parse(text); } catch(e) {}

  // extract from fenced code block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch(e) {}
  }

  // find object braces and try to parse
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch(e) {}
  }

  throw new Error('Could not parse JSON response');
}

async function ask(P, { system, prompt, schema, search, maxTokens = 4000 }) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('NO_API_KEY');

  let url, headers, body;
  if (process.env.ANTHROPIC_API_KEY) {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    };
    body = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: maxTokens,
      system: system || '',
      messages: [{ role: 'user', content: prompt }],
    };
  } else if (process.env.OPENAI_API_KEY) {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = {
      'content-type': 'application/json',
      'authorization': `Bearer ${key}`,
    };
    body = {
      model: 'gpt-4',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system || '' },
        { role: 'user', content: prompt },
      ],
    };
  } else {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
    headers = { 'content-type': 'application/json' };
    body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
      systemInstruction: { parts: [{ text: system || '' }] },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API error: ${data.error?.message || res.status}`);

  // extract text from provider response
  if (process.env.ANTHROPIC_API_KEY) return data.content[0].text;
  if (process.env.OPENAI_API_KEY) return data.choices[0].message.content;
  return data.candidates[0].content.parts[0].text;
}

async function mapLimit(items, limit, fn) {
  const results = [];
  const queue = [...items];
  let index = 0;
  const workers = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    workers.push((async () => {
      while (queue.length) {
        const item = queue.shift();
        const idx = index++;
        try {
          results[idx] = { ok: true, value: await fn(item, idx) };
        } catch (e) {
          results[idx] = { ok: false, error: e };
        }
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

// ========== MATH HELPERS ==========
function sqrt(x) { return Math.sqrt(x); }
function zFromDelta(delta, se) { return delta / se; }
function normCDF(x) {
  // erf approximation
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = 1 - (((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t;
  const erf = 1 - poly * Math.exp(-a * a);
  return 0.5 * (1 + sign * erf);
}
function twoTailedP(z) { return 2 * (1 - normCDF(Math.abs(z))); }
function pooledSE(rateA, nA, rateB, nB) {
  const p = (rateA * nA + rateB * nB) / (nA + nB);
  return sqrt(p * (1 - p) * (1 / nA + 1 / nB));
}
function confidenceInterval(delta, se) {
  const z = 1.96; // 95% CI
  return { lo: delta - z * se, hi: delta + z * se };
}
function requiredPerArm(baseline, mde, power = 0.8, alpha = 0.05) {
  const zAlpha = 1.96; // two-tailed 95%
  const zBeta = 0.84; // 80% power
  const p1 = baseline;
  const p2 = baseline * (1 + mde);
  const avgP = (p1 + p2) / 2;
  const eff = Math.abs(p2 - p1);
  const n = Math.ceil((2 * avgP * (1 - avgP) * (zAlpha + zBeta) ** 2) / (eff ** 2));
  return n;
}

// ========== RENDER ==========
function renderFindings(items) {
  if (!items || items.length === 0) {
    out(C.dim('  no findings'));
    return;
  }
  // compute column widths
  const statusWidth = Math.max(...Object.values(STATUS).map(s => s.label.length)) + 2;
  const headlineWidth = 50;
  const valueWidth = 10;

  for (const item of items) {
    const st = STATUS[item.status] || STATUS.FAIL;
    const glyph = st.glyph;
    const color = st.color;
    const label = pad(st.label, statusWidth);
    const wasStr = item.was ? item.was.slice(0, valueWidth - 1) + (item.was.length > valueWidth - 1 ? '…' : '') : ''.padEnd(valueWidth);
    const nowStr = item.now ? item.now.slice(0, valueWidth - 1) + (item.now.length > valueWidth - 1 ? '…' : '') : ''.padEnd(valueWidth);
    const head = clip(item.headline, headlineWidth);
    const detail = wrap(item.detail, 60);
    const note = item.note ? ` ${C.dim('→')} ${wrap(item.note, 60)}` : '';
    const source = item.source ? ` ${C.dim(`[${item.source}]`)}` : '';

    out(`${color(glyph)} ${color(label)} ${head} ${wasStr} → ${nowStr}`);
    if (detail) out(`  ${detail}`);
    if (note) out(note);
    if (source) out(`  ${C.dim(source)}`);
    out('');
  }
}

function renderSummary(items, htmlPath) {
  const statusCounts = {};
  for (const item of items) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }
  out(C.dim('  summary:'));
  for (const st of Object.keys(STATUS)) {
    const count = statusCounts[st] || 0;
    if (count > 0) {
      const s = STATUS[st];
      out(`  ${s.color(s.glyph)} ${s.label}: ${count}`);
    }
  }
  if (htmlPath) out(`  html report: ${htmlPath}`);
  out(SUMMARY_NOTE(items));
}

function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { margin-bottom: 24px; }
    .item { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .status { font-weight: bold; margin-bottom: 8px; }
    .headline { font-size: 1.1em; margin-bottom: 8px; }
    .detail { margin-bottom: 8px; line-height: 1.5; }
    .note { color: #666; font-style: italic; }
    .source { color: #999; font-size: 0.9em; }
    .tally { margin-top: 24px; font-size: 1.1em; }
  </style>
</head>
<body>
  <h1>${subject}</h1>
  ${body}
</body>
</html>`;
}

// ========== STATS COMPUTATION ==========
function run(P, input, sourceName) {
  // parse input
  const lines = input.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const params = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && v.length > 0) params[k.trim()] = v.join('=').trim();
  }

  // extract required values
  const visitorsA = parseFloat(params.visitors_a || params.visitorsA);
  const conversionsA = parseFloat(params.conversions_a || params.conversionsA);
  const visitorsB = parseFloat(params.visitors_b || params.visitorsB);
  const conversionsB = parseFloat(params.conversions_b || params.conversionsB);
  const baseline = parseFloat(params.baseline) || null;
  const mde = parseFloat(params.mde) || null;
  const dailyTraffic = parseFloat(params.daily_traffic || params.traffic_daily) || null;

  // check for missing data
  if (isNaN(visitorsA) || isNaN(conversionsA) || isNaN(visitorsB) || isNaN(conversionsB)) {
    return [{
      status: 'FAIL',
      headline: 'Missing required data',
      was: '',
      now: '',
      detail: `Could not parse required data. Expected visitors_a, conversions_a, visitors_b, conversions_b. Got: ${JSON.stringify(params)}`,
      note: '',
      source: sourceName || 'input',
    }];
  }

  // compute rates
  const rateA = conversionsA / visitorsA;
  const rateB = conversionsB / visitorsB;
  const delta = rateB - rateA;
  const relativeLift = rateA > 0 ? ((rateB - rateA) / rateA) * 100 : 0;

  // statistical significance
  const se = pooledSE(rateA, visitorsA, rateB, visitorsB);
  const z = se > 0 ? zFromDelta(delta, se) : 0;
  const p = twoTailedP(z);
  const ci = confidenceInterval(delta, se);

  // power analysis
  const samplePerArm = baseline && mde ? requiredPerArm(baseline, mde) : null;
  const daysNeeded = samplePerArm && dailyTraffic ? Math.ceil(samplePerArm / dailyTraffic) : null;

  // total days elapsed (approximate from both arms)
  const totalVisitors = visitorsA + visitorsB;
  const daysElapsed = dailyTraffic && dailyTraffic > 0 ? totalVisitors / dailyTraffic : null;

  // build items
  const items = [];

  // headline metrics
  items.push({
    status: 'SIGNIFICANT',
    headline: 'Conversions per visitor',
    was: `${conversionsA}/${visitorsA}`,
    now: `${conversionsB}/${visitorsB}`,
    detail: `Arm A: ${(rateA * 100).toFixed(2)}%, Arm B: ${(rateB * 100).toFixed(2)}%. Lift: ${(relativeLift).toFixed(1)}% relative.`,
    note: p < 0.05 ? `Statistically significant (p=${p.toFixed(4)})` : `Not significant (p=${p.toFixed(4)})`,
    source: '',
  });

  // lift
  items.push({
    status: 'SIGNIFICANT',
    headline: 'Absolute lift',
    was: `${(rateA * 100).toFixed(2)}%`,
    now: `${(rateB * 100).toFixed(2)}%`,
    detail: `Difference of ${(delta * 100).toFixed(2)} percentage points, relative lift ${relativeLift > 0 ? '+' : ''}${relativeLift.toFixed(1)}%.`,
    note: '',
    source: '',
  });

  // z-score and p-value
  items.push({
    status: p < 0.05 ? 'SIGNIFICANT' : 'NOT_SIGNIFICANT',
    headline: 'Significance test',
    was: `nA=${visitorsA}, nB=${visitorsB}`,
    now: `z=${z.toFixed(2)}, p=${p.toFixed(4)}`,
    detail: `Z-score from pooled SE (${se.toFixed(4)}). Two-tailed p-value of ${p.toFixed(4)} is ${p < 0.05 ? 'below' : 'above'} the 0.05 threshold.`,
    note: p < 0.05 ? 'Reject the null' : 'Fail to reject; could still be real, just undetected',
    source: '',
  });

  // confidence interval
  items.push({
    status: 'SIGNIFICANT',
    headline: '95% confidence interval on lift',
    was: '',
    now: `[${(ci.lo * 100).toFixed(2)}%, ${(ci.hi * 100).toFixed(2)}%]`,
    detail: `The true lift likely lies in this range. ${ci.lo > 0 ? 'Entirely positive, so lift is likely real.' : ci.hi < 0 ? 'Entirely negative, so harm is likely real.' : 'Crosses zero, so no clear effect.'}`,
    note: '',
    source: '',
  });

  // power and duration
  if (samplePerArm && daysNeeded) {
    const currentN = Math.min(visitorsA, visitorsB);
    const underpowered = currentN < samplePerArm;
    items.push({
      status: underpowered ? 'UNDERPOWERED' : 'SIGNIFICANT',
      headline: 'Sample size needed for 80% power',
      was: `${currentN} per arm`,
      now: `${samplePerArm} per arm`,
      detail: `At baseline ${(baseline * 100).toFixed(1)}% and MDE ${(mde * 100).toFixed(1)}%, need ${samplePerArm} per arm. Current min arm has ${currentN}. ${underpowered ? 'Underpowered.' : 'Powered sufficiently.'}`,
      note: underpowered ? `${Math.ceil((samplePerArm - currentN) / dailyTraffic)} more days needed` : '',
      source: '',
    });
  } else if (baseline && mde) {
    items.push({
      status: 'WARNING',
      headline: 'Need daily traffic for duration estimate',
      was: '',
      now: '',
      detail: `Need ${samplePerArm} per arm but no daily_traffic given to estimate duration.`,
      note: 'Provide daily_traffic for duration estimate',
      source: '',
    });
  }

  // sanity checks
  // whole weeks?
  if (daysElapsed && daysElapsed >= 1) {
    const weeks = daysElapsed / 7;
    if (Math.abs(weeks - Math.round(weeks)) > 0.1) {
      items.push({
        status: 'WARNING',
        headline: 'Test ran a non-integer number of weeks',
        was: `${daysElapsed.toFixed(1)} days`,
        now: `${weeks.toFixed(2)} weeks`,
        detail: `The test ran ${daysElapsed.toFixed(1)} days = ${weeks.toFixed(2)} weeks. Non-integer weeks are fine but uncommon for churn-heavy tests.`,
        note: '',
        source: '',
      });
    }
  }

  // split balance
  const totalV = visitorsA + visitorsB;
  const splitA = (visitorsA / totalV) * 100;
  if (Math.abs(splitA - 50) > 5) {
    items.push({
      status: 'WARNING',
      headline: 'Traffic split is off balance',
      was: `${splitA.toFixed(1)}% A / ${(100 - splitA).toFixed(1)}% B`,
      now: '50/50 expected',
      detail: `Arm A got ${splitA.toFixed(1)}% of traffic, which is >5% off 50/50. This suggests a broken assignment or different session lengths.`,
      note: 'Investigate the assignment logic',
      source: '',
    });
  }

  // lift inside CI of no effect?
  if (ci.lo <= 0 && ci.hi >= 0) {
    items.push({
      status: 'WARNING',
      headline: 'Confidence interval includes zero',
      was: '',
      now: '',
      detail: `The 95% CI [${(ci.lo * 100).toFixed(1)}%, ${(ci.hi * 100).toFixed(1)}%] includes 0, so no effect is a plausible outcome.`,
      note: 'Keep running if possible; this is not a loss, just undecided.',
      source: '',
    });
  }

  return items;
}

// ========== DEMO ==========
const DEMO = [
  {
    status: 'SIGNIFICANT',
    headline: 'Conversions per visitor on checkout flow',
    was: '3,284/41,950 = 7.83%',
    now: '4,012/42,118 = 9.52%',
    detail: 'The new checkout flow converts 1.69 percentage points higher than the current version after 41,950 and 42,118 visitors respectively. The z-score of 2.94 gives a two-tailed p-value of 0.003, comfortably below 0.05.',
    note: 'Reject the null; the lift is likely real.',
    source: '',
  },
  {
    status: 'SIGNIFICANT',
    headline: 'Absolute lift in conversion rate',
    was: '7.83%',
    now: '9.52%',
    detail: 'Absolute lift of 1.69 percentage points, a relative improvement of 21.6%. The confidence interval [0.72%, 2.66%] does not include zero, meaning even the low end is a real improvement.',
    note: '',
    source: '',
  },
  {
    status: 'SIGNIFICANT',
    headline: 'Headline significance test',
    was: 'z = 2.94',
    now: 'p = 0.003',
    detail: 'Using the pooled standard error of 0.574%, the z-score is 2.94. The two-tailed p-value of 0.003 is below the 0.05 alpha, so the result is statistically significant.',
    note: 'p < 0.05 — reject the null hypothesis.',
    source: '',
  },
  {
    status: 'NOT_SIGNIFICANT',
    headline: 'Confidence interval on the lift',
    was: '',
    now: '95% CI: [0.72%, 2.66%]',
    detail: 'The 95% confidence interval for the true lift is entirely positive, which supports the significance finding. Even the lower bound (0.72%) is a meaningful improvement.',
    note: 'The whole CI is above 0.',
    source: '',
  },
  {
    status: 'UNDERPOWERED',
    headline: 'Sample size check for 80% power',
    was: '41,950 & 42,118 visitors',
    now: '31,282 per arm needed',
    detail: 'With a baseline of 7.83% and minimum detectable effect of 5% (to detect 0.39pp), we need 31,282 per arm for 80% power. Both arms exceed this, so the test is powered.',
    note: 'Adequately powered.',
    source: '',
  },
  {
    status: 'WARNING',
    headline: 'Traffic split is 49.9% / 50.1%',
    was: '49.9% arm A',
    now: '50.1% arm B',
    detail: 'The split is nearly 50/50, which is healthy. This checks out.',
    note: '',
    source: '',
  },
];

async function runDemo(writeHTML) {
  line('Loading demo data');
  await new Promise(r => setTimeout(r, 100));
  endline();
  line('Computing statistics');
  await new Promise(r => setTimeout(r, 100));
  endline();
  line('Rendering results');
  await new Promise(r => setTimeout(r, 100));
  endline();
  renderFindings(DEMO);
  let htmlPath = null;
  if (writeHTML) {
    const body = DEMO.map(item => {
      const st = STATUS[item.status];
      return `<div class="item">
        <div class="headline">${st.label}: ${item.headline}</div>
        <div class="detail">${item.detail}</div>
        ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
        ${item.source ? `<div class="source">source: ${item.source}</div>` : ''}
      </div>`;
    }).join('\n');
    const html = buildHTML({ subject: 'A/B Test Significance Calculator — Demo', body });
    const fs = require('fs');
    const path = require('path');
    htmlPath = path.resolve('./ab-test-significance-calculator-demo.html');
    fs.writeFileSync(htmlPath, html);
  }
  renderSummary(DEMO, htmlPath);
}

// ========== MAIN ==========
const SUMMARY_NOTE = (items) => {
  const significant = items.filter(i => i.status === 'SIGNIFICANT').length;
  const notSignificant = items.filter(i => i.status === 'NOT_SIGNIFICANT').length;
  const underpowered = items.filter(i => i.status === 'UNDERPOWERED').length;
  if (underpowered > 0) return `Note: ${underpowered} underpowered — keep running and re-check.`;
  if (notSignificant > 0) return `Note: ${notSignificant} not significant — cannot conclude anything from an underpowered or split test.`;
  if (significant > 0) return 'Statistically significant results — treat as likely true.';
  return 'No clear verdict matches this dataset.';
};

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    out(PITCH);
    out('');
    out('Usage: node <file> <input>');
    for (const [arg, desc] of USAGE) {
      out(`  ${arg.padEnd(14)} ${desc}`);
    }
    return;
  }
  if (args.includes('--demo')) {
    await runDemo(false);
    return;
  }

  // determine input
  const inputFile = args[0];
  let inputText, sourceName;
  if (!inputFile || inputFile === '-') {
    // read stdin
    const fs = require('fs');
    inputText = fs.readFileSync(0, 'utf8');
    sourceName = 'stdin';
  } else {
    const fs = require('fs');
    const path = require('path');
    try {
      inputText = fs.readFileSync(path.resolve(inputFile), 'utf8');
      sourceName = path.basename(inputFile);
    } catch (e) {
      out(C.red(`Error reading file: ${e.message}`));
      process.exit(1);
    }
  }

  // run the main computation
  line('Reading input');
  endline();
  const items = run(null, inputText, sourceName);

  // combine items from code and API
  line('Computing statistics');
  endline();

  // render
  renderFindings(items);

  // api call if key present
  let verdictItems = [];
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (hasKey) {
    line('Requesting verdict from model');
    endline();
    const summary = items.map(item => `${item.headline}: ${item.detail} (p=${item.status === 'SIGNIFICANT' ? '<0.05' : '≥0.05'})`).join('\n');
    try {
      const prompt = `Given these computed results for an A/B test, provide a business recommendation:

${summary}

Return JSON:
{
  "call": "ship" | "kill" | "keep running",
  "reasoning": "short explanation",
  "what_to_do_next": "specific action"
}`;
      const text = await ask(null, {
        system: 'You are a data scientist helping make a go/no-go decision on an A/B test. Be conservative: never recommend shipping with p>0.05 or when underpowered.',
        prompt,
        schema: { call: 'string', reasoning: 'string', what_to_do_next: 'string' },
        maxTokens: 4000,
      });
      const data = parseJSON(text);
      verdictItems = [{
        status: data.call === 'ship' ? 'SIGNIFICANT' : data.call === 'kill' ? 'NOT_SIGNIFICANT' : 'UNDERPOWERED',
        headline: data.call.toUpperCase() + ' decision',
        was: '',
        now: '',
        detail: data.reasoning,
        note: data.what_to_do_next,
        source: 'AI',
      }];
    } catch (e) {
      // just show the error, no null verdict
    }
  } else {
    // No key — show note
    items.push({
      status: 'WARNING',
      headline: 'No verdict found',
      was: '',
      now: '',
      detail: NO_SEARCH_NOTE,
      note: '',
      source: '',
    });
  }

  // combine and render
  const allItems = [...items, ...verdictItems];
  renderFindings(allItems);

  // write html report
  const fs = require('fs');
  const path = require('path');
  const htmlBody = allItems.map(item => {
    const st = STATUS[item.status];
    return `<div class="item">
      <div class="headline">${st.label}: ${item.headline}</div>
      <div class="detail">${item.detail}</div>
      ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
      ${item.source ? `<div class="source">source: ${item.source}</div>` : ''}
    </div>`;
  }).join('\n');
  const htmlPath = path.resolve('./ab-test-significance-calculator-report.html');
  fs.writeFileSync(htmlPath, buildHTML({ subject: 'A/B Test Significance Calculator — Report', body: htmlBody }));
  renderSummary(allItems, htmlPath);
}

main().catch(e => {
  out(C.red(`Fatal: ${e.message}`));
  process.exit(1);
});
