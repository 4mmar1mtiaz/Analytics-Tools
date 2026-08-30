#!/usr/bin/env node

// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz

// ============================================================
//  0.  GROUND — all helpers defined here, before any usage
// ============================================================

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// -----------------------------------------------------------
//  Colours  C
// -----------------------------------------------------------
const C = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  amber:  (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  teal:   (s) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  text:   (s) => s,
};

// -----------------------------------------------------------
//  bold, bar, wrap, clip, pad
// -----------------------------------------------------------
function bold(s) {
  return `\x1b[1m${s}\x1b[22m`;
}

function bar(i, total) {
  const width = 20;
  const filled = Math.round((i / total) * width);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

function wrap(text, width) {
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
  if (text.length <= n) return text;
  return text.slice(0, n - 3) + '...';
}

function pad(text, n) {
  const s = String(text);
  return s + ' '.repeat(Math.max(0, n - s.length));
}

// -----------------------------------------------------------
//  line / endline — overwritable progress line
// -----------------------------------------------------------
let _lastLineLen = 0;

function line(text) {
  // erase previous line
  if (_lastLineLen > 0) {
    process.stdout.write('\r' + ' '.repeat(_lastLineLen) + '\r');
  }
  process.stdout.write(text);
  _lastLineLen = text.length;
}

function endline() {
  process.stdout.write('\n');
  _lastLineLen = 0;
}

// -----------------------------------------------------------
//  out / console.log wrapper
// -----------------------------------------------------------
function out(text) {
  console.log(text);
}

// -----------------------------------------------------------
//  parseJSON  — JSON.parse, fenced-block fallback, brace-scan fallback
// -----------------------------------------------------------
function parseJSON(text) {
  // 1) direct parse
  try {
    return JSON.parse(text);
  } catch (_) {}

  // 2) fenced block: ```json ... ```  or  ``` ... ```
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (_) {}
  }

  // 3) brace-scan: find first '{' and last '}'
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  throw new Error('parseJSON: could not extract JSON from text');
}

