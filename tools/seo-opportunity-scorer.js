#!/usr/bin/env node
// Ammar Imtiaz
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz

// =============================================================================
// SEO Keyword Opportunity Scorer — standalone CLI
// =============================================================================

// ---- colour functions -------------------------------------------------------
const C = {
  green:  (s) => `\x1b[32m${s}\x1b[39m`,
  amber:  (s) => `\x1b[33m${s}\x1b[39m`,
  red:    (s) => `\x1b[31m${s}\x1b[39m`,
  teal:   (s) => `\x1b[36m${s}\x1b[39m`,
  dim:    (s) => `\x1b[2m${s}\x1b[22m`,
  text:   (s) => `\x1b[39m${s}\x1b[39m`,
  bold:   (s) => `\x1b[1m${s}\x1b[22m`,
};

// ---- constants --------------------------------------------------------------
const PITCH = 'Score SEO keyword opportunities from GA4 or Search Console exports.';
const USAGE = [
  ['<file>',    'read a CSV or TSV file'],
  ['-',         'read from stdin'],
  ['--demo',    'show demo output (no API key needed)'],
  ['--help',    'show this help'],
];
const STATUS = {
  CRITICAL: { glyph: '!', color: C.red,     label: 'Critical' },
  HIGH:     { glyph: '+', color: C.amber,    label: 'High'     },
  MEDIUM:   { glyph: '=', color: C.green,    label: 'Medium'   },
  LOW:      { glyph: '-', color: C.teal,     label: 'Low'      },
  WEIGHTS:  { glyph: '*', color: C.dim,      label: 'Weights'  },
  FAIL:     { glyph: 'x', color: C.red,      label: 'Fail'     },
};
const ITEM_NOUN = 'opportunity';
const NOTE_LABEL = 'note';
const NO_SEARCH_NOTE = 'API key missing — no intent classification could be fetched; results are based solely on keyword-derived heuristics.';

const WEIGHTS = { volume: 25, position: 20, commercialIntent: 20, competition: 15, ctrGap: 10, freshness: 5, trend: 5 };
const PRIORITY_CUTS = [
  { min: 80, label: 'CRITICAL', key: 'CRITICAL' },
  { min: 60, label: 'HIGH',     key: 'HIGH'     },
  { min: 40, label: 'MEDIUM',   key: 'MEDIUM'   },
  { min: 0,  label: 'LOW',      key: 'LOW'      },
];

const CTR_CURVE = [0.35, 0.20, 0.12, 0.08, 0.06, 0.05, 0.04, 0.035, 0.03, 0.025];

// ---- helpers ----------------------------------------------------------------
function bold(s)   { return C.bold(s); }
function bar(i, total) {
  if (!total) return '';
  const w = 20;
  const pos = Math.round((i + 1) / total * w);
  return '[' + '#'.repeat(pos) + '-'.repeat(w - pos) + ']';
}
function wrap(text, width) {
  if (!text || !width) return text || '';
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line.length + w.length + 1 > width) { lines.push(line.trim()); line = ''; }
    line += w + ' ';
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}
function clip(text, n) {
  if (!text) return '';
  if (text.length <= n) return text;
  return text.slice(0, n - 3) + '...';
}
function pad(text, n) {
  const s = String(text ?? '');
  return s.padEnd(n);
}

// ---- output rendering -------------------------------------------------------
let _lineActive = false;

function line(text) {
  if (_lineActive) process.stdout.write('\r\x1b[K');
  process.stdout.write(String(text));
  _lineActive = true;
}

function endline() {
  if (_lineActive) { process.stdout.write('\n'); _lineActive = false; }
}

function out(text) {
  console.log(text);
}

// ---- JSON parsing with fallbacks -------------------------------------------
function parseJSON(text) {
  if (!text) throw new Error('Empty text');
  try { return JSON.parse(text); } catch (_) {}

  // fenced block
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) try { return JSON.parse(m[1]); } catch (_) {}

  // brace scan — find outermost { ... }
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { start = i; break; }
  }
  if (start >= 0) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > start) try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  throw new Error('parseJSON: no valid JSON found');
}

