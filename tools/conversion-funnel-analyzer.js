#!/usr/bin/env node
// Ammar Imtiaz
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz

// =============================================================================
// COLOUR FUNCTIONS (C)
// =============================================================================
const C = {
    green: (s) => `\x1b[32m${s}\x1b[39m`,
    amber: (s) => `\x1b[33m${s}\x1b[39m`,
    red: (s) => `\x1b[31m${s}\x1b[39m`,
    teal: (s) => `\x1b[36m${s}\x1b[39m`,
    dim: (s) => `\x1b[90m${s}\x1b[39m`,
    text: (s) => s,
};

// =============================================================================
// STATUS CONSTANTS
// =============================================================================
const STATUS = {
    BOTTLENECK: { glyph: '!', color: C.red, label: 'Bottleneck' },
    LEAK: { glyph: '-', color: C.amber, label: 'Leak' },
    HOLDING: { glyph: '+', color: C.green, label: 'Holding' },
    PRIZE: { glyph: '*', color: C.teal, label: 'Prize' },
    FAIL: { glyph: 'x', color: C.red, label: 'Error' },
};

// =============================================================================
// CONSTANTS
// =============================================================================
const PITCH = 'Analyze a conversion funnel to find the biggest drop-off and estimate the prize of fixing it.';
const USAGE = [
    ['<input>', 'path to a CSV/TSV file with funnel data'],
    ['-', 'read from stdin'],
    ['--demo', 'run the demo with sample data, no API key needed'],
];
const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'What to do';
const NO_SEARCH_NOTE = 'No API key was found (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY). The numbers and bottleneck are computed in full; the causes and fixes are not available without a live search.';

// =============================================================================
// DEMO DATA
// =============================================================================
const DEMO = [
    {
        status: 'BOTTLENECK',
        headline: 'Home Page → Product Page drops 62% — the worst step',
        was: '125,430 users',
        now: '47,230 users',
        detail: 'This step loses 78,200 users (62.3% drop). The button reads "Shop Now" but AB tests show "Browse Products" improves click-through by 34%. The page loads in 3.2s on mobile; targeting 1.5s could recover ~12,000 users.',
        note: 'Fix: change CTA text + optimize LCP to under 2s. Estimated recovery: +15,200 users.',
        source: '',
    },
    {
        status: 'LEAK',
        headline: 'Product Page → Cart loses 47% of remaining users',
        was: '47,230 users',
        now: '25,130 users',
        detail: '22,100 users leave without adding to cart. Most drop on mobile where "Add to Cart" is below the fold. Three of the top five exit pages are product pages with no pricing visible before scrolling.',
        note: 'Fix: sticky "Add to Cart" + show price in the hero. Could recover +8,300 users.',
        source: '',
    },
    {
        status: 'LEAK',
        headline: 'Cart → Checkout Start drops 38%',
        was: '25,130 users',
        now: '15,580 users',
        detail: '9,550 users abandon cart without starting checkout. Cart page has a 6-field address form visible immediately; showing a progress bar and guest option reduces abandonment by 25% in similar funnels.',
        note: 'Fix: one-click checkout (Shop Pay / Apple Pay) + guest toggle. Potential: +3,800 users.',
        source: '',
    },
    {
        status: 'HOLDING',
        headline: 'Checkout Start → Payment Info holds at 88%',
        was: '15,580 users',
        now: '13,710 users',
        detail: 'Only 1,870 users drop here (12%). This is the best-performing step. The checkout form is clean and the trust signals (SSL, returns) are visible.',
        note: 'Already strong. No immediate fix needed, but monitor if traffic volume increases.',
        source: '',
    },
    {
        status: 'HOLDING',
        headline: 'Payment Info → Purchase Confirmation holds at 94%',
        was: '13,710 users',
        now: '12,887 users',
        detail: '823 users fail here (6%). Most failures are declined cards (41%) or timeouts (33%). These are operational issues, not UX.',
        note: 'Add real-time card validation + retry logic. Could recover ~200 users.',
        source: '',
    },
    {
        status: 'PRIZE',
        headline: 'If the bottleneck step matched the best step, the funnel gains 12,235 more conversions',
        was: '12,887 users → 12,887 conversions',
        now: '25,122 users → 25,122 conversions',
        detail: 'The bottleneck loses 78,200 users at the first step. If that step held 88% like the best step (Payment Info), 68,816 more users would proceed, and at the final conversion rate (10.3% of original), the funnel would produce 25,122 conversions instead of 12,887 — a gain of 12,235.',
        note: 'This is the prize: +12,235 conversions from fixing one step. At a $45 AOV, that is $550,575 in additional revenue.',
        source: '',
    },
];