// -----------------------------------------------------------
//  mapLimit
// -----------------------------------------------------------
async function mapLimit(items, limit, fn) {
  const results = [];
  const queue = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// -----------------------------------------------------------
//  ask  — one model call over https; uses ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY
// -----------------------------------------------------------
async function ask(promptObj, { system, prompt, schema, search, maxTokens } = {}) {
  // Merge promptObj and options
  const sys = system || promptObj.system || '';
  const userPrompt = prompt || promptObj.prompt || '';
  const maxT = maxTokens || promptObj.maxTokens || 4096;
  const useSearch = search !== undefined ? search : (promptObj.search !== undefined ? promptObj.search : false);

  let apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  let provider = '';
  if (process.env.ANTHROPIC_API_KEY) provider = 'anthropic';
  else if (process.env.OPENAI_API_KEY) provider = 'openai';
  else if (process.env.GEMINI_API_KEY) provider = 'gemini';

  if (!apiKey) {
    throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
  }

  // Build messages array
  const messages = [];
  if (sys) {
    if (provider === 'anthropic') {
      messages.push({ role: 'user', content: sys + '\n\n' + userPrompt });
      // Anthropic uses system as separate parameter
    } else {
      messages.push({ role: 'system', content: sys });
      messages.push({ role: 'user', content: userPrompt });
    }
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  // Add schema instruction if present
  let finalPrompt = userPrompt;
  if (schema) {
    const schemaStr = JSON.stringify(schema, null, 2);
    finalPrompt = userPrompt + `\n\nRespond with JSON matching this schema:\n${schemaStr}`;
  }

  // Different API calls
  if (provider === 'anthropic') {
    return await askAnthropic(apiKey, sys, finalPrompt, maxT);
  } else if (provider === 'openai') {
    return await askOpenAI(apiKey, sys, finalPrompt, maxT);
  } else if (provider === 'gemini') {
    return await askGemini(apiKey, sys, finalPrompt, maxT);
  }
  throw new Error('Unknown provider');
}

async function askAnthropic(apiKey, system, prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.content && parsed.content[0] && parsed.content[0].text) {
            resolve(parsed.content[0].text);
          } else {
            reject(new Error('Anthropic: unexpected response: ' + body));
          }
        } catch (e) {
          reject(new Error('Anthropic: parse error: ' + body));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function askOpenAI(apiKey, system, prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const data = JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      messages,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error('OpenAI: unexpected response: ' + body));
          }
        } catch (e) {
          reject(new Error('OpenAI: parse error: ' + body));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function askGemini(apiKey, system, prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const contents = [];
    if (system) {
      contents.push({ role: 'user', parts: [{ text: system + '\n\n' + prompt }] });
    } else {
      contents.push({ role: 'user', parts: [{ text: prompt }] });
    }

    const data = JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content) {
            const text = parsed.candidates[0].content.parts.map(p => p.text).join('');
            resolve(text);
          } else {
            reject(new Error('Gemini: unexpected response: ' + body));
          }
        } catch (e) {
          reject(new Error('Gemini: parse error: ' + body));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// -----------------------------------------------------------
//  renderFindings  — prints items to terminal
// -----------------------------------------------------------
function renderFindings(items) {
  for (const item of items) {
    const st = STATUS[item.status];
    if (!st) continue;
    const glyph = st.glyph;
    const colorFn = st.color || C.text;
    const label = st.label;

    const line1 = ` ${colorFn(glyph)} ${C.dim(label)}  ${bold(item.headline)}`;
    out(line1);

    const detail = wrap(item.detail, 72);
    for (const dline of detail.split('\n')) {
      out('   ' + C.dim(dline));
    }

    if (item.was || item.now) {
      out(`   ${C.dim('was:')} ${item.was || '—'}  ${C.dim('now:')} ${item.now || '—'}`);
    }
    if (item.note) {
      out(`   ${C.dim('→')} ${item.note}`);
    }
    if (item.source) {
      out(`   ${C.teal('source:')} ${item.source}`);
    }
    out('');
  }
}

// -----------------------------------------------------------
//  renderSummary  — tally line + maybe html path
// -----------------------------------------------------------
function renderSummary(items, htmlPath) {
  const tally = {};
  for (const item of items) {
    tally[item.status] = (tally[item.status] || 0) + 1;
  }
  const parts = [];
  for (const key of Object.keys(STATUS)) {
    if (tally[key]) {
      const st = STATUS[key];
      const colorFn = st.color || C.text;
      parts.push(colorFn(`${st.label}:${tally[key]}`));
    }
  }
  out(parts.join('  '));

  if (htmlPath) {
    out(C.teal(`HTML report: ${htmlPath}`));
  }
  const note = SUMMARY_NOTE(items);
  if (note) out(C.dim(note));
}

// -----------------------------------------------------------
//  buildHTML  — returns standalone HTML string
// -----------------------------------------------------------
function buildHTML({ subject, body }) {
  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const rows = body.map(item => {
    const st = STATUS[item.status] || { glyph: '?', label: 'UNKNOWN', color: () => '' };
    return `<tr>
      <td>${esc(st.glyph)} ${esc(st.label)}</td>
      <td><strong>${esc(item.headline)}</strong></td>
      <td>${esc(item.detail)}</td>
      <td>${item.was ? esc(item.was) : '—'}</td>
      <td>${item.now ? esc(item.now) : '—'}</td>
      <td>${item.note ? esc(item.note) : ''}</td>
      <td>${item.source ? `<a href="${esc(item.source)}">${esc(item.source)}</a>` : ''}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Landing Page Performance Grader — ${esc(subject)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 2em; color: #222; background: #f9f9f9; }
  h1 { color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 0.75em 1em; text-align: left; border-bottom: 1px solid #e0e0e0; }
  th { background: #f0f0f0; font-weight: 600; }
  tr:hover { background: #f5f5f5; }
  a { color: #0066cc; }
  .footer { margin-top: 1em; color: #888; font-size: 0.9em; }
</style>
</head>
<body>
<h1>Landing Page Performance Grader</h1>
<p><strong>Subject:</strong> ${esc(subject)}</p>
<table>
<thead><tr><th>Status</th><th>Finding</th><th>Detail</th><th>Was</th><th>Now</th><th>Note</th><th>Source</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="footer">Generated by landing-page-grader.js</div>
</body>
</html>`;
}

// ============================================================
//  Constants & Declarations
// ============================================================

const PITCH = 'Grades a landing page on traffic, engagement, conversion, and page mechanics, then recommends fixes.';

const USAGE = [
  ['<url>', 'Grade a live landing page (fetches HTML)'],
  ['<sessions>,<bounce%>,<avg_time_sec>,<conversions>,<conv_rate%>', 'Grade from provided metrics'],
  ['-', 'Read from stdin (same format as above)'],
  ['--demo', 'See demo output with no API key or network calls'],
  ['--help', 'Show this usage information'],
];

const STATUS = {
  A:    { glyph: '+', color: C.green, label: 'PASS'    },
  B:    { glyph: '+', color: C.green, label: 'PASS'    },
  C:    { glyph: '~', color: C.amber, label: 'WARN'    },
  D:    { glyph: '~', color: C.amber, label: 'WARN'    },
  F:    { glyph: '-', color: C.red,   label: 'FAIL'    },
  FIX:  { glyph: '>', color: C.teal,  label: 'FIX'     },
  FAIL: { glyph: '!', color: C.red,   label: 'ERROR'   },
};

const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'Impact';
const NO_SEARCH_NOTE = 'No API key was set; all scores were computed locally but the AI-powered fix recommendations are absent.';

const SUMMARY_NOTE = (items) => {
  const fixCount = items.filter(i => i.status === 'FIX').length;
  if (fixCount > 0) return `${fixCount} recommended fix${fixCount > 1 ? 'es' : ''} — sort by expected lift over effort.`;
  return '';
};

// Grade thresholds
const TRAFFIC_VOLUME_BENCHMARK = 10000; // sessions per month
const ENGAGEMENT_RATE_BENCHMARK = 0.4; // 40%
const TIME_ON_PAGE_BENCHMARK = 120; // seconds
const CONVERSION_RATE_MEDIAN = 0.02; // 2%
const TITLE_MIN_WORDS = 4;
const H1_MIN_COUNT = 1;
const WORD_COUNT_MIN = 300;
const FORM_FIELD_MIN = 1;
const IMAGE_WEIGHT_MAX_KB = 500;
const RENDER_BLOCKING_SCRIPTS_MAX = 2;

function letterForScore(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ============================================================
//  DEMO
// ============================================================

const DEMO = [
  {
    status: 'B',
    headline: 'Traffic volume is moderate — 8,450 monthly sessions',
    was: '—',
    now: '8,450 / month',
    detail: 'Compared to a benchmark of 10,000 sessions per month, this page receives 84.5% of the target. The traffic score is 74/100 (C). The source is the Google Analytics 4 property for the domain.',
    note: 'Below benchmark by 1,550 sessions — consider SEO improvements or ad spend increase.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'C',
    headline: 'Engagement rate is 32% with average time 98 seconds',
    was: '—',
    now: '32% engaged, 98s avg time',
    detail: 'The engagement rate of 32% is below the 40% benchmark. Average time on page (98s) is also below 120 seconds. The engagement score is 68/100 (D). Users may not be finding compelling content above the fold.',
    note: 'Low engagement suggests poor content relevance or slow initial load.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'D',
    headline: 'Conversion rate is 1.1% — below the 2% median for lead pages',
    was: '—',
    now: '1.1% conversion rate',
    detail: 'With 112 conversions from 10,182 sessions, the conversion rate is 1.1%. This is significantly below the 2% median for B2B lead generation landing pages. The conversion score is 55/100 (F).',
    note: 'Nearly half the expected conversion rate — test CTAs, form length, and trust signals.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'F',
    headline: 'Page has 0 form fields — no lead capture mechanism',
    was: '—',
    now: '0 form fields detected',
    detail: 'The HTML parsing found zero <input>, <textarea>, or <select> elements. A landing page without a form cannot capture leads. The mechanics score is 45/100 (F).',
    note: 'Critical: add at minimum an email capture form with 2-3 fields.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'FIX',
    headline: 'Add a lead capture form with 2-3 fields above the fold',
    was: '0 fields',
    now: '3 fields',
    detail: 'Implement a name + email + company form with a clear CTA button. Place it above the fold and ensure it loads with the first paint. Expected lift: +1.5% conversion rate.',
    note: 'High impact, low effort — implement within 2 days.',
    source: '',
  },
  {
    status: 'FIX',
    headline: 'Increase engagement with a hero video or interactive demo',
    was: '32% engagement',
    now: '45% engagement (target)',
    detail: 'Adding a 60-second product demo video or an interactive calculator has been shown to increase engagement rates by 10-15 percentage points. Expected lift: +0.8% conversion.',
    note: 'Medium effort (3-5 days) with moderate confidence.',
    source: '',
  },
];

// ============================================================
//  runDemo
// ============================================================
async function runDemo(writeHTML) {
  line('🔍 Demo: analysing example landing page...');
  await new Promise(r => setTimeout(r, 300));
  endline();

  line('📊 Computing traffic score...');
  await new Promise(r => setTimeout(r, 200));
  endline();

  line('📈 Computing engagement score...');
  await new Promise(r => setTimeout(r, 200));
  endline();

  line('📉 Computing conversion score...');
  await new Promise(r => setTimeout(r, 200));
  endline();

  line('⚙️ Analysing page mechanics...');
  await new Promise(r => setTimeout(r, 200));
  endline();

  line('🤖 Requesting AI fix recommendations (simulated)...');
  await new Promise(r => setTimeout(r, 400));
  endline();

  renderFindings(DEMO);

  let htmlPath = null;
  if (writeHTML) {
    htmlPath = './landing-page-performance-grader-demo.html';
    const html = buildHTML({ subject: 'Demo Landing Page (example.com)', body: DEMO });
    fs.writeFileSync(htmlPath, html, 'utf8');
  }

  renderSummary(DEMO, htmlPath);
}

// ============================================================
//  run  — main logic
// ============================================================
async function run(input, sourceName) {
  const items = [];
  let metricsMode = false;
  let url = null;
  let sessions, bounceRate, engagementRate, avgTime, conversions, conversionRate;

  // Determine mode
  if (input.startsWith('http://') || input.startsWith('https://')) {
    url = input;
  } else {
    // Try to parse as CSV metrics: sessions,bounce%,engagement%,avg_time_sec,conversions,conv_rate%
    const parts = input.split(',').map(s => s.trim());
    if (parts.length === 6) {
      sessions = parseFloat(parts[0]);
      bounceRate = parseFloat(parts[1]);
      engagementRate = parseFloat(parts[2]);
      avgTime = parseFloat(parts[3]);
      conversions = parseFloat(parts[4]);
      conversionRate = parseFloat(parts[5]);
      if (!isNaN(sessions) && !isNaN(conversionRate)) {
        metricsMode = true;
      }
    }
    if (!metricsMode) {
      // Maybe a URL without scheme? Add https://
      if (input.includes('.') && !input.includes(' ')) {
        url = 'https://' + input;
      } else {
        throw new Error('Input must be a URL or 6 comma-separated metrics.');
      }
    }
  }

  out(C.dim(`Mode: ${metricsMode ? 'metrics-based' : 'URL fetch'} — source: ${sourceName}`));

  // ----- TRAFFIC -----
  let trafficScore = 0;
  if (metricsMode) {
    // Use sessions directly
    trafficScore = Math.min(100, Math.round((sessions / TRAFFIC_VOLUME_BENCHMARK) * 100));
  } else {
    // No way to know traffic from URL alone — assume unknown
    trafficScore = 50; // neutral
  }
  const trafficLetter = letterForScore(trafficScore);
  items.push({
    status: trafficLetter,
    headline: `Traffic volume score: ${trafficScore}/100 (${trafficLetter})`,
    was: metricsMode ? `${sessions} sessions` : 'unknown',
    now: `${trafficScore}/100`,
    detail: metricsMode
      ? `Based on ${sessions} sessions against a benchmark of ${TRAFFIC_VOLUME_BENCHMARK}. Score is ${trafficScore}/100.`
      : 'No session data available — traffic score defaulted to 50/100. Provide metrics for accurate grading.',
    note: metricsMode ? (trafficScore < 70 ? 'Below benchmark — consider scaling efforts.' : '') : '',
    source: sourceName,
  });

  // ----- ENGAGEMENT -----
  let engagementScore = 0;
  if (metricsMode) {
    const engRateScore = Math.min(100, Math.round((engagementRate / ENGAGEMENT_RATE_BENCHMARK) * 100));
    const timeScore = Math.min(100, Math.round((avgTime / TIME_ON_PAGE_BENCHMARK) * 100));
    engagementScore = Math.round((engRateScore + timeScore) / 2);
  } else {
    engagementScore = 50; // neutral
  }
  const engagementLetter = letterForScore(engagementScore);
  items.push({
    status: engagementLetter,
    headline: `Engagement score: ${engagementScore}/100 (${engagementLetter})`,
    was: metricsMode ? `${engagementRate}% engagement, ${avgTime}s avg time` : 'unknown',
    now: `${engagementScore}/100`,
    detail: metricsMode
      ? `Engagement rate ${engagementRate}% vs benchmark ${ENGAGEMENT_RATE_BENCHMARK*100}%; avg time ${avgTime}s vs ${TIME_ON_PAGE_BENCHMARK}s.`
      : 'No engagement data — defaulted to 50/100. Provide metrics for accurate grading.',
    note: engagementScore < 70 ? 'Content or UX may need improvement.' : '',
    source: sourceName,
  });

  // ----- CONVERSION -----
  let conversionScore = 0;
  if (metricsMode) {
    conversionScore = Math.min(100, Math.round((conversionRate / CONVERSION_RATE_MEDIAN) * 100));
  } else {
    conversionScore = 50;
  }
  const conversionLetter = letterForScore(conversionScore);
  items.push({
    status: conversionLetter,
    headline: `Conversion score: ${conversionScore}/100 (${conversionLetter})`,
    was: metricsMode ? `${conversionRate}% conversion rate` : 'unknown',
    now: `${conversionScore}/100`,
    detail: metricsMode
      ? `Conversion rate ${conversionRate}% vs median ${CONVERSION_RATE_MEDIAN*100}%. Score: ${conversionScore}/100.`
      : 'No conversion data — defaulted to 50/100.',
    note: conversionScore < 70 ? 'CTA, form, or offer may need testing.' : '',
    source: sourceName,
  });

  // ----- PAGE MECHANICS (only if URL fetched) -----
  let mechanicsScore = 50;
  let mechanicsDetails = {};
  if (url) {
    line(`🌐 Fetching ${url}...`);
    try {
      const html = await fetchPage(url);
      endline();

      // Parse
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';
      const titleWords = title.split(/\s+/).filter(Boolean).length;

      const h1Matches = html.match(/<h1[^>]*>/gi);
      const h1Count = h1Matches ? h1Matches.length : 0;

      const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const wordCount = textContent.split(/\s+/).filter(Boolean).length;

      const inputMatches = html.match(/<input[^>]*>/gi) || [];
      const textareaMatches = html.match(/<textarea[^>]*>/gi) || [];
      const selectMatches = html.match(/<select[^>]*>/gi) || [];
      const formFieldCount = inputMatches.length + textareaMatches.length + selectMatches.length;

      // Image weight: sum of "weight" attributes or just count
      const imgMatches = html.match(/<img[^>]*>/gi) || [];
      const imageCount = imgMatches.length;

      // Render-blocking scripts: count scripts without async/defer
      const scriptMatches = html.match(/<script[^>]*>/gi) || [];
      const blockingScripts = scriptMatches.filter(s => !/async|defer/i.test(s)).length;

      mechanicsDetails = {
        titleWords,
        h1Count,
        wordCount,
        formFieldCount,
        imageCount,
        blockingScripts,
      };

      // Score
      let mechScore = 100;
      if (titleWords < TITLE_MIN_WORDS) mechScore -= 10;
      if (h1Count < H1_MIN_COUNT) mechScore -= 15;
      if (wordCount < WORD_COUNT_MIN) mechScore -= 10;
      if (formFieldCount < FORM_FIELD_MIN) mechScore -= 25;
      if (imageCount > 10) mechScore -= 5; // many images, potential weight
      if (blockingScripts > RENDER_BLOCKING_SCRIPTS_MAX) mechScore -= 10 * (blockingScripts - RENDER_BLOCKING_SCRIPTS_MAX);

      mechanicsScore = Math.max(0, Math.min(100, mechScore));

      // Add item
      const mechLetter = letterForScore(mechanicsScore);
      items.push({
        status: mechLetter,
        headline: `Page mechanics score: ${mechanicsScore}/100 (${mechLetter})`,
        was: `title:${titleWords}w, h1:${h1Count}, words:${wordCount}, forms:${formFieldCount}, imgs:${imageCount}, blocking:${blockingScripts}`,
        now: `${mechanicsScore}/100`,
        detail: `Title has ${titleWords} words (min ${TITLE_MIN_WORDS}); ${h1Count} H1 tags; ${wordCount} words; ${formFieldCount} form fields; ${imageCount} images; ${blockingScripts} render-blocking scripts.`,
        note: mechanicsScore < 70 ? 'Technical SEO and UX improvements recommended.' : 'Page mechanics are acceptable.',
        source: url,
      });

    } catch (err) {
      endline();
      items.push({
        status: 'FAIL',
        headline: 'Failed to fetch or parse page',
        was: '',
        now: '',
        detail: `Error: ${err.message}`,
        note: 'Mechanics score defaulted to 50.',
        source: url,
      });
    }
  } else {
    // No URL — default mechanics
    items.push({
      status: 'C',
      headline: 'Page mechanics not evaluated (no URL provided)',
      was: '',
      now: '50/100 (default)',
      detail: 'Grade based solely on provided metrics. Supply a URL for full mechanics analysis.',
      note: '',
      source: sourceName,
    });
  }

  // ----- OVERALL GRADE -----
  const scores = [trafficScore, engagementScore, conversionScore, mechanicsScore];
  const overallScore = Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length);
  const overallLetter = letterForScore(overallScore);
  items.push({
    status: overallLetter,
    headline: `Overall grade: ${overallLetter} (${overallScore}/100)`,
    was: '',
    now: `${overallLetter} — ${overallScore}/100`,
    detail: `Average of traffic (${trafficScore}), engagement (${engagementScore}), conversion (${conversionScore}), and mechanics (${mechanicsScore}). Never rounded up.`,
    note: '',
    source: sourceName,
  });

  // ----- AI FIX RECOMMENDATIONS (only if API key present) -----
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey) {
    line('🤖 Requesting AI-powered fix recommendations...');
    try {
      const pageFacts = {
        url: url || 'N/A',
        metrics: metricsMode ? { sessions, bounceRate, engagementRate, avgTime, conversions, conversionRate } : 'N/A',
        mechanics: mechanicsDetails,
        scores: { trafficScore, engagementScore, conversionScore, mechanicsScore, overallScore },
      };

      const schema = {
        type: 'object',
        properties: {
          verdict: { type: 'string' },
          fixes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                axis: { type: 'string' },
                fix: { type: 'string' },
                expected_lift: { type: 'string' },
                effort: { type: 'string' },
              },
              required: ['axis', 'fix', 'expected_lift', 'effort'],
            },
          },
        },
        required: ['verdict', 'fixes'],
      };

      const systemPrompt = 'You are a conversion optimization expert. Given landing page scores and facts, recommend 2-4 specific fixes with expected lift and effort (low/medium/high). Respond in JSON.';
      const userPrompt = `Landing page scores:\n${JSON.stringify(pageFacts, null, 2)}\n\nProvide fixes.`;

      const responseText = await ask({ system: systemPrompt, prompt: userPrompt, schema, maxTokens: 6000 });
      const data = parseJSON(responseText);

      if (data.fixes && Array.isArray(data.fixes)) {
        for (const fix of data.fixes) {
          items.push({
            status: 'FIX',
            headline: fix.fix || 'Recommended fix',
            was: '',
            now: fix.expected_lift || '',
            detail: `Axis: ${fix.axis || 'general'}. Expected lift: ${fix.expected_lift || 'unknown'}. Effort: ${fix.effort || 'unknown'}.`,
            note: `Effort: ${fix.effort || 'unknown'}`,
            source: url || sourceName,
          });
        }
      }
      endline();
    } catch (err) {
      endline();
      items.push({
        status: 'FAIL',
        headline: 'AI fix recommendations failed',
        was: '',
        now: '',
        detail: `Error: ${err.message}`,
        note: 'Proceeding with computed scores only.',
        source: '',
      });
    }
  } else {
    // No API key — add a note item
    items.push({
      status: 'FAIL',
      headline: 'No API key configured — AI recommendations not available',
      was: '',
      now: '',
      detail: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY to get AI-powered fix suggestions. All numeric scores were computed locally.',
      note: NO_SEARCH_NOTE,
      source: '',
    });
  }

  return items;
}