// ---- ask() — one model call over HTTPS -------------------------------------
async function ask(P, opts = {}) {
  const { system, prompt: userPrompt, schema, search, maxTokens } = opts;
  const key = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
  let provider = '';
  let url = '';
  let body = {};

  if (process.env.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
    url = 'https://api.anthropic.com/v1/messages';
    body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens || 2048,
      system: system || '',
      messages: [{ role: 'user', content: userPrompt || '' }],
    };
  } else if (process.env.OPENAI_API_KEY) {
    provider = 'openai';
    url = 'https://api.openai.com/v1/chat/completions';
    body = {
      model: 'gpt-4o',
      max_tokens: maxTokens || 2048,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: userPrompt || '' },
      ],
    };
  } else if (process.env.GEMINI_API_KEY) {
    provider = 'gemini';
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    body = {
      contents: [{ parts: [{ text: (system ? system + '\n' : '') + (userPrompt || '') }] }],
      generationConfig: { maxOutputTokens: maxTokens || 2048 },
    };
  } else {
    throw new Error('No API key set (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)');
  }

  if (search) {
    // Not implemented for this simplified version, but we acknowledge the param
  }

  const https = require('https');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : {}),
        ...(provider === 'openai' ? { 'Authorization': `Bearer ${key}` } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`API ${provider} returned ${res.statusCode}: ${raw.slice(0, 200)}`));
          return;
        }
        try {
          const json = JSON.parse(raw);
          let text = '';
          if (provider === 'anthropic') text = json.content?.[0]?.text || '';
          else if (provider === 'openai') text = json.choices?.[0]?.message?.content || '';
          else if (provider === 'gemini') text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(String(text));
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---- concurrency-limited map ------------------------------------------------
async function mapLimit(items, limit, fn) {
  const results = [];
  const queue = [...items];
  const running = [];
  while (queue.length || running.length) {
    while (running.length < limit && queue.length) {
      const idx = items.length - queue.length;
      const item = queue.shift();
      const p = fn(item, idx).then(r => { results[idx] = r; }).catch(e => { results[idx] = e; });
      running.push(p);
      p.finally(() => running.splice(running.indexOf(p), 1));
    }
    if (running.length) await Promise.race(running);
  }
  return Array.from({length: items.length}, (_, i) => results[i] instanceof Error ? null : results[i]);
}

// ---- CSV/TSV quoted field reader -------------------------------------------
function parseLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

function cleanValue(val) {
  if (!val) return '';
  let s = String(val).trim();
  // Remove commas, percent, currency symbols
  s = s.replace(/[$,%]/g, '');
  // Parse time strings like "1m 24s" → seconds
  const tMatch = s.match(/^(\d+)\s*m\s*(\d+)?\s*s?$/);
  if (tMatch) {
    let sec = parseInt(tMatch[1]) * 60;
    if (tMatch[2]) sec += parseInt(tMatch[2]);
    return String(sec);
  }
  const tMatch2 = s.match(/^(\d+)\s*s$/);
  if (tMatch2) return tMatch2[1];
  return s;
}

function findHeaderRow(lines, requiredCols) {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstLine = trimmed.toLowerCase();
    const has = (word) => firstLine.includes(word.toLowerCase());
    if (requiredCols.some(c => has(c))) return i;
  }
  return -1;
}