// =============================================================================
// HELPER: line, endline, out
// =============================================================================
let lastLineLength = 0;

function line(text) {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
    process.stdout.write('\r' + ' '.repeat(lastLineLength) + '\r' + text);
    lastLineLength = clean.length;
}

function endline() {
    process.stdout.write('\n');
    lastLineLength = 0;
}

function out(text) {
    console.log(text);
}

// =============================================================================
// HELPER: bold, bar, wrap, clip, pad
// =============================================================================
function bold(text) {
    return `\x1b[1m${text}\x1b[22m`;
}

function bar(i, total) {
    const w = 20;
    const filled = Math.round((i / total) * w);
    const empty = w - filled;
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
            line += ' ' + w;
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

// =============================================================================
// HELPER: parseJSON
// =============================================================================
function parseJSON(text) {
    // direct parse
    try {
        return JSON.parse(text);
    } catch (e) {
        // fallback: try to extract from a fenced block
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenced) {
            try {
                return JSON.parse(fenced[1]);
            } catch (e2) {
                // fall through
            }
        }
        // brace-scan fallback: find the first { and last }
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch (e3) {
                // fall through
            }
        }
        throw new Error('Cannot parse JSON from response. Text: ' + text.slice(0, 200));
    }
}

// =============================================================================
// HELPER: mapLimit
// =============================================================================
async function mapLimit(items, limit, fn) {
    const results = [];
    const executing = [];
    for (let i = 0; i < items.length; i++) {
        const p = Promise.resolve().then(() => fn(items[i], i));
        results.push(p);
        if (limit <= items.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

// =============================================================================
// HELPER: ask
// =============================================================================
async function ask(P, { system, prompt, schema, search, maxTokens }) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
    let provider = '';
    let url = '';
    let headers = {};
    let body = {};

    if (process.env.ANTHROPIC_API_KEY) {
        provider = 'anthropic';
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        };
        body = {
            model: 'claude-3-haiku-20240307',
            max_tokens: maxTokens || 6000,
            system: system,
            messages: [{ role: 'user', content: prompt }],
        };
    } else if (process.env.OPENAI_API_KEY) {
        provider = 'openai';
        url = 'https://api.openai.com/v1/chat/completions';
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        };
        body = {
            model: 'gpt-4o-mini',
            max_tokens: maxTokens || 6000,
            messages: [
                { role: 'system', content: system || '' },
                { role: 'user', content: prompt },
            ],
        };
    } else if (process.env.GEMINI_API_KEY) {
        provider = 'gemini';
        url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        headers = { 'Content-Type': 'application/json' };
        body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens || 6000 },
        };
    } else {
        throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
    }

    line(`  ${C.dim('→')} calling ${C.teal(provider)} API...`);
    const https = require('https');
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: headers,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    let text = '';
                    if (provider === 'anthropic') {
                        text = parsed.content?.[0]?.text || parsed.content?.[0]?.body || '';
                    } else if (provider === 'openai') {
                        text = parsed.choices?.[0]?.message?.content || '';
                    } else if (provider === 'gemini') {
                        text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    }
                    if (!text) {
                        reject(new Error('Empty response from API. Response: ' + JSON.stringify(parsed).slice(0, 300)));
                    } else {
                        resolve(text);
                    }
                } catch (e) {
                    reject(new Error('Failed to parse API response: ' + e.message + ' Data: ' + data.slice(0, 300)));
                }
            });
        });
        req.on('error', (e) => reject(new Error('API request failed: ' + e.message)));
        req.write(JSON.stringify(body));
        req.end();
    });
}

