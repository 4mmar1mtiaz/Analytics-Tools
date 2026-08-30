#!/usr/bin/env node
//
// Author: Ammar Imtiaz
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz

// ============================================================
// CONSTANTS
// ============================================================

const PITCH = 'Find low-CTR pages that are underperforming against their position, not just low CT articles.';

const USAGE = [
  ['<file>', 'Read a Search Console CSV export file'],
  ['-', 'Read CSV from stdin'],
  ['--demo', 'Run with built-in demo data, no API key needed'],
  ['--help', 'Show this usage information']
];

const STATUS = {
  LOSING: { glyph: '-', color: null, label: 'Losing' },
  CHECK: { glyph: '?', color: null, label: 'Check' },
  TOTAL: { glyph: '=', color: null, label: 'Total' },
  FAIL: { glyph: '!', color: null, label: 'Failed' }
};

const ITEM_NOUN = 'finding';

const NOTE_LABEL = 'Suggestion';

const NO_SEARCH_NOTE = 'No API key found — the rewrite suggestions below are placeholder text only.';

const SUMMARY_NOTE = (items) => {
  const losing = items.filter(i => i.status === 'LOSING').length;
  const check = items.filter(i => i.status === 'CHECK').length;
  return `${losing} losing, ${check} needing review${losing > 0 ? ' — fix these first' : ''}`;
};

// Position-to-CTR curve (average expected CTR per position, from broad industry data)
const POSITION_CTR = {
  1: 0.30, 2: 0.18, 3: 0.12, 4: 0.09, 5: 0.07,
  6: 0.06, 7: 0.05, 8: 0.04, 9: 0.035, 10: 0.03,
  11: 0.025, 12: 0.022, 13: 0.02, 14: 0.018, 15: 0.016,
  16: 0.015, 17: 0.014, 18: 0.013, 19: 0.012, 20: 0.011
};

// Maximum position we track
const MAX_POSITION = 20;

// Number of worst gaps to send to API
const TOP_N_FOR_API = 20;

// Minimal impressions to consider a row
const MIN_IMPRESSIONS = 100;

// Demo data
const DEMO = [
  {
    status: 'LOSING',
    headline: '/products/widget-blue - lost 342 clicks in 90 days',
    was: 'Expected CTR 8.5%',
    now: 'Actual CTR 2.1%',
    detail: 'This product page ranks at position 3 with 14,200 impressions but only achieves 2.1% CTR. Expected CTR for position 3 is 12%, but actual is 2.1%, leaving 1,410 clicks on the table vs. the 1,704 expected. The page has been in this position for at least 60 days with no improvement.',
    note: 'Consider rewriting the meta description to include "buy" and key product benefits. The current description is too generic.',
    source: '/products/widget-blue'
  },
  {
    status: 'LOSING',
    headline: '/blog/guide-to-widgets - lost 89 clicks in 30 days',
    was: 'Expected CTR 5.0%',
    now: 'Actual CTR 1.8%',
    detail: 'This blog post sits at position 6 with 8,400 impressions but only achieves 1.8% CTR. Expected CTR for position 6 is 6%, so the gap is 420 clicks lost vs. the 504 expected over the period. The title tag does not include the target keyword.',
    note: 'Add the target keyword "widget guide" to the title tag and update the meta description to be more compelling.',
    source: '/blog/guide-to-widgets'
  },
  {
    status: 'CHECK',
    headline: '/contact - 45% of expected CTR but not critical',
    was: 'Expected CTR 3.5%',
    now: 'Actual CTR 1.6%',
    detail: 'This contact page ranks at position 11 with 3,200 impressions. Expected CTR is 2.5% for this position, but actual is 1.6%, which is 64% of expected. At 3,200 impressions, the gap is 29 clicks, which is small but could be improved with a clearer CTA in the snippet.',
    note: 'Consider adding a compelling call-to-action in the meta description to improve click-through.',
    source: '/contact'
  },
  {
    status: 'CHECK',
    headline: '/pricing - 38% below expected for its position',
    was: 'Expected CTR 9.0%',
    now: 'Actual CTR 5.6%',
    detail: 'This page ranks at position 4 with 18,900 impressions. Expected CTR is 9% but actual is 5.6%, which is 62% of expected. The gap costs about 642 clicks over 90 days. The meta description is currently generic.',
    note: 'Rewrite the meta description to highlight unique value propositions and a clear call to action.',
    source: '/pricing'
  },
  {
    status: 'TOTAL',
    headline: 'Total clicks lost across all tracked pages: 2,847',
    was: '',
    now: '',
    detail: 'Aggregate analysis of all pages with ≥100 impressions reveals a total of 2,847 clicks lost over the analysis period due to CTR underperformance relative to position. The largest contributors are the top 5 pages, which account for 68% of the loss.',
    note: 'Prioritize the losing pages first for the biggest impact.',
    source: ''
  },
  {
    status: 'FAIL',
    headline: 'No live search performed — using static analysis only',
    was: '',
    now: '',
    detail: 'The API call was skipped because no ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY environment variable was set. All numerical analysis is complete, but AI-powered rewrite suggestions are not available.',
    note: 'Set one of the API keys to enable live search. For now, review the suggestions in the demo data.',
    source: ''
  }
];

