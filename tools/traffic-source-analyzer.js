#!/usr/bin/env node

// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/4mmar1mtiaz

// ========== COLOUR FUNCTIONS ==========
const C = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    amber: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    teal: (s) => `\x1b[36m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    text: (s) => s
};

// ========== STATUS CONSTANTS ==========
const STATUS = {
    CARRYING: { glyph: '+', color: C.green, label: 'Carrying' },
    WEAK: { glyph: '-', color: C.amber, label: 'Weak' },
    WASTED: { glyph: 'x', color: C.red, label: 'Wasted' },
    RISK: { glyph: '!', color: C.teal, label: 'Risk' },
    MIX: { glyph: '=', color: C.text, label: 'Mix' },
    FAIL: { glyph: '*', color: C.red, label: 'Fail' }
};

const PITCH = 'Analyzes GA4 traffic source data for channel concentration risk and performance';
const USAGE = [
    ['<file>', 'read csv file'],
    ['-', 'read stdin'],
    ['--demo', 'see the output, spend nothing']
];
const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'Consequence';
const NO_SEARCH_NOTE = 'No API key found — all findings computed from local data only.';
const SUMMARY_NOTE = (items) => {
    const fails = items.filter(i => i.status === STATUS.FAIL).length;
    return fails > 0 ? `${fails} finding(s) failed to compute` : '';
};

// ========== HELPERS ==========

function bold(text) { return `\x1b[1m${text}\x1b[0m`; }

function bar(i, total) {
    const width = 30;
    const filled = Math.round((i / total) * width);
    const empty = width - filled;
    return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
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
    lines.push(line.trim());
    return lines;
}

function clip(text, n) {
    if (text.length <= n) return text;
    return text.slice(0, n - 3) + '...';
}

function pad(text, n) {
    const s = String(text);
    return s + ' '.repeat(Math.max(0, n - s.length));
}

function parseJSON(text) {
    // Try direct parse
    try { return JSON.parse(text); } catch (e) { /* continue */ }

    // Try fenced block
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        try { return JSON.parse(fence[1]); } catch (e) { /* continue */ }
    }

    // Try brace scan
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { /* continue */ }
    }

    throw new Error('Cannot parse JSON from response');
}

async function ask(P, { system, prompt, schema, search, maxTokens = 4000 }) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('No API key found in environment variables');

    let provider, url, body;
    if (process.env.ANTHROPIC_API_KEY) {
        provider = 'anthropic';
        url = 'https://api.anthropic.com/v1/messages';
        body = {
            model: 'claude-3-sonnet-20241022',
            max_tokens: maxTokens,
            system: system,
            messages: [{ role: 'user', content: prompt }]
        };
    } else if (process.env.OPENAI_API_KEY) {
        provider = 'openai';
        url = 'https://api.openai.com/v1/chat/completions';
        body = {
            model: 'gpt-4o',
            max_tokens: maxTokens,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt }
            ]
        };
    } else {
        provider = 'gemini';
        url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=' + apiKey;
        body = {
            contents: [{
                parts: [{ text: system + '\n\n' + prompt }]
            }]
        };
    }

    const https = require('https');
    const response = await new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(provider !== 'gemini' ? { 'x-api-key': apiKey } : {}),
                ...(provider === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {})
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });

    if (provider === 'anthropic') {
        return response.content[0].text;
    } else if (provider === 'openai') {
        return response.choices[0].message.content;
    } else {
        return response.candidates[0].content.parts[0].text;
    }
}

function mapLimit(items, limit, fn) {
    const results = [];
    let index = 0;
    return new Promise((resolve, reject) => {
        function next() {
            while (index < items.length && results.length < index + limit) {
                const i = index++;
                fn(items[i], i).then(r => {
                    results[i] = r;
                    next();
                }).catch(reject);
            }
            if (results.length === items.length && index === items.length) {
                resolve(results);
            }
        }
        next();
    });
}

let progressLine = '';

function line(text) {
    progressLine = text;
    process.stdout.write('\r' + text + ' '.repeat(40));
}

function endline() {
    process.stdout.write('\r' + progressLine + '\n');
    progressLine = '';
}

function out(text) {
    console.log(text);
}

// ========== CSV READER ==========
function parseCSV(text) {
    const lines = text.split('\n');
    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes('sessions') || line.includes('conversions') || line.includes('revenue')) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) throw new Error('Cannot find header row in CSV');

    const headers = parseCSVLine(lines[headerIdx]);
    const rows = [];
    let skipped = 0;
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) { skipped++; continue; }
        const fields = parseCSVLine(line);
        if (fields.length < 3) { skipped++; continue; }
        const row = {};
        headers.forEach((h, idx) => {
            if (idx < fields.length) row[h.trim()] = cleanValue(fields[idx]);
        });
        rows.push(row);
    }
    return { rows, skipped };
}

function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i+1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    fields.push(current.trim());
    return fields;
}

function cleanValue(val) {
    // Remove quotes
    val = val.replace(/^"|"$/g, '');
    // Remove commas (for numbers)
    val = val.replace(/,/g, '');
    // Remove percent signs
    val = val.replace(/%/g, '');
    // Remove currency symbols
    val = val.replace(/[$€£]/g, '');
    // Handle time strings like "1m 24s" - convert to seconds as number
    const timeMatch = val.match(/(\d+)\s*m(?:\s+(\d+)\s*s)?/);
    if (timeMatch) {
        const minutes = parseInt(timeMatch[1]) || 0;
        const seconds = parseInt(timeMatch[2]) || 0;
        return (minutes * 60 + seconds).toString();
    }
    // Strip leading/trailing spaces
    val = val.trim();
    return val;
}

// ========== RENDER FUNCTIONS ==========

function renderFindings(items) {
    const statusWidth = Math.max(...Object.values(STATUS).map(s => s.label.length));
    
    items.forEach(item => {
        const status = item.status;
        const label = status.glyph + ' ' + pad(status.label, statusWidth);
        const coloredLabel = status.color(label);
        
        out(`\n${coloredLabel} ${bold(item.headline)}`);
        
        if (item.was || item.now) {
            let arrow = '';
            if (item.was && item.now) {
                arrow = ` ${item.was} → ${item.now}`;
            } else if (item.now) {
                arrow = ` → ${item.now}`;
            }
            out(`  ${item.detail}${arrow}`);
        } else {
            out(`  ${item.detail}`);
        }
        
        if (item.note) {
            out(`  ${C.dim('→')} ${item.note}`);
        }
        if (item.source) {
            out(`  ${C.dim('Source:')} ${item.source}`);
        }
    });
}

function renderSummary(items, htmlPath) {
    const totals = {
        carrying: items.filter(i => i.status === STATUS.CARRYING).length,
        weak: items.filter(i => i.status === STATUS.WEAK).length,
        wasted: items.filter(i => i.status === STATUS.WASTED).length,
        risk: items.filter(i => i.status === STATUS.RISK).length,
        mix: items.filter(i => i.status === STATUS.MIX).length,
        fail: items.filter(i => i.status === STATUS.FAIL).length
    };
    
    out(`\n${bold('Summary')}`);
    out(`  ${C.green('+')} Carrying: ${totals.carrying}`);
    out(`  ${C.amber('-')} Weak: ${totals.weak}`);
    out(`  ${C.red('x')} Wasted: ${totals.wasted}`);
    out(`  ${C.teal('!')} Risk: ${totals.risk}`);
    out(`  ${C.text('=')} Mix: ${totals.mix}`);
    out(`  ${C.red('*')} Fail: ${totals.fail}`);
    out(`  Total: ${items.length} ${ITEM_NOUN}s`);
    
    const note = SUMMARY_NOTE(items);
    if (note) out(`  ${C.dim(note)}`);
    
    if (htmlPath) {
        out(`\n  ${C.green('✓')} HTML report written to: ${htmlPath}`);
    }
}

function buildHTML({ subject, body }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Traffic Source Analyzer - ${subject}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 0 auto; padding: 2rem; background: #f5f5f5; color: #333; }
  h1 { color: #1a1a1a; border-bottom: 2px solid #ddd; padding-bottom: 0.5rem; }
  .item { margin: 1rem 0; padding: 1rem; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .status { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; font-size: 0.85rem; }
  .status-CARRYING { background: #d4edda; color: #155724; }
  .status-WEAK { background: #fff3cd; color: #856404; }
  .status-WASTED { background: #f8d7da; color: #721c24; }
  .status-RISK { background: #d1ecf1; color: #0c5460; }
  .status-MIX { background: #e2e3e5; color: #383d41; }
  .status-FAIL { background: #f5c6cb; color: #721c24; }
  .headline { font-size: 1.1rem; font-weight: bold; margin: 0.5rem 0; }
  .detail { margin: 0.5rem 0; line-height: 1.5; }
  .meta { font-size: 0.85rem; color: #666; }
  .arrow { color: #888; margin: 0 0.5rem; }
  .summary { margin-top: 2rem; padding: 1rem; background: #fff; border-radius: 8px; }
  .summary ul { list-style: none; padding: 0; }
  .summary li { margin: 0.3rem 0; }
</style>
</head>
<body>
<h1>${subject}</h1>
${body}
</body>
</html>`;
}

// ========== DEMO DATA ==========
const DEMO = [
    {
        status: STATUS.CARRYING,
        headline: 'Organic Search carries 45.2% of all conversions with only 38.1% of traffic',
        was: '38.1% sessions',
        now: '45.2% conversions',
        detail: 'Organic Search drives 12,847 sessions and 847 conversions at a 6.59% conversion rate, significantly above the site average of 5.12%. This channel is outperforming its traffic share by a factor of 1.19x, making it the most efficient acquisition channel for the reporting period.',
        note: 'This channel is carrying the conversion load — protect and invest in SEO efforts',
        source: ''
    },
    {
        status: STATUS.WEAK,
        headline: 'Social Media underperforms at 1.9% conversion rate vs 5.12% site average',
        was: '15.3% sessions',
        now: '5.7% conversions',
        detail: 'Social Media channels (Instagram, Facebook, LinkedIn) collectively bring 5,162 sessions but only 98 conversions. The 1.9% conversion rate is 63% below the site average, suggesting either poor audience targeting or a disconnect between social content and landing page experience.',
        note: 'Review social campaign targeting and landing page alignment',
        source: ''
    },
    {
        status: STATUS.WASTED,
        headline: 'Display advertising spends $4,200 with only 4.1% conversion share',
        was: '22.7% sessions',
        now: '4.1% conversions',
        detail: 'Display ads drive 7,654 sessions but generate only 71 conversions at a 0.93% conversion rate — the lowest of any channel. With a cost per conversion of approximately $59.15, this channel is significantly underperforming against the $12.50 site average cost per conversion.',
        note: 'Pause or restructure display campaigns immediately',
        source: ''
    },
    {
        status: STATUS.RISK,
        headline: 'Direct traffic exceeds 50% of all sessions — dangerous concentration risk',
        was: '52.3% sessions',
        now: '48.1% conversions',
        detail: 'Direct traffic accounts for 17,643 of the total 33,724 sessions, making up 52.3% of all site traffic. This over-reliance on a single channel creates significant business risk. If direct traffic were to decline by 20%, total site traffic would drop by over 10% with no other channel positioned to fill the gap.',
        note: 'Diversify acquisition channels to reduce dependency on direct traffic',
        source: ''
    },
    {
        status: STATUS.MIX,
        headline: 'Email marketing and Paid Search together deliver 30.2% of conversions',
        was: '18.9% sessions combined',
        now: '30.2% conversions combined',
        detail: 'Email marketing (4.1% sessions, 12.3% conversions at 15.1% conversion rate) and Paid Search (14.8% sessions, 17.9% conversions at 6.1% conversion rate) together punch well above their traffic weight. These channels represent the healthiest part of the acquisition mix with strong conversion performance.',
        note: 'These efficient channels should receive incremental budget',
        source: ''
    }
];

// ========== MAIN FUNCTIONS ==========

async function runDemo(writeHTML) {
    line('Loading demo data...');
    await new Promise(r => setTimeout(r, 500));
    endline();
    
    line('Processing demo channels...');
    await new Promise(r => setTimeout(r, 300));
    endline();
    
    line('Analyzing concentration risk...');
    await new Promise(r => setTimeout(r, 400));
    endline();
    
    out('\n' + bold('Demo Results (no API call made)'));
    renderFindings(DEMO);
    
    let htmlPath = null;
    if (writeHTML) {
        const html = buildHTML({
            subject: 'Traffic Source Analyzer - Demo Report',
            body: DEMO.map(item => `
                <div class="item">
                    <span class="status status-${item.status.label.toUpperCase()}">${item.status.glyph} ${item.status.label}</span>
                    <div class="headline">${item.headline}</div>
                    <div class="detail">${item.detail}</div>
                    ${(item.was || item.now) ? `<div class="meta">${item.was ? 'Before: ' + item.was : ''}${item.was && item.now ? ' → ' : ''}${item.now ? 'After: ' + item.now : ''}</div>` : ''}
                    ${item.note ? `<div class="meta arrow">→ ${item.note}</div>` : ''}
                </div>
            `).join('\n')
        });
        require('fs').writeFileSync('./traffic-source-analyzer-demo.html', html);
        htmlPath = './traffic-source-analyzer-demo.html';
    }
    
    renderSummary(DEMO, htmlPath);
}

async function run(input, sourceName) {
    const { rows, skipped } = parseCSV(input);
    const items = [];
    const totalSessions = rows.reduce((sum, r) => {
        const s = parseFloat(r.sessions) || 0;
        return sum + s;
    }, 0);
    const totalConversions = rows.reduce((sum, r) => {
        const c = parseFloat(r.conversions) || 0;
        return sum + c;
    }, 0);
    
    if (totalSessions === 0) {
        items.push({
            status: STATUS.FAIL,
            headline: 'No valid session data found in input',
            was: '',
            now: '',
            detail: `Parsed ${rows.length} rows but total sessions is zero. Check that session numbers are present and formatted correctly.`,
            note: 'Input file may be empty or malformed',
            source: sourceName || 'stdin'
        });
        return items;
    }
    
    // Per-channel calculations
    const channels = {};
    rows.forEach(r => {
        const ch = r.source_medium || r.default_channel_group || r.channel || 'unknown';
        if (!channels[ch]) channels[ch] = { sessions: 0, conversions: 0 };
        channels[ch].sessions += parseFloat(r.sessions) || 0;
        channels[ch].conversions += parseFloat(r.conversions) || 0;
    });
    
    const siteAvgConversionRate = totalConversions / totalSessions * 100;
    
    // Check concentration risk
    let maxSessionShare = 0;
    let maxConversionShare = 0;
    let maxSessionChannel = '';
    let maxConversionChannel = '';
    
    Object.entries(channels).forEach(([ch, data]) => {
        const sessionShare = data.sessions / totalSessions * 100;
        const conversionShare = data.conversions / totalConversions * 100;
        if (sessionShare > maxSessionShare) {
            maxSessionShare = sessionShare;
            maxSessionChannel = ch;
        }
        if (conversionShare > maxConversionShare) {
            maxConversionShare = conversionShare;
            maxConversionChannel = ch;
        }
    });
    
    // Build channel findings
    Object.entries(channels).forEach(([ch, data]) => {
        const sessionShare = data.sessions / totalSessions * 100;
        const conversionShare = data.conversions / totalConversions * 100;
        const convRate = data.conversions / data.sessions * 100;
        const shareRatio = conversionShare / (sessionShare || 1);
        
        let status, headline, detail, note;
        
        if (shareRatio > 1.15) {
            status = STATUS.CARRYING;
            headline = `${ch} carries ${conversionShare.toFixed(1)}% of conversions with ${sessionShare.toFixed(1)}% of traffic`;
            detail = `${ch} drives ${data.sessions.toFixed(0)} sessions and ${data.conversions.toFixed(0)} conversions at ${convRate.toFixed(2)}% conversion rate, ${convRate > siteAvgConversionRate ? `${((convRate / siteAvgConversionRate - 1) * 100).toFixed(0)}% above` : `${((1 - convRate / siteAvgConversionRate) * 100).toFixed(0)}% below`} the site average of ${siteAvgConversionRate.toFixed(2)}%.`;
            note = `Outperforming traffic share by ${(shareRatio - 1).toFixed(2)}x — invest further in this channel`;
        } else if (convRate < siteAvgConversionRate * 0.5) {
            status = STATUS.WASTED;
            headline = `${ch} underperforms at ${convRate.toFixed(1)}% conversion rate vs ${siteAvgConversionRate.toFixed(1)}% site average`;
            detail = `${ch} brings ${sessionShare.toFixed(1)}% of sessions (${data.sessions.toFixed(0)}) but only ${conversionShare.toFixed(1)}% of conversions (${data.conversions.toFixed(0)}). The ${convRate.toFixed(2)}% conversion rate is ${((1 - convRate / siteAvgConversionRate) * 100).toFixed(0)}% below the site average.`;
            note = `Review campaign structure and targeting for this channel`;
        } else if (shareRatio < 0.85) {
            status = STATUS.WEAK;
            headline = `${ch} underperforms its traffic share by ${(1 - shareRatio).toFixed(2)}x`;
            detail = `${ch} has ${sessionShare.toFixed(1)}% session share but only ${conversionShare.toFixed(1)}% conversion share. The ${convRate.toFixed(2)}% conversion rate is ${(siteAvgConversionRate - convRate).toFixed(2)} percentage points below the site average of ${siteAvgConversionRate.toFixed(2)}%.`;
            note = `Optimize landing pages and audience targeting for this channel`;
        } else {
            status = STATUS.MIX;
            headline = `${ch} performs at ${convRate.toFixed(1)}% conversion rate, near site average`;
            detail = `${ch} contributes ${sessionShare.toFixed(1)}% of sessions and ${conversionShare.toFixed(1)}% of conversions. Its conversion rate of ${convRate.toFixed(2)}% is within ${Math.abs(convRate - siteAvgConversionRate).toFixed(2)} percentage points of the site average of ${siteAvgConversionRate.toFixed(2)}%.`;
            note = `Maintain current investment in this channel`;
        }
        
        items.push({
            status,
            headline,
            was: `${sessionShare.toFixed(1)}% sessions`,
            now: `${conversionShare.toFixed(1)}% conversions`,
            detail,
            note,
            source: sourceName || ''
        });
    });
    
    // Risk finding
    if (maxSessionShare > 50 || maxConversionShare > 50) {
        const riskChannel = maxSessionShare > 50 ? maxSessionChannel : maxConversionChannel;
        const riskShare = maxSessionShare > 50 ? maxSessionShare : maxConversionShare;
        const riskType = maxSessionShare > 50 ? 'sessions' : 'conversions';
        
        items.push({
            status: STATUS.RISK,
            headline: `${riskChannel} exceeds 50% of all ${riskType} — dangerous concentration`,
            was: `${riskShare.toFixed(1)}% ${riskType}`,
            now: '',
            detail: `${riskChannel} accounts for ${riskShare.toFixed(1)}% of total ${riskType}. This level of channel dependency creates significant business risk. A 20% decline in this channel would reduce total ${riskType} by over ${(riskShare * 0.2).toFixed(1)}%.`,
            note: `Immediately diversify acquisition to reduce dependency on ${riskChannel}`,
            source: ''
        });
    }
    
    // API call if provider available
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
        try {
            line('Calling AI for channel analysis...');
            const table = Object.entries(channels).map(([ch, data]) => {
                const share = (data.sessions / totalSessions * 100).toFixed(1);
                const convRate = (data.conversions / data.sessions * 100).toFixed(2);
                const convShare = (data.conversions / totalConversions * 100).toFixed(1);
                return `${ch}: ${share}% sessions, ${convShare}% conversions, ${convRate}% conv rate`;
            }).join('\n');
            
            const text = await ask(null, {
                system: 'You are a GA4 traffic analysis expert. Analyze the following channel data and provide verdicts.',
                prompt: `Channel data:\n${table}\n\nSite average conversion rate: ${siteAvgConversionRate.toFixed(2)}%\n\nFor each channel, provide: dependency_risk (true/false if any channel exceeds 50% of any metric), and for each channel: channel name, verdict (carrying|underperforming|wasted|growing), why (1-2 sentences), action (1 sentence).`,
                schema: {
                    dependency_risk: 'boolean',
                    channels: [{ channel: 'string', verdict: 'string', why: 'string', action: 'string' }]
                },
                maxTokens: 6000
            });
            
            const data = parseJSON(text);
            // Merge AI insights into items (simplified - just use the verdict label)
            data.channels.forEach(ai => {
                const item = items.find(i => i.headline.startsWith(ai.channel + ' '));
                if (item) {
                    item.detail += ` AI analysis: ${ai.why} ${ai.action}`;
                }
            });
            endline();
        } catch (e) {
            line(`AI analysis skipped: ${e.message}`);
            endline();
        }
    } else {
        line('No API key found — skipping AI analysis');
        endline();
    }
    
    return items;
}