// =============================================================================
// HELPER: renderFindings
// =============================================================================
function renderFindings(items) {
    const statusWidth = Math.max(...Object.values(STATUS).map(s => s.label.length));
    for (const item of items) {
        const st = STATUS[item.status];
        if (!st) continue;
        const glyph = st.glyph;
        const color = st.color;
        const label = pad(st.label, statusWidth);
        const headline = item.headline;
        out(`  ${color(glyph)} ${color(label)}  ${bold(headline)}`);
        if (item.was || item.now) {
            const was = item.was || '—';
            const now = item.now || '—';
            out(`        ${C.dim('was:')} ${was}  ${C.dim('now:')} ${now}`);
        }
        // detail wrapped
        const wrapped = wrap(item.detail, 72);
        const detailLines = wrapped.split('\n');
        for (const dl of detailLines) {
            out(`        ${C.dim('|')} ${dl}`);
        }
        if (item.note) {
            out(`        ${C.teal('→')} ${item.note}`);
        }
        if (item.source) {
            out(`        ${C.dim('source:')} ${item.source}`);
        }
        out('');
    }
}

// =============================================================================
// HELPER: renderSummary
// =============================================================================
function renderSummary(items, htmlPath) {
    const statusCounts = {};
    for (const item of items) {
        statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
    }
    out(C.dim('─'.repeat(50)));
    out(bold(' Summary'));
    for (const [key, st] of Object.entries(STATUS)) {
        const count = statusCounts[key] || 0;
        if (count > 0) {
            out(`  ${st.glyph} ${st.label}: ${count}`);
        }
    }
    out(C.dim('─'.repeat(50)));
    if (htmlPath) {
        out(`  ${C.green('✔')} HTML report written to ${C.teal(htmlPath)}`);
    } else {
        out(`  ${C.dim('no HTML file written (--no-html or demo without write)')}`);
    }
    const note = SUMMARY_NOTE(items);
    if (note) {
        out(`  ${C.dim('→')} ${note}`);
    }
    out('');
}

// =============================================================================
// HELPER: SUMMARY_NOTE
// =============================================================================
function SUMMARY_NOTE(items) {
    const prize = items.find(i => i.status === 'PRIZE');
    if (prize) {
        return prize.note || '';
    }
    return '';
}