// ============================================================
// ANSI COLOR FUNCTIONS
// ============================================================

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  teal: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  text: (s) => s
};

// Assign colors to STATUS keys
STATUS.LOSING.color = C.red;
STATUS.CHECK.color = C.amber;
STATUS.TOTAL.color = C.teal;
STATUS.FAIL.color = C.red;

// ============================================================
// HELPERS
// ============================================================

function bold(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

function bar(i, total) {
  const width = 20;
  const filled = Math.round((i / total) * width);
  return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

function wrap(text, width) {
  if (width <= 0) return [text];
  const lines = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current.length + word.length + 1 > width && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function clip(text, n) {
  if (typeof text !== 'string') text = String(text);
  if (text.length <= n) return text;
  return text.slice(0, n - 1) + '…';
}

function pad(text, n) {
  text = String(text);
  while (text.length < n) text += ' ';
  return text;
}

let _lastLineLen = 0;

function line(text) {
  // Overwrite the current line
  const clear = ' '.repeat(_lastLineLen);
  process.stdout.write('\r' + clear + '\r' + text);
  _lastLineLen = text.length;
}

function endline() {
  process.stdout.write('\n');
  _lastLineLen = 0;
}

function out(text) {
  console.log(text);
}

// ============================================================
// CSV PARSER (custom, handles quoted fields)
// ============================================================

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function cleanNumber(str) {
  if (typeof str !== 'string') return str;
  // Remove commas, percent signs, currency symbols, and time strings
  str = str.replace(/,/g, '');
  str = str.replace(/%/g, '');
  str = str.replace(/\$/g, '');
  str = str.replace(/€/g, '');
  str = str.replace(/£/g, '');
  // Handle time strings like "1m 24s"
  if (/^\d+[ms]/.test(str)) {
    const parts = str.split(/[ms\s]+/).filter(Boolean);
    if (parts.length === 2) {
      return (parseInt(parts[0]) * 60 + parseInt(parts[1])).toString();
    }
  }
  return str;
}

function findHeader(lines) {
  // Look for a line that contains the header keywords we need
  for (let i = 0; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const fieldNames = fields.map(f => f.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (fieldNames.some(f => /^(page|query|keyword)$/.test(f)) &&
        fieldNames.some(f => /^(clicks)$/.test(f)) &&
        fieldNames.some(f => /^(impressions)$/.test(f))) {
      return { index: i, fields: fields.map(f => f.toLowerCase().trim()) };
    }
  }
  return null;
}

// ============================================================
// JSON PARSE WITH FALLBACKS
// ============================================================

function parseJSON(text) {
  if (typeof text !== 'string') throw new Error('parseJSON: input must be a string');
  
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (e) {
    // Not valid JSON
  }
  
  // Try fenced block fallback (```json ... ```)
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch (e) {
      // Not valid either
    }
  }
  
  // Try brace scan fallback
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch (e) {
      // Not valid either
    }
  }
  
  throw new Error('parseJSON: could not parse input as JSON');
}

// ============================================================
// ASK FUNCTION (API call)
// ============================================================

async function ask(P, { system, prompt, schema, search, maxTokens }) {
  // Determine which provider to use
  let apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  let provider = null;
  
  if (process.env.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
    apiKey = process.env.ANTHROPIC_API_KEY;
  } else if (process.env.OPENAI_API_KEY) {
    provider = 'openai';
    apiKey = process.env.OPENAI_API_KEY;
  } else if (process.env.GEMINI_API_KEY) {
    provider = 'gemini';
    apiKey = process.env.GEMINI_API_KEY;
  }
  
  if (!provider || !apiKey) {
    throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY environment variable.');
  }
  
  // Build the complete prompt
  let fullPrompt = prompt;
  if (schema) {
    fullPrompt += '\n\nRespond with JSON conforming to this schema:\n' + JSON.stringify(schema, null, 2);
  }
  
  const body = {
    model: provider === 'anthropic' ? 'claude-3-opus-20240229' :
            provider === 'openai' ? 'gpt-4-turbo' :
            'gemini-1.5-pro',
    messages: [
      { role: 'system', content: system || 'You are a helpful assistant.' },
      { role: 'user', content: fullPrompt }
    ],
    max_tokens: maxTokens || 4096,
    temperature: 0.2
  };
  
  let url, headers;
  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
    headers = {
      'Content-Type': 'application/json'
    };
    // Gemni uses different request format
    body.contents = [{ parts: [{ text: fullPrompt }] }];
    delete body.messages;
    delete body.model;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.statusText}`);
  }
  
  const result = await response.json();
  
  // Extract text from response based on provider
  let text = '';
  if (provider === 'anthropic') {
    text = result.content[0].text;
  } else if (provider === 'openai') {
    text = result.choices[0].message.content;
  } else if (provider === 'gemini') {
    text = result.candidates[0].content.parts[0].text;
  }
  
  return text;
}

// ============================================================
// MAP LIMIT
// ============================================================

async function mapLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err };
      }
    }
  }
  
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  
  return results;
}

// ============================================================
// RENDER FUNCTIONS
// ============================================================

function renderFindings(items) {
  const maxLen = process.stdout.columns || 80;
  
  out('');
  out(bold('Findings:'));
  out('');
  
  let counter = 0;
  for (const item of items) {
    counter++;
    const status = STATUS[item.status];
    const glyph = status.glyph;
    const color = status.color || C.text;
    
    // Headline with glyph
    const headline = `${glyph} ${item.headline}`;
    out(color(headline));
    
    // Was/Now if present
    if (item.was || item.now) {
      const wasStr = item.was ? `was: ${item.was}` : '';
      const nowStr = item.now ? `now: ${item.now}` : '';
      const separator = (wasStr && nowStr) ? ' → ' : '';
      out(C.dim(`  ${wasStr}${separator}${nowStr}`));
    }
    
    // Detail
    const detailLines = wrap(item.detail, maxLen - 2);
    for (const line of detailLines) {
      out(`  ${line}`);
    }
    
    // Note if present
    if (item.note) {
      out(`  ${bold(NOTE_LABEL)}: ${item.note}`);
    }
    
    // Source if present
    if (item.source) {
      out(`  ${C.dim('[' + item.source + ']')}`);
    }
    
    out('');
  }
}

function renderSummary(items, htmlPath) {
  const totalLosing = items.filter(i => i.status === 'LOSING').length;
  const totalCheck = items.filter(i => i.status === 'CHECK').length;
  const totalFailed = items.filter(i => i.status === 'FAIL').length;
  
  out('');
  out(bold('Summary:'));
  out(`  ${C.red(totalLosing.toString())} losing, ${C.amber(totalCheck.toString())} checking, ${C.red(totalFailed.toString())} failed`);
  out(`  ${SUMMARY_NOTE(items)}`);
  
  if (htmlPath) {
    out(`  HTML report written to ${C.green(htmlPath)}`);
  }
  
  out('');
}

function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .item { border-left: 4px solid #ddd; margin: 20px 0; padding: 10px 15px; border-radius: 0 4px 4px 0; }
    .LOSING { border-color: #e74c3c; background: #fdf0ef; }
    .CHECK { border-color: #f39c12; background: #fef9e7; }
    .TOTAL { border-color: #3498db; background: #eaf2f8; }
    .FAIL { border-color: #c0392b; background: #fdedec; }
    .glyph { font-weight: bold; font-size: 1.2em; }
    .headline { font-weight: bold; font-size: 1.1em; }
    .meta { color: #7f8c8d; font-size: 0.9em; }
    .detail { margin: 8px 0; }
    .note { background: #f9f9f9; padding: 8px; border-radius: 4px; margin: 8px 0; }
    .source { color: #2980b9; font-size: 0.85em; }
    .summary { background: #f5f5f5; padding: 15px; border-radius: 4px; margin-top: 30px; }
  </style>
</head>
<body>
  <h1>${subject}</h1>
  <div class="summary">
    <p>${body.replace(/\n/g, '<br>')}</p>
  </div>
</body>
</html>`;
}

// ============================================================
// MAIN RUN FUNCTION
// ============================================================

async function run(P, input, sourceName) {
  const lines = input.split('\n').filter(l => l.trim() !== '');
  
  // Find header
  const headerInfo = findHeader(lines);
  if (!headerInfo) {
    throw new Error('Could not find header row with required columns (page/query, clicks, impressions)');
  }
  
  const headerFields = headerInfo.fields;
  const dataLines = lines.slice(headerInfo.index + 1);
  
  // Build index mapping
  const idx = {};
  for (let i = 0; i < headerFields.length; i++) {
    const field = headerFields[i].replace(/[^a-z0-9]/g, '');
    if (/^(page|query|keyword|url)$/.test(field)) idx.page = i;
    else if (/^(clicks)$/.test(field)) idx.clicks = i;
    else if (/^(impressions)$/.test(field)) idx.impressions = i;
    else if (/^(ctr)$/.test(field)) idx.ctr = i;
    else if (/^(avgposition|position|avgpos)$/.test(field)) idx.position = i;
    else if (/^(title)$/.test(field)) idx.title = i;
  }
  
  // Parse rows
  const rows = [];
  let skipped = 0;
  for (const line of dataLines) {
    const fields = parseCSVLine(line);
    
    const page = fields[idx.page] || '';
    const clicksRaw = cleanNumber(fields[idx.clicks] || '0');
    const impressionsRaw = cleanNumber(fields[idx.impressions] || '0');
    const ctrRaw = cleanNumber(fields[idx.ctr] || '');
    const positionRaw = cleanNumber(fields[idx.position] || '');
    const title = fields[idx.title] || '';
    
    const clicks = parseInt(clicksRaw) || 0;
    const impressions = parseInt(impressionsRaw) || 0;
    const ctr = parseFloat(ctrRaw) || (impressions > 0 ? clicks / impressions : 0);
    const position = parseFloat(positionRaw) || 0;
    
    // Skip rows missing required fields
    if (!page || impressions === 0 || position === 0) {
      skipped++;
      continue;
    }
    
    // Skip rows under minimum impressions
    if (impressions < MIN_IMPRESSIONS) {
      skipped++;
      continue;
    }
    
    // Clamp position to our max
    const clampedPos = Math.min(Math.round(position), MAX_POSITION);
    
    // Get expected CTR
    const expectedCTR = POSITION_CTR[clampedPos] || POSITION_CTR[MAX_POSITION] || 0.01;
    
    // Actual CTR
    const actualCTR = impressions > 0 ? clicks / impressions : 0;
    
    // Gap ratio (actual / expected)
    const gapRatio = expectedCTR > 0 ? actualCTR / expectedCTR : 0;
    
    // Expected clicks
    const expectedClicks = Math.round(impressions * expectedCTR);
    
    // Lost clicks
    const lostClicks = expectedClicks - clicks;
    
    rows.push({
      page,
      title,
      impressions,
      clicks,
      expectedClicks,
      lostClicks,
      position: position,
      actualCTR,
      expectedCTR,
      gapRatio
    });
  }
  
  // Sort by gap ratio (worst first)
  rows.sort((a, b) => a.gapRatio - b.gapRatio);
  
  // Build items
  const items = [];
  
  // Top 20 for API
  const topForAPI = rows.slice(0, TOP_N_FOR_API);
  
  // Determine if API is available
  const apiAvailable = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
  
  let suggestions = {};
  let apiFailed = false;
  
  if (apiAvailable) {
    try {
      const prompt = `Analyze these ${TOP_N_FOR_API} pages that have the worst CTR relative to their position:`;
      const system = 'You are an SEO analyst. For each page, provide a diagnosis, a rewrite suggestion, and your confidence level.';
      
      const pageList = topForAPI.map((r, i) => 
        `${i+1}. Page: ${r.page}, Position: ${r.position.toFixed(1)}, Impressions: ${r.impressions}, Title: "${r.title}"`
      ).join('\n');
      
      const fullPrompt = prompt + '\n\n' + pageList;
      
      const text = await ask(null, {
        system,
        prompt: fullPrompt,
        schema: {
          pages: [
            {
              page: 'string',
              diagnosis: 'string',
              rewrite_suggestion: 'string',
              confidence: 'number'
            }
          ]
        },
        maxTokens: 7000
      });
      
      const data = parseJSON(text);
      
      if (data && data.pages) {
        for (const p of data.pages) {
          suggestions[p.page] = p.rewrite_suggestion || '';
        }
      }
    } catch (err) {
      apiFailed = true;
      items.push({
        status: 'FAIL',
        headline: 'API call failed',
        was: '',
        now: '',
        detail: `The AI suggestion engine returned an error: ${err.message}`,
        note: 'Continuing with computed analysis only.',
        source: 'API'
      });
    }
  } else {
    items.push({
      status: 'FAIL',
      headline: 'No live search performed — using static analysis only',
      was: '',
      now: '',
      detail: NO_SEARCH_NOTE,
      note: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY to get AI-powered rewrite suggestions.',
      source: 'configuration'
    });
  }
  
  // Build items for each row
  let totalLostClicks = 0;
  const processedPages = new Set();
  
  for (const row of rows) {
    if (processedPages.has(row.page)) continue;
    processedPages.add(row.page);
    
    if (row.gapRatio < 0.5) {
      // LOSING
      totalLostClicks += row.lostClicks;
      const suggestion = suggestions[row.page] || 'Improve meta description and title tag for better CTR.';
      items.push({
        status: 'LOSING',
        headline: `${row.page} - lost ${row.lostClicks} clicks`,
        was: `Expected CTR ${(row.expectedCTR * 100).toFixed(1)}%`,
        now: `Actual CTR ${(row.actualCTR * 100).toFixed(1)}%`,
        detail: `This page ranks at position ${row.position.toFixed(1)} with ${row.impressions.toLocaleString()} impressions. Expected CTR is ${(row.expectedCTR * 100).toFixed(1)}% but actual is ${(row.actualCTR * 100).toFixed(1)}%, a gap of ${((row.expectedCTR - row.actualCTR) * 100).toFixed(1)} percentage points. This represents ${row.lostClicks} lost clicks over the analysis period.`,
        note: suggestion,
        source: row.page
      });
    } else if (row.gapRatio < 0.75) {
      // CHECK
      items.push({
        status: 'CHECK',
        headline: `${row.page} - ${Math.round((1 - row.gapRatio) * 100)}% below expected CTR`,
        was: `Expected CTR ${(row.expectedCTR * 100).toFixed(1)}%`,
        now: `Actual CTR ${(row.actualCTR * 100).toFixed(1)}%`,
        detail: `This page ranks at position ${row.position.toFixed(1)} with ${row.impressions.toLocaleString()} impressions. It achieves ${(row.actualCTR * 100).toFixed(1)}% CTR vs. expected ${(row.expectedCTR * 100).toFixed(1)}%, which is ${Math.round(row.gapRatio * 100)}% of the expected value. This could be improved with a better snippet.`,
        note: 'Consider testing a more compelling meta description or title tag.',
        source: row.page
      });
    }
    
    // Limit to reasonable number
    if (items.length >= 50) break;
  }
  
  // Add total
  items.push({
    status: 'TOTAL',
    headline: `Total clicks lost across all tracked pages: ${totalLostClicks.toLocaleString()}`,
    was: '',
    now: '',
    detail: `Aggregate analysis of all pages with ≥${MIN_IMPRESSIONS} impressions reveals a total of ${totalLostClicks.toLocaleString()} clicks lost over the analysis period due to CTR underperformance relative to position.`,
    note: 'Prioritize the losing pages first for the biggest impact.',
    source: ''
  });
  
  return items;
}

// ============================================================
// DEMO RUNNER
// ============================================================

async function runDemo(writeHTML) {
  out(`%s ${PITCH}`, C.dim('Demo mode:'));
  out('');
  
  // Simulate progress
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 200));
    line(`  ${bar(i + 1, 5)} Processing demo data...`);
  }
  endline();
  
  const items = DEMO;
  
  renderFindings(items);
  
  let htmlPath = null;
  if (writeHTML) {
    htmlPath = './low-ctr-page-finder-demo.html';
    const subject = 'Low CTR Page Finder — Demo Report';
    const body = items.map((item, idx) => {
      const status = item.status;
      const glyph = STATUS[status].glyph;
      return `<div class="item ${status}">
        <span class="glyph">${glyph}</span>
        <span class="headline">${item.headline}</span>
        <div class="meta">${item.was} ${item.now ? '→ ' + item.now : ''}</div>
        <div class="detail">${item.detail}</div>
        ${item.note ? `<div class="note">${NOTE_LABEL}: ${item.note}</div>` : ''}
        ${item.source ? `<div class="source">Source: ${item.source}</div>` : ''}
      </div>`;
    }).join('\n');
    
    const htmlContent = buildHTML({ subject, body });
    require('fs').writeFileSync(htmlPath, htmlContent);
  }
  
  renderSummary(items, htmlPath);
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help')) {
    out(`%s`, PITCH);
    out('');
    out('Usage:');
    for (const [arg, desc] of USAGE) {
      out(`  ${arg.padEnd(20)} ${desc}`);
    }
    return;
  }
  
  if (args.includes('--demo')) {
    const writeHTML = !args.includes('--no-html');
    await runDemo(writeHTML);
    return;
  }
  
  // Read input
  let input, sourceName;
  
  if (args.length === 0 || args[0] === '-') {
    // Read from stdin
    sourceName = 'stdin';
    const fs = require('fs');
    input = fs.readFileSync('/dev/stdin', 'utf-8');
  } else {
    // Read from file
    sourceName = args[0];
    const fs = require('fs');
    if (!fs.existsSync(sourceName)) {
      out(`%s: File not found: %s`, C.red('ERROR'), sourceName);
      process.exit(1);
    }
    input = fs.readFileSync(sourceName, 'utf-8');
  }
  
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    out(`%s: No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.`, C.amber('WARNING'));
    out(`  %s`, NO_SEARCH_NOTE);
    out('');
  }
  
  try {
    const items = await run(null, input, sourceName);
    renderFindings(items);
    
    // Write HTML report
    const htmlPath = './low-ctr-page-finder-report.html';
    const subject = `Low CTR Page Finder — Report for ${sourceName}`;
    const body = items.map((item, idx) => {
      const status = item.status;
      const glyph = STATUS[status].glyph;
      return `<div class="item ${status}">
        <span class="glyph">${glyph}</span>
        <span class="headline">${item.headline}</span>
        <div class="meta">${item.was} ${item.now ? '→ ' + item.now : ''}</div>
        <div class="detail">${item.detail}</div>
        ${item.note ? `<div class="note">${NOTE_LABEL}: ${item.note}</div>` : ''}
        ${item.source ? `<div class="source">Source: ${item.source}</div>` : ''}
      </div>`;
    }).join('\n');
    
    const htmlContent = buildHTML({ subject, body });
    require('fs').writeFileSync(htmlPath, htmlContent);
    
    renderSummary(items, htmlPath);
  } catch (err) {
    out(`%s: %s`, C.red('ERROR'), err.message);
    process.exit(1);
  }
}

main();
