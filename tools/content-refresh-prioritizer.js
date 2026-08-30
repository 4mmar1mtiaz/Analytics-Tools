#!/usr/bin/env node

// ============================================================
// AUTHOR
// ============================================================
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz

// ============================================================
// CONSTANTS
// ============================================================

const PITCH = "Prioritize content refresh tasks by traffic, decline, position and staleness";
const USAGE = [
  ['<file>', 'read CSV export from GA4 or Search Console'],
  ['-', 'read stdin'],
  ['--demo', 'see the output, spend nothing']
];
const STATUS = {
  WEEK: { glyph: '+', color: null, label: 'This Week' },
  MONTH: { glyph: '>', color: null, label: 'This Month' },
  LATER: { glyph: '-', color: null, label: 'Later' },
  FORMULA: { glyph: '*', color: null, label: 'Formula' },
  FAIL: { glyph: '!', color: null, label: 'Failed' }
};
const ITEM_NOUN = 'task';
const NOTE_LABEL = 'Note';
const NO_SEARCH_NOTE = 'All calculations done locally; no API key provided.';
const SUMMARY_NOTE = (items) => {
  const failCount = items.filter(i => i.status === 'FAIL').length;
  const taskCount = items.filter(i => i.status !== 'FAIL' && i.status !== 'FORMULA').length;
  return `${taskCount} tasks prioritized, ${failCount} items failed to parse.`;
};

// Colour functions
const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  teal: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  text: (s) => s
};
STATUS.WEEK.color = C.green;
STATUS.MONTH.color = C.amber;
STATUS.LATER.color = C.teal;
STATUS.FORMULA.color = C.dim;
STATUS.FAIL.color = C.red;

// ============================================================
// HELPERS
// ============================================================

function bold(text) { return `\x1b[1m${text}\x1b[0m`; }

function bar(i, total) {
  const w = 20;
  const filled = Math.round((i / total) * w);
  return '[' + '#'.repeat(filled) + '-'.repeat(w - filled) + ']';
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
  return text.substring(0, n - 3) + '...';
}

function pad(text, n) {
  const s = String(text);
  return s + ' '.repeat(Math.max(0, n - s.length));
}

function line(text) {
  process.stdout.write('\r\x1b[K' + text);
}

function endline() {
  process.stdout.write('\n');
}

function out(text) {
  console.log(text);
}

function parseJSON(text) {
  // First try JSON.parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // not valid JSON
  }

  // Try fenced block fallback
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (e) {
      // fall through
    }
  }

  // Brace-scan fallback: find first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1));
    } catch (e) {
      // fall through
    }
  }

  throw new Error('Cannot parse JSON from response: ' + text.substring(0, 100));
}

async function ask(P, { system, prompt, schema, search, maxTokens }) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (anthropicKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens || 7000,
        system: system,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    return data.content[0].text;
  } else if (openaiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: maxTokens || 7000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  } else if (geminiKey) {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + geminiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: system + '\n\n' + prompt }]
        }]
      })
    });
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } else {
    throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
  }
}

