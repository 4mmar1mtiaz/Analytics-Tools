#!/usr/bin/env node

// Ammar Imtiaz
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz

// ---- COLOUR FUNCTIONS (C) ----
const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  teal: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  text: (s) => s,
};

// ---- HELPERS ----
const PITCH = 'Compares two landing pages or two sets of metrics side-by-side and explains which performs better.';
const USAGE = [
  ['<url1> <url2>', 'compare two landing pages'],
  ['<metricsA> <metricsB>', 'compare two comma- or space-separated metric rows'],
  ['-', 'read two lines from stdin'],
  ['--demo', 'show demo output without API calls'],
  ['--help', 'show this message'],
];
const STATUS = {
  A_WINS: { glyph: '>', color: C.green, label: 'A Wins' },
  B_WINS: { glyph: '<', color: C.amber, label: 'B Wins' },
  TIE: { glyph: '=', color: C.teal, label: 'Tie' },
  WINNER: { glyph: '*', color: C.green, label: 'Winner' },
  BORROW: { glyph: '+', color: C.teal, label: 'Borrow' },
  FAIL: { glyph: '!', color: C.red, label: 'Fail' },
};
const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'Action';
const NO_SEARCH_NOTE = 'No API key found — all measurements computed locally, but no AI-generated insight was retrieved.';

// ---- TEXT HELPERS ----
function bold(text) { return `\x1b[1m${text}\x1b[0m`; }

function bar(i, total) {
  const w = 20;
  const filled = Math.round((i + 1) / total * w);
  return '[' + '#'.repeat(filled) + '-'.repeat(w - filled) + ']';
}

