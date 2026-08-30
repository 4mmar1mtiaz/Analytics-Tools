#!/usr/bin/env node

// ================================================================
// Author: Ammar Imtiaz
// Website: www.ammarimtiaz.com
// LinkedIn: linkedin.com/in/ammarimtiaz
// GitHub: github.com/4mmar1mtiaz
// ================================================================

// ===== HELPER: Colour functions =====
const C = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    amber: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    teal: (s) => `\x1b[36m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    text: (s) => s
};

// ===== HELPER: Utility functions =====
function bold(text) {
    return `\x1b[1m${text}\x1b[0m`;
}

function bar(i, total) {
    const width = 20;
    const filled = Math.round((i / total) * width);
    return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

function wrap(text, width) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        if ((line + word).length > width) {
            lines.push(line.trim());
            line = word + ' ';
        } else {
            line += word + ' ';
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

// ===== HELPER: Status constants =====
const STATUS = {
    FORECAST: { glyph: '>', color: C.teal, label: 'Forecast' },
    TOTAL: { glyph: '+', color: C.green, label: 'Total' },
    ASSUMPTION: { glyph: '*', color: C.amber, label: 'Assumption' },
    FAIL: { glyph: '!', color: C.red, label: 'Error' }
};

const ITEM_NOUN = 'forecast';
const NOTE_LABEL = 'Note';
const NO_SEARCH_NOTE = 'No search provider available; all numeric computations are complete and presented below.';

function SUMMARY_NOTE(items) {
    const total = items.filter(i => i.status === STATUS.TOTAL).length;
    const forecasts = items.filter(i => i.status === STATUS.FORECAST).length;
    return `${forecasts} keyword forecasts, ${total} site totals.`;
}

const PITCH = 'Traffic Forecast Calculator: estimate click gains from ranking improvements using CTR curves.';

const USAGE = [
    ['<file>', 'CSV file with keyword data'],
    ['-', 'read stdin'],
    ['--demo', 'see example output, no API key needed'],
    ['--help', 'show this help']
];

// ===== DEMO data =====
const DEMO = [
    {
        status: STATUS.FORECAST,
        headline: 'best running shoes for men',
        was: '45 clicks/month',
        now: '189 clicks/month',
        detail: 'Currently at position 9 with 1,200 searches/month. Moving to position 3 would capture an estimated 15.75% CTR instead of current 3.75%.',
        note: 'Reachability: likely — on-page optimization sufficient',
        source: ''
    },
    {
        status: STATUS.FORECAST,
        headline: 'trail running shoes review',
        was: '12 clicks/month',
        now: '84 clicks/month',
        detail: 'At position 12 with 800 searches/month. Target position 5 would yield 10.5% CTR vs current 1.5%.',
        note: 'Reachability: possible — needs backlinks',
        source: ''
    },
    {
        status: STATUS.FORECAST,
        headline: 'marathon training plan pdf',
        was: '0 clicks/month',
        now: '42 clicks/month',
        detail: 'Position 15 with 600 searches/month, not ranking on page 1. Target position 10 would give 7% CTR.',
        note: 'Reachability: unlikely — high competition',
        source: ''
    },
    {
        status: STATUS.TOTAL,
        headline: 'Total at target position 3',
        was: '57 clicks/month',
        now: '273 clicks/month',
        detail: 'Sum of all keyword forecasts if each reaches its best target position.',
        note: 'Potential gain: 216 clicks/month',
        source: ''
    },
    {
        status: STATUS.ASSUMPTION,
        headline: 'CTR curve holds for this SERP',
        was: '',
        now: '',
        detail: 'The standard CTR curve used here may not match every search result page due to featured snippets, ads, or local packs.',
        note: 'Actual results will vary',
        source: ''
    },
    {
        status: STATUS.FAIL,
        headline: 'No API key configured',
        was: '',
        now: '',
        detail: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY environment variable for reachability analysis.',
        note: NO_SEARCH_NOTE,
        source: ''
    }
];

// ===== HELPER: Parse JSON with fallbacks =====
function parseJSON(text) {
    // Try direct parse
    try {
        return JSON.parse(text);
    } catch (e) {
        // Try to extract from fenced code block
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) {
            try {
                return JSON.parse(fenceMatch[1].trim());
            } catch (e2) {
                // Fall through
            }
        }
        // Try brace scanning
        const braceStart = text.indexOf('{');
        const braceEnd = text.lastIndexOf('}');
        if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
            try {
                return JSON.parse(text.slice(braceStart, braceEnd + 1));
            } catch (e3) {
                // Fall through
            }
        }
        throw new Error('Could not parse JSON from response');
    }
}

// ===== HELPER: mapLimit =====
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

// ===== HELPER: Terminal output =====
let currentLine = '';

function line(text) {
    // Clear current line and write new one
    if (currentLine) {
        process.stdout.write('\r\x1b[K');
    }
    currentLine = text;
    process.stdout.write(text);
}

function endline() {
    if (currentLine) {
        process.stdout.write('\n');
        currentLine = '';
    }
}

function out(text) {
    console.log(text);
}

// ===== HELPER: ask() =====
async function ask(P, { system, prompt, schema, search, maxTokens = 6000 }) {
    const key = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error('No API key found');
    }

    let provider, url, headers, body;

    if (process.env.ANTHROPIC_API_KEY) {
        provider = 'Anthropic';
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
        };
        body = {
            model: 'claude-3-haiku-20240307',
            max_tokens: maxTokens,
            system: system || '',
            messages: [{ role: 'user', content: prompt }]
        };
    } else if (process.env.OPENAI_API_KEY) {
        provider = 'OpenAI';
        url = 'https://api.openai.com/v1/chat/completions';
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        };
        body = {
            model: 'gpt-4o-mini',
            max_tokens: maxTokens,
            messages: [
                { role: 'system', content: system || '' },
                { role: 'user', content: prompt }
            ]
        };
    } else {
        provider = 'Gemini';
        url = 'https://generativelanguage-googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
        headers = { 'Content-Type': 'application/json' };
        body = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: { maxOutputTokens: maxTokens }
        };
        // Gemini uses API key in query parameter
        url += `?key=${key}`;
    }

    line(`[${provider}] Calling API...`);
    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    endline();

    // Extract text from response based on provider
    if (provider === 'Anthropic') {
        return data.content[0].text;
    } else if (provider === 'OpenAI') {
        return data.choices[0].message.content;
    } else {
        return data.candidates[0].content.parts[0].text;
    }
}

// ===== HELPER: renderFindings =====
function renderFindings(items) {
    // Determine max label width
    const maxLabel = Math.max(...Object.values(STATUS).map(s => s.label.length));

    for (const item of items) {
        const status = item.status;
        const glyph = status.glyph;
        const color = status.color;
        const label = pad(status.label, maxLabel);

        out(`${color(glyph)} ${color(label)} ${bold(item.headline)}`);
        if (item.was || item.now) {
            out(`  ${C.dim('Was:')} ${item.was}  ${C.dim('Now:')} ${item.now}`);
        }
        out(`  ${item.detail}`);
        if (item.note) {
            out(`  ${C.dim('→')} ${item.note}`);
        }
        if (item.source) {
            out(`  ${C.dim('Source:')} ${item.source}`);
        }
        out('');
    }
}

// ===== HELPER: renderSummary =====
function renderSummary(items, htmlPath) {
    const totalItems = items.filter(i => i.status === STATUS.TOTAL);
    const forecasts = items.filter(i => i.status === STATUS.FORECAST);
    const failures = items.filter(i => i.status === STATUS.FAIL);

    out(bold('Summary'));
    out(`  Total forecasts: ${forecasts.length}`);
    out(`  Site totals: ${totalItems.length}`);
    out(`  Errors: ${failures.length}`);

    if (totalItems.length > 0) {
        out('');
        for (const item of totalItems) {
            out(`  ${bold(item.headline)}: ${item.was} → ${item.now}`);
            out(`  ${item.detail}`);
            if (item.note) out(`  ${C.dim('→')} ${item.note}`);
        }
    }

    if (htmlPath) {
        out(`\n  HTML report written to: ${htmlPath}`);
    }

    const note = SUMMARY_NOTE(items);
    if (note) out(`\n  ${C.dim(note)}`);
}

// ===== HELPER: buildHTML =====
function buildHTML({ subject, body }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; line-height: 1.6; }
  h1 { color: #333; }
  h2 { color: #555; margin-top: 2em; }
  .item { border-left: 3px solid #ccc; padding-left: 1em; margin: 1em 0; }
  .forecast { border-left-color: #009688; }
  .total { border-left-color: #4CAF50; }
  .assumption { border-left-color: #FF9800; }
  .fail { border-left-color: #f44336; }
  .status-label { font-weight: bold; font-size: 0.85em; text-transform: uppercase; }
  .headline { font-size: 1.1em; font-weight: bold; }
  .detail { color: #666; }
  .note { color: #999; font-style: italic; }
  .source { color: #bbb; font-size: 0.9em; }
  .values { color: #444; }
</style>
</head>
<body>
<h1>${subject}</h1>
<div class="body">${body}</div>
</body>
</html>`;
}

// ===== HELPER: CSV parsing =====
function findHeaderLine(lines) {
    const keywords = ['keyword', 'query', 'page', 'position', 'impressions', 'clicks', 'ctr', 'volume'];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        const matchCount = keywords.filter(k => line.includes(k)).length;
        if (matchCount >= 2) return i;
    }
    return 0;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function cleanNumber(str) {
    if (!str || str.trim() === '') return null;
    let s = str.trim();
    // Remove commas, percent signs, currency symbols
    s = s.replace(/[,%$£€]/g, '');
    // Handle time strings like "1m 24s"
    const timeMatch = s.match(/^(\d+)\s*m\s*(\d+)\s*s$/);
    if (timeMatch) {
        return parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
    }
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
}

// ===== CTR curve (visible constant) =====
const CTR_CURVE = {
    1: 0.267,  // 26.7%
    2: 0.155,  // 15.5%
    3: 0.107,  // 10.7%
    4: 0.078,  // 7.8%
    5: 0.059,  // 5.9%
    6: 0.045,  // 4.5%
    7: 0.035,  // 3.5%
    8: 0.027,  // 2.7%
    9: 0.022,  // 2.2%
    10: 0.017, // 1.7%
    11: 0.014, // 1.4%
    12: 0.011, // 1.1%
    13: 0.009, // 0.9%
    14: 0.007, // 0.7%
    15: 0.006  // 0.6%
};

function getCTR(position) {
    if (position in CTR_CURVE) return CTR_CURVE[position];
    if (position <= 0) return CTR_CURVE[1];
    if (position > 15) return 0.005;
    // Linear interpolation for positions not in curve
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return CTR_CURVE[lower];
    const frac = position - lower;
    return CTR_CURVE[lower] + (CTR_CURVE[upper] - CTR_CURVE[lower]) * frac;
}

// ===== Main run function =====
async function run(input, sourceName) {
    const items = [];
    const lines = input.split('\n').filter(l => l.trim() !== '');
    
    // Add assumptions at the top
    items.push({
        status: STATUS.ASSUMPTION,
        headline: 'Forecast assumes target position is reached and held',
        was: '',
        now: '',
        detail: 'Reaching a target position requires active SEO work and ongoing maintenance. This forecast shows potential, not guarantee.',
        note: 'Actual results depend on competition and algorithm changes',
        source: ''
    });
    
    items.push({
        status: STATUS.ASSUMPTION,
        headline: 'CTR curve holds for this SERP',
        was: '',
        now: '',
        detail: `Using standard CTR curve derived from aggregated studies. Your specific SERP may have different click-through rates due to search intent, device type, or personalization.`,
        note: 'Actual CTR may vary significantly',
        source: ''
    });
    
    items.push({
        status: STATUS.ASSUMPTION,
        headline: 'Ignores SERP features that consume clicks',
        was: '',
        now: '',
        detail: 'Featured snippets, knowledge panels, ads, local packs, and other SERP features reduce organic click-through rates. This model does not account for their presence.',
        note: 'Real-world results will be lower when SERP features are present',
        source: ''
    });

    // Parse CSV
    const headerIdx = findHeaderLine(lines);
    const headerLine = parseCSVLine(lines[headerIdx]);
    const headerLower = headerLine.map(h => h.toLowerCase().trim());

    // Find column indices
    const keywordIdx = headerLower.findIndex(h => h.includes('keyword') || h.includes('query') || h.includes('page'));
    const positionIdx = headerLower.findIndex(h => h.includes('position') || h.includes('rank'));
    const impressionsIdx = headerLower.findIndex(h => h.includes('impressions') || h.includes('volume') || h.includes('searches'));
    const clicksIdx = headerLower.findIndex(h => h.includes('clicks') || h.includes('ctr'));
    const ctrIdx = headerLower.findIndex(h => h.includes('ctr') || h.includes('rate'));

    if (keywordIdx === -1 || positionIdx === -1 || impressionsIdx === -1) {
        items.push({
            status: STATUS.FAIL,
            headline: 'Could not find required columns in CSV',
            was: '',
            now: '',
            detail: `Expected columns: keyword/query, position/rank, impressions/volume. Found: ${headerLine.join(', ')}`,
            note: 'Check file format',
            source: sourceName
        });
        return items;
    }

    line(`Found ${lines.length - headerIdx - 1} data rows...`);

    // Parse each row
    let skipCount = 0;
    const keywords = [];

    for (let i = headerIdx + 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        const keyword = row[keywordIdx];
        const position = cleanNumber(row[positionIdx]);
        const impressions = cleanNumber(row[impressionsIdx]);

        if (!keyword || position === null || impressions === null) {
            skipCount++;
            continue;
        }

        let currentClicks = null;
        if (clicksIdx !== -1 && row[clicksIdx]) {
            currentClicks = cleanNumber(row[clicksIdx]);
        } else {
            // Estimate from CTR if available, or use curve
            if (ctrIdx !== -1 && row[ctrIdx]) {
                const ctr = cleanNumber(row[ctrIdx]) / 100;
                currentClicks = Math.round(impressions * ctr);
            } else {
                currentClicks = Math.round(impressions * getCTR(position));
            }
        }

        keywords.push({
            keyword,
            position,
            impressions,
            currentClicks,
            source: `${sourceName}:${i + 1}`
        });
    }

    endline();
    out(`Parsed ${keywords.length} keywords, skipped ${skipCount} rows.`);

    // Compute forecasts for each keyword
    const targets = [10, 5, 3, 1];
    const siteTotals = {};

    for (const target of targets) {
        siteTotals[target] = {
            currentTotal: 0,
            forecastTotal: 0,
            delta: 0
        };
    }

    for (const kw of keywords) {
        const currentCTR = getCTR(kw.position);
        const currentClicks = kw.currentClicks;

        for (const target of targets) {
            const targetCTR = getCTR(target);
            const targetClicks = Math.round(kw.impressions * targetCTR);
            const delta = targetClicks - currentClicks;

            if (delta > 0) {
                siteTotals[target].currentTotal += currentClicks;
                siteTotals[target].forecastTotal += targetClicks;
                siteTotals[target].delta += delta;
            }
        }
    }

    // Create forecast items (only for top 20 by delta)
    const forecastItems = [];
    for (const kw of keywords) {
        for (const target of targets) {
            const targetCTR = getCTR(target);
            const targetClicks = Math.round(kw.impressions * targetCTR);
            const delta = targetClicks - kw.currentClicks;
            if (delta > 0) {
                forecastItems.push({
                    keyword: kw.keyword,
                    target,
                    delta,
                    currentClicks: kw.currentClicks,
                    targetClicks,
                    position: kw.position,
                    impressions: kw.impressions,
                    source: kw.source
                });
            }
        }
    }

    forecastItems.sort((a, b) => b.delta - a.delta);
    const topForecasts = forecastItems.slice(0, 20);

    // Try to get reachability analysis if API key is available
    let reachabilityData = null;
    const hasKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;

    if (hasKey && topForecasts.length > 0) {
        try {
            const prompt = `Analyze reachability for these keyword ranking targets. For each, say if reaching that position is likely, possible, or unlikely, and give a brief why.

Keywords:
${topForecasts.map(f => `- "${f.keyword}" from pos ${f.position} to target pos ${f.target} (current clicks: ${f.currentClicks}, target clicks: ${f.targetClicks})`).join('\n')}

Respond with JSON: { "reachability": [{ "keyword": "...", "target": N, "verdict": "likely|possible|unlikely", "why": "..." }] }`;

            const text = await ask(null, {
                system: 'You are a SEO analyst. Respond only with valid JSON.',
                prompt,
                maxTokens: 6000
            });
            reachabilityData = parseJSON(text);
        } catch (e) {
            items.push({
                status: STATUS.FAIL,
                headline: 'Reachability analysis failed',
                was: '',
                now: '',
                detail: `Could not get AI analysis: ${e.message}`,
                note: 'Proceeding with computed data only',
                source: ''
            });
        }
    } else {
        items.push({
            status: STATUS.FAIL,
            headline: 'No API key configured',
            was: '',
            now: '',
            detail: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for reachability analysis.',
            note: NO_SEARCH_NOTE,
            source: ''
        });
    }

    // Build reachability lookup
    const reachLookup = {};
    if (reachabilityData && reachabilityData.reachability) {
        for (const r of reachabilityData.reachability) {
            reachLookup[`${r.keyword}:${r.target}`] = r;
        }
    }

    // Create forecast items for top keywords
    const topKeywords = new Set();
    for (const f of topForecasts) {
        topKeywords.add(f.keyword);
    }

    for (const kw of keywords) {
        if (!topKeywords.has(kw.keyword)) continue;
        
        for (const target of targets) {
            const targetCTR = getCTR(target);
            const targetClicks = Math.round(kw.impressions * targetCTR);
            const delta = targetClicks - kw.currentClicks;
            if (delta <= 0) continue;

            const key = `${kw.keyword}:${target}`;
            const reach = reachLookup[key];
            const verdict = reach ? reach.verdict : 'unknown';
            const why = reach ? reach.why : 'No AI analysis available';

            items.push({
                status: STATUS.FORECAST,
                headline: kw.keyword,
                was: `${kw.currentClicks} clicks/month`,
                now: `${targetClicks} clicks/month`,
                detail: `Position ${kw.position} → ${target} with ${kw.impressions} searches/month. CTR: ${(getCTR(kw.position) * 100).toFixed(1)}% → ${(targetCTR * 100).toFixed(1)}%.`,
                note: `Reachability: ${verdict} — ${why}`,
                source: kw.source
            });
        }
    }

    // Add site totals
    for (const target of targets) {
        const st = siteTotals[target];
        if (st.delta > 0) {
            items.push({
                status: STATUS.TOTAL,
                headline: `Total at target position ${target}`,
                was: `${st.currentTotal} clicks/month`,
                now: `${st.forecastTotal} clicks/month`,
                detail: `Combined total across all keywords. Gain: ${st.delta} clicks/month.`,
                note: '',
                source: ''
            });
        }
    }

    return items;
}

// ===== Entry point =====
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.length === 0) {
        out(bold(PITCH));
        out('');
        out(bold('Usage:'));
        for (const [arg, desc] of USAGE) {
            out(`  ${pad(arg, 20)} ${desc}`);
        }
        out('');
        out(bold('Environment variables (optional):'));
        out(`  ${pad('ANTHROPIC_API_KEY', 20)} For reachability analysis`);
        out(`  ${pad('OPENAI_API_KEY', 20)} For reachability analysis`);
        out(`  ${pad('GEMINI_API_KEY', 20)} For reachability analysis`);
        process.exit(0);
    }

    if (args.includes('--demo')) {
        out(bold(PITCH));
        out('');
        line('Running demo...');
        await new Promise(r => setTimeout(r, 500));
        endline();
        
        renderFindings(DEMO);
        
        const writeHTML = args.includes('--html');
        let htmlPath = null;
        if (writeHTML) {
            const html = buildHTML({
                subject: 'Traffic Forecast Calculator - Demo Report',
                body: DEMO.map(item => {
                    const statusClass = Object.keys(STATUS).find(k => STATUS[k] === item.status).toLowerCase();
                    return `<div class="item ${statusClass}">
                        <span class="status-label">${item.status.label}</span>
                        <div class="headline">${item.headline}</div>
                        ${item.was || item.now ? `<div class="values">Was: ${item.was} | Now: ${item.now}</div>` : ''}
                        <div class="detail">${item.detail}</div>
                        ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
                        ${item.source ? `<div class="source">${item.source}</div>` : ''}
                    </div>`;
                }).join('')
            });
            const fs = require('fs');
            htmlPath = './traffic-forecast-calculator-demo.html';
            fs.writeFileSync(htmlPath, html, 'utf8');
            out(`HTML report written to ${htmlPath}`);
        }
        
        renderSummary(DEMO, htmlPath);
        process.exit(0);
    }

    // Read input
    let input;
    let sourceName;

    if (args[0] === '-') {
        // Read stdin
        sourceName = 'stdin';
        const chunks = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        input = Buffer.concat(chunks).toString('utf8');
    } else if (args[0]) {
        // Read file
        const fs = require('fs');
        sourceName = args[0];
        try {
            input = fs.readFileSync(args[0], 'utf8');
        } catch (e) {
            out(C.red(`Error reading file: ${e.message}`));
            process.exit(1);
        }
    } else {
        out(C.red('No input provided. Use --help for usage.'));
        process.exit(1);
    }

    out(bold(PITCH));
    out(`Source: ${sourceName}`);
    out('');

    const items = await run(input, sourceName);
    
    renderFindings(items);
    renderSummary(items, null);
}

// Run
main().catch(e => {
    out(C.red(`Fatal error: ${e.message}`));
    console.error(e);
    process.exit(1);
});