// =============================================================================
// HELPER: buildHTML
// =============================================================================
function buildHTML({ subject, body }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; color: #1a1a2e; background: #f8f9fa; }
  h1 { color: #16213e; border-bottom: 2px solid #0f3460; padding-bottom: 0.3em; }
  h2 { color: #0f3460; margin-top: 1.5em; }
  .item { background: #fff; border-radius: 8px; padding: 1em 1.5em; margin: 1em 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-left: 4px solid #ccc; }
  .item.bottleneck { border-left-color: #e74c3c; }
  .item.leak { border-left-color: #f39c12; }
  .item.holding { border-left-color: #27ae60; }
  .item.prize { border-left-color: #3498db; }
  .item.fail { border-left-color: #c0392b; }
  .item .status { font-weight: 600; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; }
  .item .status.bottleneck { color: #e74c3c; }
  .item .status.leak { color: #f39c12; }
  .item .status.holding { color: #27ae60; }
  .item .status.prize { color: #3498db; }
  .item .status.fail { color: #c0392b; }
  .item h3 { margin: 0.3em 0; color: #16213e; }
  .item .detail { margin: 0.5em 0; line-height: 1.5; color: #444; }
  .item .wasnow { font-size: 0.9em; color: #666; margin: 0.3em 0; }
  .item .note { margin: 0.5em 0; padding: 0.5em; background: #eaf2f8; border-radius: 4px; color: #1a5276; }
  .item .source { font-size: 0.85em; color: #999; }
  .summary { background: #fff; border-radius: 8px; padding: 1em 1.5em; margin: 1em 0; }
  .summary table { width: 100%; border-collapse: collapse; }
  .summary td, .summary th { padding: 0.5em; text-align: left; border-bottom: 1px solid #eee; }
  .note-free { background: #fef9e7; border-left: 4px solid #f1c40f; padding: 0.8em 1em; border-radius: 4px; margin: 1em 0; }
  .footer { margin-top: 2em; font-size: 0.85em; color: #999; text-align: center; }
  .glyph { font-weight: bold; margin-right: 0.3em; }
</style>
</head>
<body>
<h1>${subject}</h1>
${body}
<div class="footer">Generated by Conversion Funnel Analyzer</div>
</body>
</html>`;
}

// =============================================================================
// HELPER: parseInput
// =============================================================================
function parseInput(text, sourceName) {
    const lines = text.split('\n');
    // find header: look for lines that contain 'step' or 'name' or 'users' or matching pattern
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (lower.includes('step') || lower.includes('name') || lower.includes('users') || lower.includes('event') || lower.includes('page')) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) {
        throw new Error('Could not find a header row in the input. Expected columns like "Step Name" and "Users".');
    }
    const headerLine = lines[headerIdx];
    // parse columns (simple quoted-field reader)
    const cols = parseCSVLine(headerLine);
    // find step name column and users column
    let stepCol = -1;
    let usersCol = -1;
    const lowerCols = cols.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    for (let i = 0; i < lowerCols.length; i++) {
        if (lowerCols[i].includes('step') || lowerCols[i].includes('name') || lowerCols[i].includes('event') || lowerCols[i].includes('page') || lowerCols[i] === 'source' || lowerCols[i] === 'medium') {
            if (stepCol === -1) stepCol = i;
        }
        if (lowerCols[i].includes('users') || lowerCols[i].includes('count') || lowerCols[i] === 'user' || lowerCols[i] === 'totalusers' || lowerCols[i] === 'activeusers') {
            usersCol = i;
        }
    }
    // also try 'sessions' or 'transactions' as alternative
    if (usersCol === -1) {
        for (let i = 0; i < lowerCols.length; i++) {
            if (lowerCols[i].includes('session') || lowerCols[i].includes('transaction') || lowerCols[i].includes('conversion') || lowerCols[i].includes('eventcount')) {
                usersCol = i;
            }
        }
    }
    if (stepCol === -1 || usersCol === -1) {
        throw new Error(`Could not find required columns. Found columns: ${cols.join(', ')}. Need a step/name column and a users/count column.`);
    }
    const steps = [];
    let skipped = 0;
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // skip comment lines
        if (line.startsWith('#') || line.startsWith('//')) continue;
        const fields = parseCSVLine(line);
        if (fields.length <= Math.max(stepCol, usersCol)) {
            skipped++;
            continue;
        }
        const stepName = fields[stepCol].trim();
        if (!stepName) {
            skipped++;
            continue;
        }
        const rawUsers = fields[usersCol].trim();
        // clean the number
        const cleaned = rawUsers.replace(/[$,%]/g, '').replace(/,/g, '').trim();
        // handle time strings like "1m 24s" -> just skip, not a number
        if (/^[\d.]+$/.test(cleaned)) {
            const users = parseInt(cleaned, 10);
            if (!isNaN(users) && users >= 0) {
                steps.push({ step: stepName, users });
            } else {
                skipped++;
            }
        } else {
            skipped++;
        }
    }
    return { steps, skipped, sourceName };
}

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
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

// =============================================================================
// HELPER: computeFunnel
// =============================================================================
function computeFunnel(steps) {
    if (steps.length === 0) {
        return { items: [], bottleneckIdx: -1, prize: 0 };
    }
    const items = [];
    let bottleneckIdx = 0;
    let maxDrop = 0;
    let prevUsers = steps[0].users;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const users = step.users;
        // conversion rate from previous step
        const stepRate = i === 0 ? 100.0 : (prevUsers > 0 ? (users / prevUsers) * 100 : 0);
        const cumRate = (users / steps[0].users) * 100;
        const drop = i === 0 ? 0 : prevUsers - users;
        const dropPct = i === 0 ? 0 : (prevUsers > 0 ? (drop / prevUsers) * 100 : 0);
        if (i > 0 && drop > maxDrop) {
            maxDrop = drop;
            bottleneckIdx = i;
        }
        items.push({
            step: step.step,
            users,
            stepRate: Math.round(stepRate * 10) / 10,
            cumRate: Math.round(cumRate * 10) / 10,
            drop,
            dropPct: Math.round(dropPct * 10) / 10,
        });
        prevUsers = users;
    }
    // compute prize: if bottleneck step rate matched the best step rate
    let bestRate = 0;
    for (const item of items) {
        if (item.stepRate > bestRate && item.step !== items[0].step) {
            bestRate = item.stepRate;
        }
    }
    const bottleneck = items[bottleneckIdx];
    const bottleneckUsers = bottleneck.users;
    const bottleneckPrev = bottleneckIdx > 0 ? items[bottleneckIdx - 1].users : bottleneck.users;
    const bottleneckStepRate = bottleneck.stepRate;
    let prize = 0;
    if (bestRate > bottleneckStepRate && bottleneckPrev > 0) {
        // how many would pass if it matched best rate
        const wouldPass = Math.round(bottleneckPrev * (bestRate / 100));
        const extraUsers = wouldPass - bottleneckUsers;
        // then apply final conversion rate (last step / first step)
        const lastItem = items[items.length - 1];
        const finalConvRate = lastItem.users / steps[0].users;
        prize = Math.round(extraUsers * finalConvRate);
    }
    return { items, bottleneckIdx, prize };
}

// =============================================================================
// HELPER: buildFunnelItems
// =============================================================================
function buildFunnelItems(computed, aiItems) {
    const result = [];
    const { items, bottleneckIdx, prize } = computed;
    // build step items
    for (let i = 0; i < items.length; i++) {
        const ci = items[i];
        const ai = aiItems ? aiItems.find(a => a.step === ci.step) : null;
        let status = 'HOLDING';
        if (i === bottleneckIdx) {
            status = 'BOTTLENECK';
        } else if (i > 0 && ci.dropPct > 50) {
            status = 'LEAK';
        }
        const detail = ai && ai.likely_cause && ai.fix
            ? `Step conversion: ${ci.stepRate}% (${ci.dropPct}% drop). Cumulative: ${ci.cumRate}%. Likely cause: ${ai.likely_cause}. Fix: ${ai.fix}.`
            : `Step conversion: ${ci.stepRate}% (${ci.dropPct}% drop). Cumulative: ${ci.cumRate}%.`;
        result.push({
            status,
            headline: `${ci.step}: ${ci.users} users (${ci.cumRate}% cumulative)`,
            was: i === 0 ? `${ci.users} starting` : `${items[i - 1].users} entering`,
            now: `${ci.users} continuing`,
            detail,
            note: ai && ai.confidence ? `Confidence: ${ai.confidence}` : '',
            source: '',
        });
    }
    // add prize item
    if (prize > 0) {
        const bestRate = Math.max(...items.filter((_, idx) => idx > 0).map(it => it.stepRate));
        const bottleneck = items[bottleneckIdx];
        const bottleneckPrev = bottleneckIdx > 0 ? items[bottleneckIdx - 1].users : bottleneck.users;
        const wouldPass = Math.round(bottleneckPrev * (bestRate / 100));
        const lastItem = items[items.length - 1];
        const wouldFinal = Math.round(wouldPass * (lastItem.users / items[0].users));
        result.push({
            status: 'PRIZE',
            headline: `Prize: ${prize} extra conversions if bottleneck matches best step`,
            was: `${lastItem.users} conversions`,
            now: `${wouldFinal} conversions`,
            detail: `If "${bottleneck.step}" matched the best step rate (${bestRate}% instead of ${bottleneck.stepRate}%), ${wouldPass} users would proceed instead of ${bottleneck.users}. At final conversion rate, that yields ${wouldFinal} conversions instead of ${lastItem.users} — a gain of ${prize}.`,
            note: `This is the prize: ${prize} additional conversions from fixing one step.`,
            source: '',
        });
    }
    return result;
}

// =============================================================================
// HELPER: runDemo
// =============================================================================
async function runDemo(writeHTML) {
    line(`  ${C.dim('→')} Running demo mode...`);
    await new Promise(r => setTimeout(r, 300));
    endline();
    line(`  ${C.dim('→')} Computing funnel metrics (demo data)...`);
    await new Promise(r => setTimeout(r, 200));
    endline();
    line(`  ${C.dim('→')} No live search (demo mode)...`);
    await new Promise(r => setTimeout(r, 200));
    endline();
    renderFindings(DEMO);
    let htmlPath = null;
    if (writeHTML) {
        htmlPath = './conversion-funnel-analyzer-demo.html';
        const itemsForHTML = DEMO;
        const bodyLines = [];
        for (const item of itemsForHTML) {
            const st = STATUS[item.status];
            const cls = item.status.toLowerCase();
            const wasnow = (item.was || item.now) ? `<div class="wasnow">was: ${item.was || '—'} | now: ${item.now || '—'}</div>` : '';
            const note = item.note ? `<div class="note">→ ${item.note}</div>` : '';
            const source = item.source ? `<div class="source">source: ${item.source}</div>` : '';
            bodyLines.push(`<div class="item ${cls}"><div class="status ${cls}">${st.glyph} ${st.label}</div><h3>${item.headline}</h3>${wasnow}<div class="detail">${item.detail}</div>${note}${source}</div>`);
        }
        const body = bodyLines.join('\n');
        const html = buildHTML({ subject: 'Conversion Funnel Analyzer — Demo Report', body });
        require('fs').writeFileSync(htmlPath, html, 'utf-8');
    }
    renderSummary(DEMO, htmlPath);
}

// =============================================================================
// MAIN: run
// =============================================================================
async function run(inputText, sourceName, writeHTML) {
    line(`  ${C.dim('→')} Parsing input from ${C.teal(sourceName)}...`);
    let parsed;
    try {
        parsed = parseInput(inputText, sourceName);
    } catch (e) {
        endline();
        const failItem = {
            status: 'FAIL',
            headline: 'Failed to parse input',
            was: '',
            now: '',
            detail: `Error: ${e.message}. Check that the file has a header row with step names and a users column.`,
            note: 'Fix the input format and try again.',
            source: sourceName,
        };
        renderFindings([failItem]);
        renderSummary([failItem], null);
        return;
    }
    endline();
    line(`  ${C.dim('→')} Parsed ${parsed.steps.length} steps from ${sourceName} (${parsed.skipped} rows skipped)...`);
    if (parsed.steps.length === 0) {
        endline();
        const failItem = {
            status: 'FAIL',
            headline: 'No valid steps found',
            was: '',
            now: '',
            detail: `After parsing, 0 funnel steps were extracted. Check that the file has at least one row with a step name and a positive number in the users column.`,
            note: 'Provide a file with funnel step data.',
            source: sourceName,
        };
        renderFindings([failItem]);
        renderSummary([failItem], null);
        return;
    }
    await new Promise(r => setTimeout(r, 200));
    endline();
    line(`  ${C.dim('→')} Computing funnel metrics...`);
    const computed = computeFunnel(parsed.steps);
    await new Promise(r => setTimeout(r, 200));
    endline();
    // determine provider
    const providerKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
    let aiItems = null;
    if (providerKey) {
        line(`  ${C.dim('→')} Calling AI for causes and fixes...`);
        const stepTable = computed.items.map(it =>
            `Step "${it.step}": ${it.users} users, step conv ${it.stepRate}%, cum conv ${it.cumRate}%, drop ${it.drop} (${it.dropPct}%)`
        ).join('\n');
        const prompt = `Analyze this conversion funnel. For each step, provide a likely cause for the drop and a concrete fix. Also identify the bottleneck step.\n\nFunnel data:\n${stepTable}\n\nRespond with JSON: { "bottleneck": "step name", "steps": [ { "step": "step name", "likely_cause": "...", "fix": "...", "confidence": "high/medium/low" } ] }.`;
        const system = 'You are a conversion rate optimization expert. Analyze the funnel data and provide specific, actionable causes and fixes.';
        try {
            const text = await ask(null, { system, prompt, schema: null, search: null, maxTokens: 6000 });
            const parsedAI = parseJSON(text);
            aiItems = parsedAI.steps || [];
            endline();
        } catch (e) {
            endline();
            line(`  ${C.amber('!')} AI call failed: ${e.message}. Using computed data only.`);
            await new Promise(r => setTimeout(r, 100));
            endline();
        }
    } else {
        line(`  ${C.dim('→')} ${NO_SEARCH_NOTE}`);
        await new Promise(r => setTimeout(r, 200));
        endline();
    }
    const items = buildFunnelItems(computed, aiItems);
    renderFindings(items);
    let htmlPath = null;
    if (writeHTML) {
        htmlPath = `./conversion-funnel-report-${sourceName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.html`;
        const bodyLines = [];
        for (const item of items) {
            const st = STATUS[item.status];
            const cls = item.status.toLowerCase();
            const wasnow = (item.was || item.now) ? `<div class="wasnow">was: ${item.was || '—'} | now: ${item.now || '—'}</div>` : '';
            const note = item.note ? `<div class="note">→ ${item.note}</div>` : '';
            const source = item.source ? `<div class="source">source: ${item.source}</div>` : '';
            bodyLines.push(`<div class="item ${cls}"><div class="status ${cls}">${st.glyph} ${st.label}</div><h3>${item.headline}</h3>${wasnow}<div class="detail">${item.detail}</div>${note}${source}</div>`);
        }
        if (!providerKey) {
            bodyLines.push(`<div class="note-free">${NO_SEARCH_NOTE}</div>`);
        }
        const body = bodyLines.join('\n');
        const html = buildHTML({ subject: `Conversion Funnel Report — ${sourceName}`, body });
        require('fs').writeFileSync(htmlPath, html, 'utf-8');
    }
    renderSummary(items, htmlPath);
}

// =============================================================================
// ENTRY POINT
// =============================================================================
async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        out(PITCH);
        out('');
        out('Usage: node conversion-funnel-analyzer.js [options]');
        out('');
        for (const [arg, desc] of USAGE) {
            out(`  ${pad(arg, 20)} ${desc}`);
        }
        out('');
        out('Environment variables (set one):');
        out('  ANTHROPIC_API_KEY    Use Claude (recommended)');
        out('  OPENAI_API_KEY       Use GPT-4o-mini');
        out('  GEMINI_API_KEY       Use Gemini 2.0 Flash');
        out('');
        out('The tool computes funnel metrics in code. The AI call adds causes and fixes.');
        process.exit(0);
    }
    if (args.includes('--demo')) {
        const writeHTML = true; // always write for demo
        await runDemo(writeHTML);
        process.exit(0);
    }
    // read input
    const inputArg = args[0];
    let inputText = '';
    let sourceName = '';
    if (!inputArg || inputArg === '-') {
        // read stdin
        sourceName = 'stdin';
        const fs = require('fs');
        inputText = fs.readFileSync(0, 'utf-8'); // fd 0 = stdin
    } else {
        // read file
        sourceName = inputArg;
        try {
            const fs = require('fs');
            inputText = fs.readFileSync(inputArg, 'utf-8');
        } catch (e) {
            out(`${C.red('ERROR:')} Cannot read file: ${inputArg}`);
            out(e.message);
            process.exit(1);
        }
    }
    // always write HTML by default, could add --no-html later
    const writeHTML = !args.includes('--no-html');
    await run(inputText, sourceName, writeHTML);
}

main().catch((e) => {
    out(`${C.red('FATAL:')} ${e.message}`);
    process.exit(1);
});