async function mapLimit(items, limit, fn) {
  const results = [];
  const executing = [];

  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i));
    results.push(p);

    if (limit > 0 && limit < items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

// Quoted field reader for CSV
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function cleanNumber(str) {
  if (!str) return 0;
  let s = str.replace(/[$,%]/g, '').trim();
  // Handle time strings like "1m 24s"
  const timeMatch = s.match(/(\d+)\s*m\s*(\d+)\s*s/);
  if (timeMatch) {
    return parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
  }
  s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function renderFindings(items) {
  out('\n' + bold('📋 PRIORITY QUEUE'));
  out('='.repeat(60));

  const sorted = items.filter(i => i.status !== 'FORMULA').sort((a, b) => {
    const order = { WEEK: 0, MONTH: 1, LATER: 2, FAIL: 3 };
    return (order[a.status] || 99) - (order[b.status] || 99);
  });

  for (const item of sorted) {
    const s = STATUS[item.status] || STATUS.FAIL;
    const colorFn = s.color || C.text;
    const rank = items.indexOf(item) + 1;
    out('');
    out(`${s.glyph} ${colorFn(bold(`#${rank}: ${item.headline}`))}`);
    if (item.was || item.now) {
      out(`   ${C.dim('Was:')} ${item.was}  ${C.dim('Now:')} ${item.now}`);
    }
    out(`   ${item.detail}`);
    if (item.note) {
      out(`   ${C.dim('→')} ${item.note}`);
    }
    if (item.source) {
      out(`   ${C.dim('Source:')} ${item.source}`);
    }
  }

  // Print formula item last
  const formula = items.find(i => i.status === 'FORMULA');
  if (formula) {
    out('');
    out(`* ${C.dim(bold(formula.headline))}`);
    out(`   ${formula.detail}`);
  }
}

function renderSummary(items, htmlPath) {
  const failCount = items.filter(i => i.status === 'FAIL').length;
  const taskCount = items.filter(i => i.status !== 'FAIL' && i.status !== 'FORMULA').length;
  const weekCount = items.filter(i => i.status === 'WEEK').length;
  const monthCount = items.filter(i => i.status === 'MONTH').length;
  const laterCount = items.filter(i => i.status === 'LATER').length;

  out('\n' + bold('📊 SUMMARY'));
  out('='.repeat(40));
  out(`${C.green(bold(weekCount))} tasks this week`);
  out(`${C.amber(bold(monthCount))} tasks this month`);
  out(`${C.teal(bold(laterCount))} tasks later`);
  if (failCount > 0) {
    out(`${C.red(bold(failCount))} items failed to parse`);
  }
  out(`${C.dim(SUMMARY_NOTE(items))}`);
  if (htmlPath) {
    out(`${C.green('📄 Report written to:')} ${htmlPath}`);
  }
}

function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Content Refresh Prioritizer</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; color: #333; }
  h1 { color: #1a1a2e; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5em; }
  h2 { color: #16213e; margin-top: 2em; }
  .task { background: #f8f9fa; border-left: 4px solid #6c757d; padding: 1em; margin: 1em 0; border-radius: 4px; }
  .task.WEEK { border-left-color: #28a745; }
  .task.MONTH { border-left-color: #ffc107; }
  .task.LATER { border-left-color: #17a2b8; }
  .task.FAIL { border-left-color: #dc3545; }
  .task.FORMULA { border-left-color: #6c757d; opacity: 0.7; }
  .headline { font-weight: bold; font-size: 1.1em; margin-bottom: 0.5em; }
  .detail { margin: 0.5em 0; line-height: 1.5; }
  .note { color: #6c757d; font-style: italic; margin-top: 0.5em; }
  .source { font-size: 0.9em; color: #6c757d; word-break: break-all; }
  .meta { display: flex; gap: 1em; font-size: 0.9em; color: #495057; margin-top: 0.5em; }
  .summary { background: #e9ecef; padding: 1em; border-radius: 4px; margin: 1em 0; }
  .note-box { background: #fff3cd; border: 1px solid #ffc107; padding: 0.75em; border-radius: 4px; margin: 1em 0; }
</style>
</head>
<body>
<h1>Content Refresh Prioritizer</h1>
<div class="note-box">${NO_SEARCH_NOTE}</div>
<h2>Priority Queue</h2>
${body}
</body>
</html>`;
}

// ============================================================
// DEMO DATA
// ============================================================

const DEMO = [
  {
    status: 'WEEK',
    headline: '/guides/seo-audit-checklist',
    was: 'Score: 92, Position: 3 → 8',
    now: 'WEEK #1, Score: 88',
    detail: 'Traffic dropped 35% YoY while position slipped from 3 to 8. Content is 18 months old, competitors published 3 updated guides. 4.2K monthly traffic at risk. High authority domain needs immediate refresh.',
    note: 'Update statistics, add 2025 best practices, improve internal linking',
    source: 'https://search.google.com/search-console?q=/guides/seo-audit-checklist'
  },
  {
    status: 'WEEK',
    headline: '/blog/on-page-seo-techniques',
    was: 'Score: 85, Position: 5 → 12',
    now: 'WEEK #2, Score: 82',
    detail: 'Page fell from position 5 to 12 over 6 months. Traffic declined 45%. Content is 2 years old with thin sections that lack depth. Featured snippet lost to competitor. 3.1K monthly visits declining.',
    note: 'Expand to 2500+ words, add structured data, target featured snippet',
    source: 'https://analytics.google.com/analytics?q=/blog/on-page-seo-techniques'
  },
  {
    status: 'WEEK',
    headline: '/resources/template-library',
    was: 'Score: 78, Position: 2 → 6',
    now: 'WEEK #3, Score: 79',
    detail: 'High-value template page dropped from position 2 to 6. Traffic down 28% despite strong backlink profile. Content has broken download links and outdated screenshots from 2023. 5.8K monthly traffic at immediate risk.',
    note: 'Fix broken assets, update screenshots, add new templates for 2025',
    source: 'https://search.google.com/search-console?q=/resources/template-library'
  },
  {
    status: 'MONTH',
    headline: '/case-studies/startup-growth',
    was: 'Score: 72, Position: 9 → 14',
    now: 'MONTH #4, Score: 74',
    detail: 'Case study page fell from position 9 to 14. Traffic down 22% YoY. Content references 2022-era tools and metrics that feel dated. Companies mentioned have rebranded. 2.4K monthly visits, moderate priority.',
    note: 'Refresh with current metrics, update company names, add 2025 results',
    source: 'https://analytics.google.com/analytics?q=/case-studies/startup-growth'
  },
  {
    status: 'MONTH',
    headline: '/docs/api-authentication',
    was: 'Score: 68, Position: 4 → 7',
    now: 'MONTH #5, Score: 71',
    detail: 'Technical documentation page declining from position 4 to 7. Traffic dropped 18% despite high click-through rate. API examples use deprecated v2 endpoints. 1.9K monthly visits from developers needing current docs.',
    note: 'Update all code examples to v3, add OAuth 2.0 flow diagrams',
    source: 'https://search.google.com/search-console?q=/docs/api-authentication'
  },
  {
    status: 'LATER',
    headline: '/about/our-team',
    was: 'Score: 55, Position: 3 → 5',
    now: 'LATER #6, Score: 62',
    detail: 'Team page has 3 staff who left the company. New hires not listed. Traffic is low (800/mo) but this is a trust signal page for enterprise prospects. Moderate update needed.',
    note: 'Remove departed staff, add new team members, update headshots',
    source: 'https://analytics.google.com/analytics?q=/about/our-team'
  },
  {
    status: 'FAIL',
    headline: '/pricing',
    was: 'Score: N/A, Position: unknown',
    now: 'FAIL #7',
    detail: 'Could not parse this row: missing required field "traffic". CSV line was: "pricing,5,,15%,2022-01-01". The comma-separated values did not include monthly traffic volume.',
    note: '',
    source: 'pricing line in export'
  }
];

// ============================================================
// CORE LOGIC
// ============================================================

async function run(P, input, sourceName) {
  const items = [];
  const lines = input.split('\n');

  // Find header row
  let headerIdx = -1;
  let headerLine = '';
  const requiredFields = ['path', 'traffic', 'decline', 'position', 'date'];
  
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith('#')) continue;
    const fields = parseCSVLine(l);
    const fieldSet = new Set(fields.map(f => f.toLowerCase().trim()));
    if (requiredFields.every(r => fieldSet.has(r))) {
      headerIdx = i;
      headerLine = l;
      break;
    }
  }

  if (headerIdx === -1) {
    items.push({
      status: 'FAIL',
      headline: 'No valid header found',
      was: '',
      now: '',
      detail: `Could not find a CSV header row containing ${requiredFields.join(', ')}. Found ${lines.length} lines.`,
      note: '',
      source: sourceName
    });
    return items;
  }

  const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().trim());
  const pathIdx = headers.indexOf('path');
  const trafficIdx = headers.indexOf('traffic');
  const declineIdx = headers.indexOf('decline');
  const positionIdx = headers.indexOf('position');
  const dateIdx = headers.indexOf('date');

  let skipped = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    const fields = parseCSVLine(l);
    const path = fields[pathIdx];
    if (!path) { skipped++; continue; }

    const traffic = cleanNumber(fields[trafficIdx]);
    const decline = cleanNumber(fields[declineIdx]);
    const position = cleanNumber(fields[positionIdx]);
    const date = fields[dateIdx] || '';

    if (traffic === 0 && decline === 0 && position === 0) { skipped++; continue; }

    // Calculate scores
    const WEIGHTS = {
      traffic: 0.40,
      decline: 0.25,
      position: 0.20,
      staleness: 0.15
    };

    // Traffic score (0-100): normalized by log
    const trafficScore = Math.min(100, (Math.log10(traffic + 1) / 5) * 100);

    // Decline score (0-100): higher decline = higher score
    const declineScore = Math.min(100, decline * 2);

    // Position score (0-100): closer to page one = higher
    const positionScore = Math.max(0, 100 - (position - 1) * 8);

    // Staleness score (0-100): older = higher
    let stalenessScore = 50; // default
    if (date) {
      const ageMonths = (Date.now() - new Date(date).getTime()) / (30 * 24 * 60 * 60 * 1000);
      stalenessScore = Math.min(100, ageMonths * 5);
    }

    const totalScore = Math.round(
      trafficScore * WEIGHTS.traffic +
      declineScore * WEIGHTS.decline +
      positionScore * WEIGHTS.position +
      stalenessScore * WEIGHTS.staleness
    );

    // Estimate effort
    let effort_hours = 2; // default
    let do_what = 'edit';
    if (position >= 11 && position <= 15 && stalenessScore < 50) {
      effort_hours = 3;
      do_what = 'page edit';
    }
    if (decline > 60 && stalenessScore > 70) {
      effort_hours = 8;
      do_what = 'rewrite';
    }
    // Consolidation check: if paths share a common prefix
    const similar = items.filter(it => it.headline.startsWith(path.substring(0, 20)));
    if (similar.length > 0) {
      effort_hours = 6;
      do_what = 'consolidate';
    }

    const item = {
      status: 'LATER',
      headline: path,
      was: `Traffic: ${traffic}, Position: ${position}`,
      now: `Score: ${totalScore}`,
      detail: `Traffic score ${Math.round(trafficScore)}, decline ${Math.round(declineScore)}, position ${Math.round(positionScore)}, staleness ${Math.round(stalenessScore)}. ${do_what} (~${effort_hours}h)`,
      note: '',
      source: sourceName
    };

    items.push(item);
  }

  // Sort by score descending, take top 20
  items.sort((a, b) => {
    const aScore = parseInt(a.now.replace('Score: ', ''));
    const bScore = parseInt(b.now.replace('Score: ', ''));
    return bScore - aScore;
  });

  const top20 = items.slice(0, 20);

  // Add FORMULA item
  top20.push({
    status: 'FORMULA',
    headline: 'Priority Formula: traffic 40% + decline 25% + position 20% + staleness 15%',
    was: '',
    now: '',
    detail: 'Traffic score: log-normalized monthly visits. Decline: doubled percentage drop. Position: 100 minus (rank-1)*8. Staleness: age in months * 5. All capped at 0-100.',
    note: '',
    source: ''
  });

  // Try API call if key available
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  
  if (hasKey) {
    try {
      const itemsForAPI = top20.filter(i => i.status !== 'FORMULA').slice(0, 20);
      const prompt = `Given these ${itemsForAPI.length} content items with scores and context, produce a queue of what to do with each. Return JSON: { queue: [ { path: string, do_what: string, effort_hours: number, expected_result: string } ] }\n\nItems:\n${JSON.stringify(itemsForAPI, null, 2)}`;
      const response = await ask(null, {
        system: 'You are a content strategy assistant. Analyze each item and produce a prioritized action plan.',
        prompt: prompt,
        schema: true,
        search: false,
        maxTokens: 7000
      });
      const data = parseJSON(response);
      if (data && data.queue) {
        for (let i = 0; i < data.queue.length && i < top20.length; i++) {
          const q = data.queue[i];
          const item = top20[i];
          if (q.do_what) {
            item.detail += ` | Do: ${q.do_what} (~${q.effort_hours || 2}h) -> ${q.expected_result || 'improved performance'}`;
            item.note = `Estimated effort: ${q.effort_hours || 2}h`;
          }
        }
      }
    } catch (e) {
      // If API fails, continue with local estimates
      top20.push({
        status: 'FAIL',
        headline: 'API call failed',
        was: '',
        now: '',
        detail: `Could not enhance items with AI: ${e.message}. Using local effort estimates.`,
        note: '',
        source: ''
      });
    }
  } else {
    // No API key - add note to each item
    for (const item of top20) {
      if (item.status !== 'FORMULA') {
        item.note = NO_SEARCH_NOTE;
      }
    }
  }

  // Assign status based on rank
  for (let i = 0; i < top20.length; i++) {
    if (top20[i].status === 'FORMULA' || top20[i].status === 'FAIL') continue;
    if (i < 5) top20[i].status = 'WEEK';
    else if (i < 15) top20[i].status = 'MONTH';
    else top20[i].status = 'LATER';
  }

  return top20;
}

async function runDemo(writeHTML) {
  line('Running demo...');
  await new Promise(r => setTimeout(r, 500));
  line('Processing demo data...');
  await new Promise(r => setTimeout(r, 500));
  endline();

  renderFindings(DEMO);

  if (writeHTML) {
    const htmlPath = './content-refresh-prioritizer-demo.html';
    const body = DEMO.map(item => {
      const s = STATUS[item.status] || STATUS.FAIL;
      return `<div class="task ${item.status}">
        <div class="headline">${item.headline}</div>
        <div class="detail">${item.detail}</div>
        ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
        ${item.source ? `<div class="source">Source: ${item.source}</div>` : ''}
        <div class="meta">
          <span>${s.label}</span>
          ${item.was ? `<span>Was: ${item.was}</span>` : ''}
          ${item.now ? `<span>Now: ${item.now}</span>` : ''}
        </div>
      </div>`;
    }).join('\n');

    const html = buildHTML({ subject: 'Demo Report', body });
    require('fs').writeFileSync(htmlPath, html);
    renderSummary(DEMO, htmlPath);
  } else {
    renderSummary(DEMO, null);
  }
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    out(bold(PITCH));
    out('');
    out(bold('Usage:'));
    for (const [arg, desc] of USAGE) {
      out(`  ${pad(arg, 12)} ${desc}`);
    }
    out('');
    out(bold('Environment:'));
    out(`  ${pad('ANTHROPIC_API_KEY', 20)} Use Claude`);
    out(`  ${pad('OPENAI_API_KEY', 20)} Use GPT-4o`);
    out(`  ${pad('GEMINI_API_KEY', 20)} Use Gemini 2.0`);
    process.exit(0);
  }

  if (args.includes('--demo')) {
    const writeHTML = args.includes('--html');
    await runDemo(writeHTML);
    process.exit(0);
  }

  // Read input
  let input = '';
  let sourceName = '';

  if (args.length === 0 || args[0] === '-') {
    // Read stdin
    sourceName = 'stdin';
    input = await new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
    });
  } else {
    sourceName = args[0];
    try {
      input = require('fs').readFileSync(args[0], 'utf8');
    } catch (e) {
      out(C.red(`Error reading file: ${e.message}`));
      process.exit(1);
    }
  }

  if (!input.trim()) {
    out(C.red('No input data found.'));
    out('Usage: node content-refresh-prioritizer.js <file.csv>');
    process.exit(1);
  }

  line('Processing...');
  const items = await run(null, input, sourceName);
  endline();

  renderFindings(items);

  // Write HTML report
  const htmlPath = './content-refresh-prioritizer-report.html';
  const body = items.map(item => {
    const s = STATUS[item.status] || STATUS.FAIL;
    return `<div class="task ${item.status}">
      <div class="headline">${item.headline}</div>
      <div class="detail">${item.detail}</div>
      ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
      ${item.source ? `<div class="source">Source: ${item.source}</div>` : ''}
      <div class="meta">
        <span>${s.label}</span>
        ${item.was ? `<span>Was: ${item.was}</span>` : ''}
        ${item.now ? `<span>Now: ${item.now}</span>` : ''}
      </div>
    </div>`;
  }).join('\n');

  const html = buildHTML({ subject: 'Report', body });
  require('fs').writeFileSync(htmlPath, html);
  renderSummary(items, htmlPath);
}

main().catch(e => {
  out(C.red(`Fatal error: ${e.message}`));
  process.exit(1);
});