function wrap(text, width) {
  if (!text || width < 1) return text;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line += (line ? ' ' : '') + w;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

function clip(text, n) {
  if (!text || text.length <= n) return text || '';
  return text.slice(0, n - 3) + '...';
}

function pad(text, n) {
  const s = String(text);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ---- PROGRESS LINE ----
let lastLine = '';
function line(text) {
  const clear = ' '.repeat(lastLine.length);
  process.stdout.write('\r' + clear + '\r' + text);
  lastLine = text;
}

function endline() {
  process.stdout.write('\n');
  lastLine = '';
}

function out(text) {
  console.log(text);
}

// ---- PARSE JSON ----
function parseJSON(text) {
  if (!text || typeof text !== 'string') throw new Error('No text to parse');
  // direct parse
  try { return JSON.parse(text); } catch (_) {}
  // fenced code block
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch (_) {}
  }
  // brace scan
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  throw new Error('Cannot parse JSON from: ' + text.slice(0, 200));
}

// ---- MAP LIMIT ----
async function mapLimit(items, limit, fn) {
  const results = [];
  const queue = items.slice();
  const running = [];
  let index = 0;
  while (queue.length) {
    while (running.length < limit && queue.length) {
      const item = queue.shift();
      const i = index++;
      running.push(
        fn(item, i).then((r) => { results[i] = r; }).catch((e) => { results[i] = e; })
      );
    }
    if (running.length) {
      await Promise.race(running);
      running.splice(0, running.length, ...running.filter(p => {
        // we need to know which resolved - use a trick
        return true; // simplified - we await all at end
      }));
    }
  }
  await Promise.all(running);
  return results;
}

// ---- ASK (single model call) ----
async function ask(P, { system, prompt, schema, search, maxTokens }) {
  let key, provider, url;
  if (process.env.ANTHROPIC_API_KEY) {
    key = process.env.ANTHROPIC_API_KEY;
    provider = 'anthropic';
    url = 'https://api.anthropic.com/v1/messages';
  } else if (process.env.OPENAI_API_KEY) {
    key = process.env.OPENAI_API_KEY;
    provider = 'openai';
    url = 'https://api.openai.com/v1/chat/completions';
  } else if (process.env.GEMINI_API_KEY) {
    key = process.env.GEMINI_API_KEY;
    provider = 'gemini';
    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=' + key;
  } else {
    throw new Error('No API key found');
  }
  line(`  ${C.dim('→')} Calling ${provider}...`);
  const body = provider === 'anthropic' ? {
    model: 'claude-3-haiku-20240307',
    max_tokens: maxTokens || 4096,
    system: system || '',
    messages: [{ role: 'user', content: prompt }],
  } : provider === 'openai' ? {
    model: 'gpt-4o-mini',
    max_tokens: maxTokens || 4096,
    messages: [
      { role: 'system', content: system || '' },
      { role: 'user', content: prompt },
    ],
  } : {
    contents: [{ parts: [{ text: (system ? system + '\n' : '') + prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens || 4096 },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: provider === 'gemini' ? { 'Content-Type': 'application/json' } :
      { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  if (provider === 'anthropic') return json.content?.[0]?.text || '';
  if (provider === 'openai') return json.choices?.[0]?.message?.content || '';
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ---- RENDER FINDINGS ----
function renderFindings(items) {
  const maxLabelLen = Math.max(...Object.values(STATUS).map(s => s.label.length));
  for (const item of items) {
    const st = STATUS[item.status] || STATUS.FAIL;
    const label = pad(st.label, maxLabelLen);
    const glyph = st.glyph;
    const colorFn = st.color;
    const headline = clip(item.headline, 60);
    const was = item.was ? `was ${item.was}` : '';
    const now = item.now ? `now ${item.now}` : '';
    const detail = item.detail;
    const note = item.note ? ` → ${item.note}` : '';
    const source = item.source ? ` [${item.source}]` : '';
    const line1 = ` ${colorFn(glyph)} ${colorFn(label)} ${bold(headline)}`;
    const line2 = was || now ? `    ${was}  ${now}` : '';
    const line3 = `    ${wrap(detail, 72)}`;
    const line4 = note ? `    ${C.dim(note)}` : '';
    const line5 = source ? `    ${C.dim(source)}` : '';
    out(line1);
    if (line2) out(line2);
    out(line3);
    if (line4) out(line4);
    if (line5) out(line5);
    out('');
  }
}

// ---- RENDER SUMMARY ----
function renderSummary(items, htmlPath) {
  const counts = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }
  out(C.dim('─'.repeat(40)));
  const total = items.length;
  out(` ${bold('Summary:')} ${total} ${ITEM_NOUN}${total !== 1 ? 's' : ''}`);
  for (const [key, count] of Object.entries(counts)) {
    const st = STATUS[key];
    if (st) out(`   ${st.glyph} ${st.label}: ${count}`);
  }
  if (htmlPath) {
    out(` ${C.green('✓')} HTML report written to ${C.teal(htmlPath)}`);
  } else {
    out(` ${C.dim('(no HTML file written)')}`);
  }
  out('');
}

// ---- BUILD HTML ----
function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Landing Page Comparator</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; background: #f8f9fa; color: #333; }
h1 { font-size: 1.8em; border-bottom: 2px solid #dee2e6; padding-bottom: 0.3em; }
.item { background: #fff; border-radius: 8px; padding: 1em 1.2em; margin-bottom: 1em; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.item .status { display: inline-block; font-weight: bold; margin-right: 0.5em; }
.item .headline { font-weight: bold; font-size: 1.1em; }
.item .detail { margin: 0.5em 0; color: #555; }
.item .note { color: #0d6efd; font-style: italic; }
.item .source { color: #6c757d; font-size: 0.85em; }
.item .wasnow { color: #495057; background: #e9ecef; padding: 0.2em 0.5em; border-radius: 4px; display: inline-block; margin: 0.3em 0; }
.summary { background: #e9ecef; border-radius: 8px; padding: 1em; margin-top: 2em; }
.A_WINS { border-left: 4px solid #28a745; }
.B_WINS { border-left: 4px solid #ffc107; }
.TIE { border-left: 4px solid #17a2b8; }
.WINNER { border-left: 4px solid #28a745; }
.BORROW { border-left: 4px solid #17a2b8; }
.FAIL { border-left: 4px solid #dc3545; }
</style>
</head>
<body>
<h1>${subject}</h1>
${body}
</body>
</html>`;
}

// ---- DEMO DATA ----
const DEMO = [
  { status: 'A_WINS', headline: 'Conversion Rate: 3.2% vs 2.1%', was: '3.2%', now: '2.1%', detail: 'Page A converts 52% more visitors than Page B. A two-proportion z-test yields z=2.14, p=0.032 — statistically significant at the 95% confidence level.', note: 'Keep A as the primary landing page.', source: 'https://example.com/page-a vs https://example.com/page-b' },
  { status: 'B_WINS', headline: 'Average Session Duration: 4:12 vs 3:05', was: '3:05', now: '4:12', detail: 'Visitors on Page B stay 36% longer. The longer session suggests better engagement with the interactive demo.', note: 'Consider adding a demo to Page A.', source: 'https://example.com/page-a vs https://example.com/page-b' },
  { status: 'TIE', headline: 'Bounce Rate: 42% vs 43%', was: '42%', now: '43%', detail: 'Both pages have nearly identical bounce rates. The 1% difference is within the margin of error and not statistically significant.', note: '', source: 'https://example.com/page-a vs https://example.com/page-b' },
  { status: 'WINNER', headline: 'Overall Winner: Page A', was: '', now: '', detail: 'Based on the statistically significant conversion advantage and comparable engagement metrics, Page A is the recommended winner. Page B offers a longer session that may inform future A/B test iterations.', note: 'Run a follow-up test adding Page B\'s demo to Page A.', source: '' },
  { status: 'BORROW', headline: 'Trust Signals: Testimonials Section', was: '', now: '', detail: 'Page B features a dedicated testimonials carousel with 6 customer logos and 3 video testimonials. Page A only shows one text quote in the footer.', note: 'Add a testimonials section above the fold on Page A.', source: 'https://example.com/page-b#testimonials' },
  { status: 'FAIL', headline: 'Could not fetch Page B', was: '', now: '', detail: 'HTTP 503 from https://example.com/page-b at 2025-01-15T10:30:00Z. The server returned a Service Unavailable response.', note: 'Retry when the page is accessible.', source: 'https://example.com/page-b' },
];

async function runDemo(writeHTML) {
  out(` ${C.dim('→')} Demo mode — no API calls`);
  await new Promise(r => setTimeout(r, 300));
  line(`  ${bar(0, 6)} Fetching Page A...`);
  await new Promise(r => setTimeout(r, 200));
  line(`  ${bar(1, 6)} Fetching Page B...`);
  await new Promise(r => setTimeout(r, 200));
  line(`  ${bar(2, 6)} Measuring metrics...`);
  await new Promise(r => setTimeout(r, 200));
  line(`  ${bar(3, 6)} Computing statistics...`);
  await new Promise(r => setTimeout(r, 200));
  line(`  ${bar(4, 6)} Analyzing results...`);
  await new Promise(r => setTimeout(r, 200));
  line(`  ${bar(5, 6)} Generating report...`);
  await new Promise(r => setTimeout(r, 200));
  endline();
  renderFindings(DEMO);
  let htmlPath = null;
  if (writeHTML) {
    const itemsHtml = DEMO.map(item => {
      const st = STATUS[item.status] || STATUS.FAIL;
      const wasnow = item.was || item.now ? `<div class="wasnow">was ${item.was || '—'} → now ${item.now || '—'}</div>` : '';
      const note = item.note ? `<div class="note">→ ${item.note}</div>` : '';
      const source = item.source ? `<div class="source">${item.source}</div>` : '';
      return `<div class="item ${item.status}"><div class="status" style="color:${st.color('x').replace('x','').replace('\x1b[0m','').replace('\x1b[32m','green').replace('\x1b[33m','orange').replace('\x1b[31m','red').replace('\x1b[36m','teal')}">${st.glyph} ${st.label}</div><div class="headline">${item.headline}</div>${wasnow}<div class="detail">${item.detail}</div>${note}${source}</div>`;
    }).join('\n');
    const html = buildHTML({ subject: 'Landing Page Comparator — Demo Report', body: itemsHtml + '<div class="summary"><p>This is a demo report. No live data was fetched.</p></div>' });
    require('fs').writeFileSync('./landing-page-comparator-demo.html', html, 'utf-8');
    htmlPath = './landing-page-comparator-demo.html';
  }
  renderSummary(DEMO, htmlPath);
}

// ---- RUN ----
async function run(input, sourceName) {
  const lines = input.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    return [{ status: 'FAIL', headline: 'Need two items to compare', was: '', now: '', detail: 'Provide two URLs or two rows of metrics separated by whitespace or commas.', note: 'Use --help for usage.', source: sourceName }];
  }

  const parts = lines.slice(0, 2).map(l => l.trim().split(/[,\s]+/).filter(Boolean));
  const sideA = parts[0];
  const sideB = parts[1];

  const items = [];
  const isURL = (s) => /^https?:\/\//i.test(s);

  if (sideA.length === 1 && sideB.length === 1 && isURL(sideA[0]) && isURL(sideB[0])) {
    // URL comparison
    line(`  ${bar(0, 4)} Fetching ${sideA[0]}...`);
    let pageA, pageB;
    try {
      const res = await fetch(sideA[0]);
      pageA = { url: sideA[0], html: await res.text(), status: res.status };
    } catch (e) {
      items.push({ status: 'FAIL', headline: `Could not fetch ${sideA[0]}`, was: '', now: '', detail: e.message, note: 'Skipping page A', source: sideA[0] });
      pageA = null;
    }
    line(`  ${bar(1, 4)} Fetching ${sideB[0]}...`);
    try {
      const res = await fetch(sideB[0]);
      pageB = { url: sideB[0], html: await res.text(), status: res.status };
    } catch (e) {
      items.push({ status: 'FAIL', headline: `Could not fetch ${sideB[0]}`, was: '', now: '', detail: e.message, note: 'Skipping page B', source: sideB[0] });
      pageB = null;
    }

    if (pageA && pageB) {
      line(`  ${bar(2, 4)} Measuring...`);
      // Extract metrics
      const extract = (html, url) => {
        const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
        const h1 = (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1] || '';
        const wordCount = html.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
        const ctaCount = (html.match(/button|cta|sign.?up|register|start|download/i) || []).length;
        const formFields = (html.match(/<input[^>]*type=(?:text|email|password|tel|number)/gi) || []).length;
        const trustSignals = (html.match(/trust|secure|ssl|guarantee|testimonial|review|rating/i) || []).length;
        return { title, h1, wordCount, ctaCount, formFields, trustSignals, url };
      };
      const mA = extract(pageA.html, pageA.url);
      const mB = extract(pageB.html, pageB.url);

      // Comparison items
      const comps = [
        { label: 'Page Title', key: 'title', was: mA.title, now: mB.title, fmt: (v) => v },
        { label: 'H1 Heading', key: 'h1', was: mA.h1, now: mB.h1, fmt: (v) => v },
        { label: 'Word Count', key: 'wordCount', was: mA.wordCount, now: mB.wordCount, fmt: (v) => String(v) },
        { label: 'CTA Count', key: 'ctaCount', was: mA.ctaCount, now: mB.ctaCount, fmt: (v) => String(v) },
        { label: 'Form Fields', key: 'formFields', was: mA.formFields, now: mB.formFields, fmt: (v) => String(v) },
        { label: 'Trust Signals', key: 'trustSignals', was: mA.trustSignals, now: mB.trustSignals, fmt: (v) => String(v) },
      ];
      for (const c of comps) {
        const a = c.was;
        const b = c.now;
        const diff = typeof a === 'number' && typeof b === 'number' ? b - a : 0;
        const pct = typeof a === 'number' && a !== 0 ? ((b - a) / a * 100).toFixed(1) : 'N/A';
        const winner = diff > 0 ? 'B' : diff < 0 ? 'A' : 'tie';
        const status = winner === 'tie' ? 'TIE' : winner === 'A' ? 'A_WINS' : 'B_WINS';
        const headline = `${c.label}: ${c.fmt(a)} vs ${c.fmt(b)}`;
        const detail = diff !== 0 ? `Difference: ${diff > 0 ? '+' : ''}${diff} (${pct}%). ${winner} wins.` : 'Both sides equal.';
        items.push({ status, headline, was: c.fmt(a), now: c.fmt(b), detail, note: '', source: `${mA.url} vs ${mB.url}` });
      }
    }
  } else {
    // Metric row comparison
    const parseRow = (row) => {
      const nums = row.map(Number).filter(n => !isNaN(n));
      if (nums.length < 4) return null;
      return { sessions: nums[0], engagement: nums[1], conversions: nums[2], rate: nums[3] };
    };
    const mA = parseRow(sideA);
    const mB = parseRow(sideB);
    if (!mA || !mB) {
      return [{ status: 'FAIL', headline: 'Invalid metric rows', was: '', now: '', detail: 'Each row needs at least 4 numbers: sessions, engagement score, conversions, conversion rate.', note: 'Check your input.', source: sourceName }];
    }

    // Compute metrics
    const metrics = [
      { label: 'Sessions', was: mA.sessions, now: mB.sessions },
      { label: 'Engagement Score', was: mA.engagement, now: mB.engagement },
      { label: 'Conversions', was: mA.conversions, now: mB.conversions },
      { label: 'Conversion Rate', was: mA.rate, now: mB.rate },
    ];
    for (const m of metrics) {
      const diff = m.now - m.was;
      const pct = m.was !== 0 ? ((m.now - m.was) / m.was * 100).toFixed(1) : 'N/A';
      const winner = diff > 0 ? 'B' : diff < 0 ? 'A' : 'tie';
      const status = winner === 'tie' ? 'TIE' : winner === 'A' ? 'A_WINS' : 'B_WINS';
      const headline = `${m.label}: ${m.was} vs ${m.now}`;
      const detail = diff !== 0 ? `Difference: ${diff > 0 ? '+' : ''}${diff} (${pct}%). ${winner} wins.` : 'Both sides equal.';
      items.push({ status, headline, was: String(m.was), now: String(m.now), detail, note: '', source: sourceName });
    }

    // Z-test for conversion rate (two-proportion)
    if (mA.sessions > 0 && mB.sessions > 0) {
      const p1 = mA.conversions / mA.sessions;
      const p2 = mB.conversions / mB.sessions;
      const pPool = (mA.conversions + mB.conversions) / (mA.sessions + mB.sessions);
      const se = Math.sqrt(pPool * (1 - pPool) * (1/mA.sessions + 1/mB.sessions));
      const z = (p1 - p2) / se;
      const pValue = 2 * (1 - normalCDF(Math.abs(z)));
      const sig = pValue < 0.05;
      const diff = (p2 - p1) * 100;
      const winner = diff > 0 ? 'B' : diff < 0 ? 'A' : 'tie';
      const status = sig ? (winner === 'A' ? 'A_WINS' : winner === 'B' ? 'B_WINS' : 'TIE') : 'TIE';
      items.push({
        status,
        headline: `Conversion Rate (z-test): ${(p1*100).toFixed(1)}% vs ${(p2*100).toFixed(1)}%`,
        was: `${(p1*100).toFixed(1)}%`,
        now: `${(p2*100).toFixed(1)}%`,
        detail: `Two-proportion z-test: z=${z.toFixed(3)}, p=${pValue.toFixed(4)}. ${sig ? 'Statistically significant at 95% confidence.' : 'Not statistically significant.'} ${winner !== 'tie' ? `${winner} wins.` : 'Tie.'}`,
        note: '',
        source: sourceName,
      });
    }
  }

  // If no API key, add note
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!hasKey) {
    items.push({ status: 'FAIL', headline: 'No API key configured', was: '', now: '', detail: NO_SEARCH_NOTE, note: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY to enable AI insights.', source: '' });
  } else if (items.length > 0) {
    // Make single ask() call for analysis
    try {
      const table = items.map(i => `${i.status}: ${i.headline} (was ${i.was}, now ${i.now})`).join('\n');
      const prompt = `Given this comparison data:\n${table}\n\nWho is the overall winner and why? Return JSON with keys: winner (string), why (string), borrow (array of {from_page, element, apply_to}).`;
      const text = await ask(null, { system: 'You are a landing page optimization expert. Analyze the data and return JSON only.', prompt, maxTokens: 6000 });
      const data = parseJSON(text);
      items.push({ status: 'WINNER', headline: `Overall Winner: ${data.winner}`, was: '', now: '', detail: data.why, note: '', source: '' });
      for (const b of (data.borrow || [])) {
        items.push({ status: 'BORROW', headline: `Borrow from ${b.from_page}: ${b.element}`, was: '', now: '', detail: `Apply to ${b.apply_to}: copy the ${b.element} from ${b.from_page}.`, note: '', source: '' });
      }
    } catch (e) {
      items.push({ status: 'FAIL', headline: 'AI analysis failed', was: '', now: '', detail: `Could not get AI insight: ${e.message}`, note: 'The computed metrics above are still valid.', source: '' });
    }
  }

  return items;
}

// ---- NORMAL CDF (for z-test) ----
function normalCDF(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// ---- MAIN ----
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    out(` ${bold('Landing Page Comparator')}`);
    out(` ${C.dim(PITCH)}`);
    out('');
    out(` ${bold('Usage:')} node ${require('path').basename(process.argv[1])} [options] <input>`);
    for (const [arg, desc] of USAGE) {
      out(`   ${C.teal(arg.padEnd(20))} ${desc}`);
    }
    return;
  }

  if (args.includes('--demo')) {
    await runDemo(true);
    return;
  }

  let input, sourceName;
  const nonFlagArgs = args.filter(a => !a.startsWith('--'));
  if (nonFlagArgs.length >= 2) {
    input = nonFlagArgs.join('\n');
    sourceName = nonFlagArgs.slice(0, 2).join(' ');
  } else if (nonFlagArgs.length === 1 && nonFlagArgs[0] === '-') {
    const fs = require('fs');
    input = fs.readFileSync('/dev/stdin', 'utf-8');
    sourceName = 'stdin';
  } else if (nonFlagArgs.length === 1) {
    const fs = require('fs');
    try {
      input = fs.readFileSync(nonFlagArgs[0], 'utf-8');
      sourceName = nonFlagArgs[0];
    } catch {
      out(C.red('Error:') + ` Cannot read file "${nonFlagArgs[0]}"`);
      return;
    }
  } else {
    out(C.red('Error:') + ' Provide two URLs, two metric rows, a file, or use --demo');
    return;
  }

  const items = await run(input, sourceName);
  renderFindings(items);

  // Write HTML report
  const itemsHtml = items.map(item => {
    const st = STATUS[item.status] || STATUS.FAIL;
    const colorMap = { 'green': '#28a745', 'amber': '#ffc107', 'red': '#dc3545', 'teal': '#17a2b8' };
    const colorName = st.color('x').includes('32') ? 'green' : st.color('x').includes('33') ? 'amber' : st.color('x').includes('31') ? 'red' : 'teal';
    const wasnow = item.was || item.now ? `<div class="wasnow">was ${item.was || '—'} → now ${item.now || '—'}</div>` : '';
    const note = item.note ? `<div class="note">→ ${item.note}</div>` : '';
    const source = item.source ? `<div class="source">${item.source}</div>` : '';
    return `<div class="item ${item.status}"><div class="status" style="color:${colorMap[colorName]}">${st.glyph} ${st.label}</div><div class="headline">${item.headline}</div>${wasnow}<div class="detail">${item.detail}</div>${note}${source}</div>`;
  }).join('\n');
  const summaryCounts = {};
  for (const item of items) { summaryCounts[item.status] = (summaryCounts[item.status] || 0) + 1; }
  const summaryHtml = `<div class="summary"><h2>Summary</h2><p>${items.length} ${ITEM_NOUN}${items.length !== 1 ? 's' : ''}</p>` +
    Object.entries(summaryCounts).map(([k, v]) => `<p>${STATUS[k]?.glyph || '?'} ${STATUS[k]?.label || k}: ${v}</p>`).join('') + '</div>';

  const html = buildHTML({ subject: `Landing Page Comparator — ${sourceName}`, body: itemsHtml + summaryHtml });
  const htmlPath = `./landing-page-comparison-${Date.now()}.html`;
  require('fs').writeFileSync(htmlPath, html, 'utf-8');
  renderSummary(items, htmlPath);
}

main().catch(e => {
  out(C.red('Fatal error:') + ` ${e.message}`);
  process.exit(1);
});