// ---- intent detection from words -------------------------------------------
function deriveIntentFromWords(keyword) {
  const k = keyword.toLowerCase();
  const buyWords = ['buy', 'price', 'cost', 'cheap', 'discount', 'deal', 'order', 'purchase'];
  const commercialWords = ['best', 'review', 'vs', 'alternative', 'top', 'compare', 'rating'];
  const localWords = ['near me', 'nearby', 'in ', 'city', 'town'];
  const infoWords = ['how', 'what', 'why', 'when', 'where', 'which', 'guide', 'tutorial', 'tips', 'learn'];

  if (buyWords.some(w => k.includes(w))) return 'commercial';
  if (commercialWords.some(w => k.includes(w))) return 'commercial';
  if (localWords.some(w => k.includes(w))) return 'local';
  if (infoWords.some(w => k.includes(w))) return 'informational';
  return 'unknown';
}

// ---- scoring engine ---------------------------------------------------------
function scoreKeyword(row, available) {
  const parts = [];
  const missing = [];

  function use(key, weight, val, norm) {
    if (val === undefined || val === null || val === '') {
      missing.push(key);
      return 0;
    }
    const score = norm(val);
    parts.push({ key, weight, raw: val, score });
    return score * weight;
  }

  const volume = use('volume', 0.25, row.volume, v => Math.min(100, v / 1000 * 100));
  const position = use('position', 0.20, row.position, v => Math.max(0, 100 - (v - 1) * 10));
  const comp = use('competition', 0.15, row.competition, v => Math.max(0, 100 - v));
  const ctr = use('ctrGap', 0.10, row.ctr, v => v * 100);
  const freshness = use('freshness', 0.05, row.lastUpdated, v => {
    if (!v) return 0;
    const d = new Date(v);
    if (isNaN(d)) return 50;
    const days = (Date.now() - d.getTime()) / 86400000;
    return Math.max(0, 100 - days * 0.5);
  });
  const trend = use('trend', 0.05, row.trendDirection, v => {
    if (v === 'up' || v === 'upward') return 100;
    if (v === 'down' || v === 'downward') return 0;
    return 50;
  });

  // Intent from keyword words
  const intentWord = deriveIntentFromWords(row.keyword);
  const intentScore = (intentWord === 'commercial') ? 100 :
                      (intentWord === 'local') ? 80 :
                      (intentWord === 'informational') ? 30 : 50;
  const intentWeight = 0.20;
  parts.push({ key: 'commercialIntent', weight: intentWeight, raw: intentWord, score: intentScore });
  const usedWeights = 0.25 + 0.20 + 0.15 + 0.10 + 0.05 + 0.05 + 0.20;
  const missingWeight = missing.reduce((s, k) => s + (WEIGHTS[k] || 0) / 100, 0);
  const adjustFactor = usedWeights / (usedWeights - missingWeight);

  let rawScore = 0;
  for (const p of parts) rawScore += p.score * p.weight;
  const score = Math.min(100, Math.round(rawScore / (usedWeights / 100) * adjustFactor));

  return { score, parts, missing, intent: intentWord, adjustFactor };
}

// ---- CTR estimate ----------------------------------------------------------
function estimateClicks(searchVolume, position) {
  if (!searchVolume || !position) return 0;
  const idx = Math.min(Math.max(0, Math.round(position) - 1), CTR_CURVE.length - 1);
  const ctr = CTR_CURVE[idx] || 0;
  return Math.round(searchVolume * ctr);
}

// ---- priority assignment ---------------------------------------------------
function assignPriority(score) {
  for (const cut of PRIORITY_CUTS) {
    if (score >= cut.min) return cut;
  }
  return PRIORITY_CUTS[PRIORITY_CUTS.length - 1];
}

// ---- rendering functions ---------------------------------------------------
function renderFindings(items) {
  for (const item of items) {
    const st = STATUS[item.status];
    if (!st) continue;
    const glyph = st.glyph;
    const coloredLabel = st.color(st.label);
    const headline = item.headline ? ` ${clip(item.headline, 50)}` : '';
    const was = item.was ? ` was ${item.was}` : '';
    const now = item.now ? ` → ${item.now}` : '';
    const detail = item.detail ? `\n   ${wrap(clip(item.detail, 78), 75)}` : '';
    const note = item.note ? `\n   ${NOTE_LABEL}: ${wrap(clip(item.note, 60), 75)}` : '';
    const source = item.source ? ` [${clip(item.source, 30)}]` : '';
    out(`[${glyph}] ${coloredLabel}${headline}${was}${now}${source}${detail}${note}`);
  }
}