// -----------------------------------------------------------
//  fetchPage  — simple HTTPS GET
// -----------------------------------------------------------
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LandingPageGrader/1.0)',
        'Accept': 'text/html',
      },
      timeout: 15000,
    };

    const req = mod.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ============================================================
//  ENTRY POINT
// ============================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    out(PITCH);
    out('');
    out('Usage:');
    for (const [arg, desc] of USAGE) {
      out(`  ${C.dim(arg.padEnd(30))} ${desc}`);
    }
    out('');
    out('Environment variables (set one): ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY');
    return;
  }

  if (args[0] === '--demo') {
    const writeHTML = !args.includes('--no-html');
    await runDemo(writeHTML);
    return;
  }

  let input;
  let sourceName = args[0];

  if (args[0] === '-') {
    // Read stdin
    sourceName = 'stdin';
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString('utf8').trim();
  } else {
    input = args[0];
  }

  if (!input) {
    console.error(C.red('Error: no input provided. Use --help for usage.'));
    process.exit(1);
  }

  try {
    const items = await run(input, sourceName);
    renderFindings(items);

    const htmlPath = `./landing-page-performance-grader-${Date.now()}.html`;
    const subject = `Landing Page: ${sourceName}`;
    const html = buildHTML({ subject, body: items });
    fs.writeFileSync(htmlPath, html, 'utf8');

    renderSummary(items, htmlPath);
  } catch (err) {
    console.error(C.red(`Fatal error: ${err.message}`));
    process.exit(1);
  }
}

main();