// ========== ENTRY POINT ==========
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        out(`\n${bold(PITCH)}\n`);
        out('Usage: node traffic-source-analyzer.js <arg>\n');
        out('Arguments:');
        USAGE.forEach(([arg, desc]) => {
            out(`  ${pad(arg, 12)} ${desc}`);
        });
        out('');
        return;
    }
    
    if (args.includes('--demo')) {
        const writeHTML = !args.includes('--no-html');
        await runDemo(writeHTML);
        return;
    }
    
    let input, sourceName;
    
    if (args.length === 0 || args[0] === '-') {
        // Read from stdin
        sourceName = 'stdin';
        input = await new Promise((resolve) => {
            let data = '';
            process.stdin.on('data', (chunk) => data += chunk);
            process.stdin.on('end', () => resolve(data));
        });
    } else {
        const filePath = args[0];
        sourceName = filePath;
        try {
            input = require('fs').readFileSync(filePath, 'utf-8');
        } catch (e) {
            out(C.red(`Error reading file: ${e.message}`));
            process.exit(1);
        }
    }
    
    if (!input || input.trim().length === 0) {
        out(C.red('Error: Empty input'));
        process.exit(1);
    }
    
    try {
        const items = await run(input, sourceName);
        renderFindings(items);
        renderSummary(items, null);
    } catch (e) {
        out(C.red(`Fatal error: ${e.message}`));
        process.exit(1);
    }
}

main().catch(e => {
    out(C.red(`Unhandled error: ${e.message}`));
    process.exit(1);
});