function renderSummary(items, htmlPath) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, FAIL: 0, WEIGHTS: 0 };
  for (const item of items) {
    if (counts[item.status] !== undefined) counts[item.status]++;
  }
  out('');
  out(bold('Summary:'));
  for (const [key, st] of Object.entries(STATUS)) {
    if (counts[key] > 0) {
      out(`  ${st.glyph} ${st.color(st.label)}: ${counts[key]}`);
    }
  }
  if (htmlPath) {
    out('');
    out(C.green(`HTML report written to: ${htmlPath}`));
  }
}

function buildHTML({ subject, body }) {
  const items = Array.isArray(body) ? body : [body];
  const rows = items.map(item => {
    const st = STATUS[item.status];
    const glyph = st ? st.glyph : '?';
    const label = st ? st.label : 'Unknown';
    return `<tr>
      <td>${glyph}</td>
      <td>${label}</td>
      <td>${item.headline || ''}</td>
      <td>${item.was || ''}</td>
      <td>${item.now || ''}</td>
      <td>${item.detail || ''}</td>
      <td>${item.note || ''}</td>
      <td>${item.source || ''}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>SEO Opportunity Scorer — ${subject}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 2em; background: #f8f9fa; color: #333; }
h1 { color: #1a73e8; }
table { border-collapse: collapse; width: 100%; margin-top: 1em; }
th, td { border: 1px solid #ccc; padding: 6px 12px; text-align: left; vertical-align: top; }
th { background: #e8f0fe; font-weight: 600; }
tr:nth-child(even) { background: #fff; }
</style>
</head>
<body>
<h1>${subject}</h1>
<p>Generated on ${new Date().toISOString().slice(0, 10)}</p>
<table>
<thead><tr><th>#</th><th>Status</th><th>Headline</th><th>Was</th><th>Now</th><th>Detail</th><th>Note</th><th>Source</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;
}

// ---- demo data -------------------------------------------------------------
const DEMO = [
  {
    status: 'CRITICAL',
    headline: '"buy organic coffee beans" — rank 4 → projected 1',
    was: 'position 4, estimated 320 monthly clicks',
    now: 'position 1 projected, estimated 1,400 monthly clicks',
    detail: 'High search volume (4,200/mo) with low competition (22). The keyword intent is clearly commercial (contains "buy"). Position improvement from 4 to 1 would capture the top CTR of ~35%.',
    note: 'Potential gain: +1,080 clicks/month, estimated +$2,600/mo revenue at 2.4% conversion.',
    source: 'GA4 export, row 14'
  },
  {
    status: 'HIGH',
    headline: '"best running shoes 2025" — strong commercial intent',
    was: 'position 7, 180 clicks',
    now: 'score 74/100, target: position 3',
    detail: 'Volume 2,800/mo with "best" indicating comparison shopping. Current CTR ~5% from position 7; moving to position 3 would yield ~12% CTR. Competition moderate at 45.',
    note: 'Optimize review-style content for featured snippet opportunity.',
    source: 'Search Console, query group "running shoes"'
  },
  {
    status: 'MEDIUM',
    headline: '"how to tie a tie" — informational, lower conversion potential',
    was: 'position 2, 900 clicks',
    now: 'score 48/100, maintain',
    detail: 'Volume 8,500/mo but intent is informational — users want instructions, not purchases. CTR already good at ~20% for position 2. Low commercial value limits priority.',
    note: 'Monetize with affiliate links to tie products if available.',
    source: 'GA4 landing page report'
  },
  {
    status: 'LOW',
    headline: '"vintage watch straps leather 22mm" — niche, low volume',
    was: 'position 3, 45 clicks',
    now: 'score 22/100, no action needed',
    detail: 'Monthly volume only 180 searches. Even at position 1, maximum potential is ~60 clicks. Competition is high (78) for the small market. Effort better spent on broader queries.',
    note: 'Long-tail query; consider consolidating into category page.',
    source: 'row 42, export-2025-03.csv'
  },
  {
    status: 'FAIL',
    headline: 'Missing data: row had no keyword column',
    was: '',
    now: '',
    detail: 'Row 23 in the input file contained only numbers with no recognizable keyword field. The row was skipped after header detection.',
    note: 'Check file formatting: ensure keyword column is named "keyword", "query", or "search term".',
    source: 'export-2025-03.csv, line 24'
  },
  {
    status: 'WEIGHTS',
    headline: 'Scoring weights applied: volume 25%, position 20%, commercialIntent 20%, competition 15%, ctrGap 10%, freshness 5%, trend 5%',
    was: '',
    now: '',
    detail: 'All seven factors present in input data. Factor "freshness" derived from last_updated column; "trend" from trend_direction. Adjustment factor = 1.0 (no missing weights).',
    note: '',
    source: '',
  },
];

// ---- SUMMARY_NOTE -----------------------------------------------------------
function SUMMARY_NOTE(items) {
  const crit = items.filter(i => i.status === 'CRITICAL').length;
  if (crit > 0) return `${crit} critical ${ITEM_NOUN}${crit > 1 ? 's' : ''} identified — prioritize these for maximum impact.`;
  return 'No critical items found.';
}

// ---- run() — main processing -----------------------------------------------
async function run(P, input, sourceName) {
  const lines = input.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    return [{
      status: 'FAIL',
      headline: 'Not enough data rows',
      was: '',
      now: '',
      detail: `Expected at least one header + one data row, got ${lines.length} non-empty lines.`,
      note: 'Provide a CSV/TSV file with columns for keyword, search volume, position, etc.',
      source: sourceName || 'stdin'
    }];
  }

  // Find header
  const headerIdx = findHeaderRow(lines, ['keyword', 'query', 'search term']);
  if (headerIdx < 0) {
    return [{
      status: 'FAIL',
      headline: 'Could not find header row',
      was: '',
      now: '',
      detail: 'Expected a header containing "keyword", "query", or "search term". First 10 lines scanned.',
      note: 'Confirm your file has a header row with expected column names.',
      source: sourceName || 'stdin'
    }];
  }

  // Detect delimiter
  const headerLine = lines[headerIdx];
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const delim = tabCount > commaCount ? '\t' : ',';

  const headers = parseLine(headerLine, delim).map(h => h.trim().toLowerCase().replace(/[\s-]+/g, ''));
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const keywordCol = ['keyword', 'query', 'searchterm', 'search term'].find(k => colMap[k] !== undefined);
  const volumeCol = ['searchvolume', 'volume', 'impressions'].find(k => colMap[k] !== undefined);
  const positionCol = ['position', 'avgposition', 'averageposition'].find(k => colMap[k] !== undefined);
  const competitionCol = ['competition', 'difficulty', 'keyworddifficulty'].find(k => colMap[k] !== undefined);
  const ctrCol = ['ctr', 'clickrate', 'clickthroughrate'].find(k => colMap[k] !== undefined);
  const dateCol = ['lastupdated', 'date', 'last_updated', 'updated'].find(k => colMap[k] !== undefined);
  const trendCol = ['trend', 'trenddirection', 'trend_direction'].find(k => colMap[k] !== undefined);

  const dataRows = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseLine(line, delim);
    const kw = fields[keywordCol] ? cleanValue(fields[keywordCol]) : '';
    if (!kw) { skipped++; continue; }

    const row = { keyword: kw };
    if (volumeCol !== undefined) row.volume = parseInt(cleanValue(fields[volumeCol])) || 0;
    if (positionCol !== undefined) row.position = parseFloat(cleanValue(fields[positionCol])) || 0;
    if (competitionCol !== undefined) row.competition = parseFloat(cleanValue(fields[competitionCol])) || 0;
    if (ctrCol !== undefined) row.ctr = parseFloat(cleanValue(fields[ctrCol])) || 0;
    if (dateCol !== undefined) row.lastUpdated = cleanValue(fields[dateCol]);
    if (trendCol !== undefined) row.trendDirection = cleanValue(fields[trendCol]).toLowerCase();
    dataRows.push(row);
  }

  if (dataRows.length === 0) {
    return [{
      status: 'FAIL',
      headline: 'No usable data rows parsed',
      was: '',
      now: '',
      detail: `${lines.length - headerIdx - 1} lines read but none had a keyword. ${skipped} rows skipped for missing keyword.`,
      note: 'Check column names: expected "keyword", "query", or "search term" in header.',
      source: sourceName || 'stdin'
    }];
  }

  const availableFactors = [];
  if (volumeCol) availableFactors.push('volume');
  if (positionCol) availableFactors.push('position');
  if (competitionCol) availableFactors.push('competition');
  if (ctrCol) availableFactors.push('ctrGap');
  if (dateCol) availableFactors.push('freshness');
  if (trendCol) availableFactors.push('trend');
  availableFactors.push('commercialIntent');

  // Score all items
  const scored = dataRows.map((row, idx) => {
    line(`Scoring [${idx + 1}/${dataRows.length}] ${bar(idx, dataRows.length)} ${row.keyword}`);
    const result = scoreKeyword(row, availableFactors);
    const clicks = estimateClicks(row.volume, row.position);
    const priority = assignPriority(result.score);
    const noteParts = [];
    if (result.missing.length) noteParts.push(`missing: ${result.missing.join(', ')}`);
    if (clicks > 0) noteParts.push(`potential clicks: ${clicks}`);
    const detail = result.parts
      .map(p => `${p.key}=${Math.round(p.score * p.weight * 100 / result.adjustFactor || 0)}`)
      .join(', ');
    const head = `${row.keyword} — score ${result.score}/100 (${priority.label})`;
    return {
      status: priority.key,
      headline: head,
      was: row.position ? `position ${row.position}` : '',
      now: `score ${result.score}/100`,
      detail: `Factors: ${detail}. ${result.missing.length ? `Missing: ${result.missing.join(', ')}. ` : ''}Intent: ${result.intent}.`,
      note: noteParts.join('; ') || '',
      source: `${sourceName || 'stdin'}, row ${headerIdx + 2 + idx}`
    };
  });

  endline();

  // Weights item
  const weightsItem = {
    status: 'WEIGHTS',
    headline: `Weights used: volume=${WEIGHTS.volume}%, position=${WEIGHTS.position}%, commercialIntent=${WEIGHTS.commercialIntent}%, competition=${WEIGHTS.competition}%, ctrGap=${WEIGHTS.ctrGap}%, freshness=${WEIGHTS.freshness}%, trend=${WEIGHTS.trend}%`,
    was: '',
    now: '',
    detail: `Available factors: ${availableFactors.join(', ')}. ${skipped > 0 ? `${skipped} rows skipped.` : 'All rows processed.'}`,
    note: '',
    source: ''
  };

  // Intent classification via API if key present
  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
  if (hasKey && dataRows.length > 0) {
    line('Classifying intent via API (sending top 30 keywords)...');
    const topKws = scored
      .filter(s => s.status !== 'FAIL' && s.status !== 'WEIGHTS')
      .slice(0, 30)
      .map(s => s.headline.split(' —')[0]);
    try {
      const system = `You are an SEO classifier. Given a list of keywords, return JSON: { "keywords": [ { "keyword": "...", "intent": "commercial|informational|local|navigational", "note": "one sentence explanation" } ] }`;
      const prompt = `Classify these ${topKws.length} keywords by search intent:\n${topKws.join('\n')}`;
      const text = await ask(P, { system, prompt, maxTokens: 5000 });
      const data = parseJSON(text);
      if (data && data.keywords) {
        const intentMap = {};
        for (const k of data.keywords) intentMap[k.keyword] = k;
        for (const item of scored) {
          const kw = item.headline.split(' —')[0];
          if (intentMap[kw]) {
            item.detail += ` API intent: ${intentMap[kw].intent} (${intentMap[kw].note})`;
          }
        }
      }
    } catch (e) {
      scored.push({
        status: 'FAIL',
        headline: 'Intent classification API call failed',
        was: '',
        now: '',
        detail: `Error: ${e.message || e}. Falling back to word-based intent detection (which was already applied).`,
        note: 'Results are still complete with heuristic intent.',
        source: 'API call'
      });
    }
    endline();
  } else if (!hasKey && dataRows.length > 0) {
    scored.unshift({
      status: 'WEIGHTS',
      headline: NO_SEARCH_NOTE,
      was: '',
      now: '',
      detail: 'All keyword scores, priorities, and CTR estimates are computed from the input data. Intent derived from keyword words only.',
      note: '',
      source: ''
    });
  }

  return [weightsItem, ...scored];
}

// ---- runDemo() -------------------------------------------------------------
async function runDemo(writeHTML) {
  out(C.green('Running demo mode (no API calls, no keys needed)'));
  out('');
  const total = 6;
  for (let i = 0; i < DEMO.length; i++) {
    line(`Processing demo item ${i + 1}/${total} ${bar(i, total)}`);
    await new Promise(r => setTimeout(r, 100)); // simulate work
  }
  endline();
  out('');
  renderFindings(DEMO);
  let htmlPath = null;
  if (writeHTML) {
    htmlPath = './seo-opportunity-scorer-demo.html';
    const html = buildHTML({ subject: 'Demo Report', body: DEMO });
    require('fs').writeFileSync(htmlPath, html);
  }
  renderSummary(DEMO, htmlPath);
  out('');
  out(SUMMARY_NOTE(DEMO));
}

// ---- entry point -----------------------------------------------------------
(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    out(C.bold(PITCH));
    out('');
    out('Usage: node seo-opportunity-scorer.js <option>');
    for (const [arg, desc] of USAGE) {
      out(`  ${pad(arg, 16)} ${desc}`);
    }
    out('');
    out(C.dim('Environment variables (set one):'));
    out(C.dim('  ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY'));
    process.exit(0);
  }

  if (args.includes('--demo')) {
    const writeHTML = !args.includes('--no-html');
    await runDemo(writeHTML);
    process.exit(0);
  }

  let input = '';
  let sourceName = 'stdin';
  const filePath = args.find(a => !a.startsWith('--'));

  if (filePath && filePath !== '-') {
    sourceName = filePath;
    try {
      input = require('fs').readFileSync(filePath, 'utf-8');
    } catch (e) {
      out(C.red(`Error reading file: ${e.message}`));
      process.exit(1);
    }
  } else {
    // stdin
    const fs = require('fs');
    input = fs.readFileSync('/dev/stdin', 'utf-8');
  }

  if (!input.trim()) {
    out(C.red('No input data. Use --demo, --help, or provide a file.'));
    process.exit(1);
  }

  try {
    const items = await run({}, input, sourceName);
    renderFindings(items);
    const htmlPath = './seo-opportunity-report.html';
    const html = buildHTML({ subject: `SEO Opportunity Report — ${sourceName}`, body: items });
    require('fs').writeFileSync(htmlPath, html);
    renderSummary(items, htmlPath);
    out('');
    out(SUMMARY_NOTE(items));
  } catch (e) {
    out(C.red(`Fatal error: ${e.message}`));
    process.exit(1);
  }
})();
