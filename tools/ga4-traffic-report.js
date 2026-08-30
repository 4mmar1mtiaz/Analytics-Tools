#!/usr/bin/env node

// ============================================================
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/4mmar1mtiaz
// ============================================================

// ============================================================
// ANSI colour functions
// ============================================================
const C = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    amber: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    teal: (s) => `\x1b[36m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    text: (s) => s
};

// ============================================================
// Constants
// ============================================================
const PITCH = 'Analyzes a GA4 pages export to identify top performers, leaking pages, and thin content.';
const USAGE = [
    ['<file>', 'read and analyze the given GA4 CSV file'],
    ['-', 'read GA4 data from stdin'],
    ['--demo', 'show example analysis output (no API key required)'],
    ['--help', 'display this help message']
];
const STATUS = {
    TOP: { glyph: '+', color: C.green, label: 'Top' },
    LEAK: { glyph: '-', color: C.amber, label: 'Leak' },
    THIN: { glyph: '>', color: C.red, label: 'Thin' },
    TOTAL: { glyph: '=', color: C.teal, label: 'Total' },
    FAIL: { glyph: '!', color: C.red, label: 'Fail' }
};
const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'Note';
const NO_SEARCH_NOTE = 'No API key found; all analysis is computed locally from the data.';

const SUMMARY_NOTE = (items) => {
    const tops = items.filter(i => i.status === 'TOP').length;
    const leaks = items.filter(i => i.status === 'LEAK').length;
    const thins = items.filter(i => i.status === 'THIN').length;
    const fails = items.filter(i => i.status === 'FAIL').length;
    return `${tops} top, ${leaks} leaking, ${thins} thin, ${fails} errors`;
};

const PROVIDER_ORDER = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];
const PROVIDER_URLS = {
    ANTHROPIC_API_KEY: {
        url: 'https://api.anthropic.com/v1/messages',
        headers: (key) => ({
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        }),
        body: (prompt, system, schema, maxTokens) => ({
            model: 'claude-3-haiku-20240307',
            max_tokens: maxTokens || 6000,
            system: system || '',
            messages: [{ role: 'user', content: prompt + (schema ? `\n\nRespond with a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}` : '') }]
        }),
        parse: (json) => json.content[0].text
    },
    OPENAI_API_KEY: {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: (key) => ({
            'Authorization': `Bearer ${key}`,
            'content-type': 'application/json'
        }),
        body: (prompt, system, schema, maxTokens) => ({
            model: 'gpt-4o-mini',
            max_tokens: maxTokens || 6000,
            messages: [
                { role: 'system', content: system || 'You are a data analyst.' },
                { role: 'user', content: prompt + (schema ? `\n\nRespond with a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}` : '') }
            ]
        }),
        parse: (json) => json.choices[0].message.content
    },
    GEMINI_API_KEY: {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        headers: (key) => ({
            'x-goog-api-key': key,
            'content-type': 'application/json'
        }),
        body: (prompt, system, schema, maxTokens) => ({
            contents: [{ parts: [{ text: prompt + (schema ? `\n\nRespond with a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}` : '') }] }],
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            generationConfig: { maxOutputTokens: maxTokens || 6000 }
        }),
        parse: (json) => json.candidates[0].content.parts[0].text
    }
};

// ============================================================
// Helper functions
// ============================================================
function line(text) {
    process.stdout.write(`\r\x1b[K${text}`);
}

function endline() {
    process.stdout.write('\n');
}

function out(text) {
    console.log(text);
}

function bold(text) {
    return `\x1b[1m${text}\x1b[0m`;
}

function bar(i, total) {
    const width = 20;
    const filled = Math.round((i / total) * width);
    return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

function wrap(text, width) {
    if (!text || text.length <= width) return text || '';
    const words = text.split(' ');
    let result = '';
    let line = '';
    for (const word of words) {
        if ((line + word).length > width) {
            result += line.trim() + '\n';
            line = word + ' ';
        } else {
            line += word + ' ';
        }
    }
    return (result + line.trim());
}

function clip(text, n) {
    if (!text) return '';
    return text.length > n ? text.slice(0, n - 3) + '...' : text;
}

function pad(text, n) {
    const s = String(text);
    return s.length < n ? s + ' '.repeat(n - s.length) : s;
}

function parseJSON(text) {
    if (!text || typeof text !== 'string') throw new Error('parseJSON: no text provided');
    
    // Try direct parse first
    try {
        return JSON.parse(text);
    } catch (e) {
        // Try to find a fenced code block
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) {
            try {
                return JSON.parse(fenceMatch[1].trim());
            } catch (e2) {
                // fall through
            }
        }
        
        // Try brace scanning fallback
        let start = text.indexOf('{');
        let end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch (e3) {
                // fall through
            }
        }
        
        throw new Error(`parseJSON: could not parse text as JSON. Text starts with: ${text.slice(0, 100)}`);
    }
}

function mapLimit(items, limit, fn) {
    return new Promise((resolve, reject) => {
        const results = new Array(items.length);
        let running = 0;
        let index = 0;
        let completed = 0;
        let errored = false;
        
        function next() {
            if (errored) return;
            if (completed === items.length) {
                resolve(results);
                return;
            }
            
            while (running < limit && index < items.length) {
                const i = index++;
                running++;
                const item = items[i];
                
                Promise.resolve().then(() => {
                    return fn(item, i);
                }).then((result) => {
                    results[i] = result;
                    running--;
                    completed++;
                    next();
                }).catch((err) => {
                    if (!errored) {
                        errored = true;
                        reject(err);
                    }
                });
            }
        }
        
        next();
    });
}

function ask(P, { system, prompt, schema, search, maxTokens }) {
    const keyVar = PROVIDER_ORDER.find(k => process.env[k]);
    if (!keyVar) {
        return Promise.reject(new Error('No API key found in environment variables. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.'));
    }
    
    const provider = PROVIDER_URLS[keyVar];
    const key = process.env[keyVar];
    
    const body = provider.body(prompt, system, schema, maxTokens);
    const headers = provider.headers(key);
    
    return fetch(provider.url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    }).then(async (response) => {
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
        }
        const json = await response.json();
        return provider.parse(json);
    });
}

// ============================================================
// Demo data
// ============================================================
const DEMO = [
    {
        status: 'TOP',
        headline: '/blog/seo-guide-2024',
        was: '0',
        now: '12.4%',
        detail: 'This page generates the largest share of sessions (12.4%) with an engagement rate of 78.2%, significantly above the site median of 52.1%. Its conversion rate of 3.1% is also well above the median of 1.2%. The page drives substantial organic traffic through well-optimized long-tail keywords and comprehensive topic coverage.',
        note: 'Maintain freshness updates every 90 days to sustain momentum',
        source: '/blog/seo-guide-2024'
    },
    {
        status: 'TOP',
        headline: '/products/analytics-pro',
        was: '8.7%',
        now: '8.7%',
        detail: 'The second-highest traffic page at 8.7% of sessions. Engagement rate is 65.4% and conversion rate is 4.2%, making it the highest-converting page on the site. The page benefits from strong product-market fit and clear calls-to-action throughout the copy.',
        note: 'Consider adding comparison tables against competitors to further boost conversions',
        source: '/products/analytics-pro'
    },
    {
        status: 'LEAK',
        headline: '/pricing',
        was: '5.2%',
        now: '5.2%',
        detail: 'Despite being the third most-visited page (5.2% of sessions), its conversion rate of 0.3% is 75% below the site median of 1.2%. Engagement rate is also low at 28.1%. Users appear confused by the tier structure and often bounce to competitor pricing pages.',
        note: 'A/B test simplified pricing tiers and add a cost-calculator widget',
        source: '/pricing'
    },
    {
        status: 'LEAK',
        headline: '/blog/old-content-2022',
        was: '3.1%',
        now: '3.1%',
        detail: 'This outdated blog post still gets 3.1% of sessions due to legacy backlinks, but the conversion rate of 0.1% is abysmal. The engagement rate of 12.4% suggests users find the content irrelevant or outdated. The page mentions products that no longer exist.',
        note: 'Either redirect to current content or update with a prominent migration notice',
        source: '/blog/old-content-2022'
    },
    {
        status: 'THIN',
        headline: '13 low-traffic pages combined',
        was: '4.1%',
        now: '4.1%',
        detail: 'There are 13 pages each receiving less than 1% of total sessions, together accounting for 4.1% of all traffic. These pages have an average engagement rate of 22.3% and a collective conversion rate of 0.2%. Most are thin-content blog posts or outdated landing pages with no clear purpose.',
        note: 'Consolidate or remove these pages to improve site quality score',
        source: 'Various directories'
    },
    {
        status: 'TOTAL',
        headline: 'Site-wide totals and concentration',
        was: '35,482',
        now: '35,482',
        detail: 'Total sessions across all analyzed pages: 35,482. The top 2 pages account for 21.1% of all traffic, demonstrating moderate concentration. The site median engagement rate is 52.1% and median conversion rate is 1.2%. The top 50% of traffic comes from the top 4 pages.',
        note: 'Diversification strategy is recommended to reduce over-reliance on top pages',
        source: ''
    },
    {
        status: 'FAIL',
        headline: 'Missing API key for enrichment',
        was: '',
        now: '',
        detail: 'No API key was found in environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY). All analysis has been computed locally from the data; no AI-powered insights have been added. To get enriched analysis, set one of these environment variables.',
        note: 'Set a provider API key to get natural-language findings',
        source: ''
    }
];

// ============================================================
// Rendering functions
// ============================================================
function renderFindings(items) {
    if (!items || items.length === 0) {
        out(C.dim('No findings to display.'));
        return;
    }
    
    const labelWidth = Math.max(...Object.values(STATUS).map(s => s.label.length));
    
    for (const item of items) {
        const status = STATUS[item.status] || STATUS.FAIL;
        const color = status.color;
        const glyph = status.glyph;
        const label = pad(status.label, labelWidth);
        
        out('');
        if (item.headline) {
            out(` ${glyph} ${color(bold(item.headline))}`);
        }
        if (item.was || item.now) {
            out(`   ${color(`Was: ${item.was || '—'} → Now: ${item.now || '—'}`)}`);
        }
        if (item.detail) {
            const wrapped = wrap(item.detail, 72);
            wrapped.split('\n').forEach(l => out(`   ${C.dim(l)}`));
        }
        if (item.note) {
            out(`   ${C.amber('→')} ${C.dim(item.note)}`);
        }
        if (item.source) {
            out(`   ${C.teal('Source:')} ${C.dim(item.source)}`);
        }
    }
    out('');
}

function renderSummary(items, htmlPath) {
    if (!items || items.length === 0) {
        out(C.dim('No findings to summarize.'));
        return;
    }
    
    const byStatus = {};
    for (const item of items) {
        byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    }
    
    out('');
    out(bold('Summary:'));
    const labelWidth = Math.max(...Object.values(STATUS).map(s => s.label.length));
    
    for (const [key, status] of Object.entries(STATUS)) {
        const count = byStatus[key] || 0;
        if (count > 0) {
            const label = pad(status.label, labelWidth);
            out(`  ${status.glyph} ${status.color(label)}: ${count}`);
        }
    }
    
    if (htmlPath) {
        out(`  ${C.teal('📄 Report saved:')} ${C.dim(htmlPath)}`);
    }
    
    const note = SUMMARY_NOTE(items);
    if (note) {
        out(`  ${C.dim(note)}`);
    }
    out('');
}

function buildHTML({ subject, body }) {
    const rows = body.map(item => {
        const status = STATUS[item.status] || STATUS.FAIL;
        const colorMap = {
            green: '#27ae60',
            amber: '#f39c12',
            red: '#e74c3c',
            teal: '#17a2b8'
        };
        const color = colorMap[status.color.name] || '#333';
        const statusLabel = status.label;
        const statusGlyph = status.glyph;
        
        return `
        <div class="item" style="border-left: 4px solid ${color}; margin: 12px 0; padding: 12px; background: #f9f9f9; border-radius: 4px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; font-weight: bold;">${statusGlyph} ${statusLabel}</span>
                <strong style="font-size: 1.1em;">${item.headline}</strong>
            </div>
            ${item.was || item.now ? `<div style="color: #888; font-size: 0.9em; margin-bottom: 6px;">Was: ${item.was || '—'} → Now: ${item.now || '—'}</div>` : ''}
            <div style="margin-bottom: 6px; line-height: 1.5;">${item.detail}</div>
            ${item.note ? `<div style="color: ${colorMap.amber}; font-size: 0.9em;">→ ${item.note}</div>` : ''}
            ${item.source ? `<div style="color: ${colorMap.teal}; font-size: 0.9em; margin-top: 4px;">Source: ${item.source}</div>` : ''}
        </div>`;
    }).join('\n');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GA4 Traffic Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #fff; color: #333; }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
        .item { transition: transform 0.1s; }
        .item:hover { transform: translateX(4px); }
        .summary { margin-top: 30px; padding: 16px; background: #f6f8fa; border-radius: 8px; }
    </style>
</head>
<body>
    <h1>GA4 Pages Traffic Report</h1>
    <div class="summary" style="color: #555; margin-bottom: 20px; padding: 12px; background: #f0f4f8; border-radius: 8px;">
        <strong>Subject:</strong> ${subject}
    </div>
    ${rows}
    <div class="summary">
        <p style="margin: 0; color: #888; text-align: center; font-size: 0.9em;">Generated on ${new Date().toISOString().slice(0, 10)}</p>
    </div>
</body>
</html>`;
}

// ============================================================
// Core analysis functions
// ============================================================
function parseCSV(text) {
    // Find the header row
    const lines = text.split('\n');
    let headerIndex = -1;
    let headerLine = '';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.includes('Page path') && line.includes('Sessions')) {
            headerIndex = i;
            headerLine = line;
            break;
        }
        // More flexible: look for common GA4 column names
        if (/page.*path/i.test(line) && /sessions/i.test(line)) {
            headerIndex = i;
            headerLine = line;
            break;
        }
    }
    
    if (headerIndex === -1) {
        throw new Error('Could not find GA4 page export header. Expected columns: "Page path", "Sessions", "Users", "Engagement rate", "Average engagement time per session", "Conversions"');
    }
    
    // Parse header to find column indices
    const headers = parseCSVLine(headerLine);
    
    const pathIdx = headers.findIndex(h => /page.*path/i.test(h));
    const sessionsIdx = headers.findIndex(h => /^sessions$/i.test(h) && !/users/i.test(h));
    const usersIdx = headers.findIndex(h => /^users$/i.test(h));
    const engagementRateIdx = headers.findIndex(h => /engagement.*rate/i.test(h));
    const avgTimeIdx = headers.findIndex(h => /average.*engagement.*time/i.test(h) || /avg.*time/i.test(h));
    const conversionsIdx = headers.findIndex(h => /conversions/i.test(h));
    
    if (pathIdx === -1 || sessionsIdx === -1 || usersIdx === -1 || engagementRateIdx === -1 || avgTimeIdx === -1 || conversionsIdx === -1) {
        throw new Error(`Required columns not found. Found: [${headers.join(', ')}]`);
    }
    
    // Parse data rows
    const rows = [];
    let skipped = 0;
    
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (/^#|^\/\//.test(line)) continue;
        
        try {
            const fields = parseCSVLine(line);
            if (fields.length <= Math.max(pathIdx, sessionsIdx, usersIdx, engagementRateIdx, avgTimeIdx, conversionsIdx)) {
                skipped++;
                continue;
            }
            
            const path = fields[pathIdx].trim();
            if (!path || path === 'Total') continue;
            
            const sessions = cleanNumber(fields[sessionsIdx]);
            const users = cleanNumber(fields[usersIdx]);
            const engagementRate = cleanPercent(fields[engagementRateIdx]);
            const avgTime = cleanTime(fields[avgTimeIdx]);
            const conversions = cleanNumber(fields[conversionsIdx]);
            
            if (sessions === null || users === null || engagementRate === null || avgTime === null || conversions === null) {
                skipped++;
                continue;
            }
            
            rows.push({
                path: path.startsWith('/') ? path : '/' + path,
                sessions,
                users,
                engagementRate,
                avgTime,
                conversions
            });
        } catch (e) {
            skipped++;
        }
    }
    
    return { rows, skipped, totalRows: lines.length - headerIndex - 1 };
}

function parseCSVLine(line) {
    const result = [];
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
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
}

function cleanNumber(str) {
    if (!str || typeof str !== 'string') return null;
    // Remove commas, percent signs, currency symbols, whitespace
    let cleaned = str.trim()
        .replace(/,/g, '')
        .replace(/%/g, '')
        .replace(/[$€£¥]/g, '')
        .replace(/—/g, '')
        .replace(/[–-]/g, '');
    
    if (cleaned === '' || cleaned === '0' || cleaned === '0.0') return 0;
    
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

function cleanPercent(str) {
    if (!str || typeof str !== 'string') return null;
    let cleaned = str.trim().replace(/%/g, '').replace(/,/g, '');
    if (cleaned === '' || cleaned === '—' || cleaned === '-') return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

function cleanTime(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim();
    if (trimmed === '' || trimmed === '—' || trimmed === '-') return null;
    
    // Handle "1m 24s" format
    const match = trimmed.match(/^(?:(\d+)\s*m(?:in)?)?[:\s]*(?:(\d+)\s*s(?:ec)?)?$/i);
    if (match) {
        const minutes = parseInt(match[1] || '0', 10);
        const seconds = parseInt(match[2] || '0', 10);
        return minutes * 60 + seconds;
    }
    
    // Handle "00:01:24" format (HH:MM:SS or MM:SS)
    const parts = trimmed.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    
    // Just try as seconds
    const num = parseFloat(trimmed);
    return isNaN(num) ? null : Math.round(num);
}

function computeMetrics(rows) {
    if (!rows || rows.length === 0) {
        return null;
    }
    
    const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);
    const totalUsers = rows.reduce((sum, r) => sum + r.users, 0);
    const totalConversions = rows.reduce((sum, r) => sum + r.conversions, 0);
    
    // Sort by sessions descending
    const sorted = [...rows].sort((a, b) => b.sessions - a.sessions);
    
    // Median engagement rate
    const engagementRates = sorted.map(r => r.engagementRate).filter(r => r !== null).sort((a, b) => a - b);
    const medianEngagementRate = engagementRates.length > 0
        ? (engagementRates.length % 2 === 0
            ? (engagementRates[engagementRates.length / 2 - 1] + engagementRates[engagementRates.length / 2]) / 2
            : engagementRates[Math.floor(engagementRates.length / 2)])
        : 0;
    
    // Median conversion rate (as percent of sessions)
    const conversionRates = sorted.map(r => (r.sessions > 0 ? (r.conversions / r.sessions) * 100 : 0)).sort((a, b) => a - b);
    const medianConversionRate = conversionRates.length > 0
        ? (conversionRates.length % 2 === 0
            ? (conversionRates[conversionRates.length / 2 - 1] + conversionRates[conversionRates.length / 2]) / 2
            : conversionRates[Math.floor(conversionRates.length / 2)])
        : 0;
    
    // Cumulative share calculation
    const shareData = sorted.map((r, i) => {
        const share = totalSessions > 0 ? (r.sessions / totalSessions) * 100 : 0;
        const cumulativeShare = i === 0 ? share : 0; // Will compute below
        return { ...r, share, cumulativeShare: 0 };
    });
    
    let cumSum = 0;
    for (let i = 0; i < shareData.length; i++) {
        cumSum += shareData[i].share;
        shareData[i].cumulativeShare = cumSum;
    }
    
    // Find 50% and 80% thresholds
    let first50 = 0;
    let first80 = 0;
    for (let i = 0; i < shareData.length; i++) {
        if (shareData[i].cumulativeShare <= 50) first50 = i + 1;
        if (shareData[i].cumulativeShare <= 80) first80 = i + 1;
    }
    first50 = Math.min(first50 + 1, shareData.length);
    first80 = Math.min(first80 + 1, shareData.length);
    
    // Top quartile: pages in the top 25% of sessions
    const topQuartileThreshold = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.25)].sessions : 0;
    
    return {
        totalSessions,
        totalUsers,
        totalConversions,
        sorted: shareData,
        medianEngagementRate: Math.round(medianEngagementRate * 10) / 10,
        medianConversionRate: Math.round(medianConversionRate * 10) / 10,
        first50Count: first50,
        first80Count: first80,
        topQuartileThreshold,
        concentrationNote: `${first50} pages drive the first 50% of traffic; ${first80} pages drive the first 80%.`
    };
}

function identifyItems(rows, metrics) {
    const items = [];
    const { sorted, totalSessions, medianEngagementRate, medianConversionRate, topQuartileThreshold, first80Count } = metrics;
    
    // TOP items: pages in the first 80% of traffic, headlined individually
    const topPages = sorted.filter(r => r.cumulativeShare <= 80);
    for (let i = 0; i < Math.min(topPages.length, 25); i++) {
        const page = topPages[i];
        const convRate = page.sessions > 0 ? ((page.conversions / page.sessions) * 100) : 0;
        const engagementVsMedian = page.engagementRate >= medianEngagementRate ? 'above' : 'below';
        const convVsMedian = convRate >= medianConversionRate ? 'above' : 'below';
        
        items.push({
            status: 'TOP',
            headline: page.path,
            was: `${i === 0 ? '0' : ((sorted[i - 1]?.cumulativeShare || 0).toFixed(1) + '%')}`,
            now: `${page.share.toFixed(1)}%`,
            detail: `Page has ${page.sessions.toLocaleString()} sessions (${page.share.toFixed(1)}% of total). Engagement rate of ${page.engagementRate.toFixed(1)}% is ${engagementVsMedian} the site median of ${medianEngagementRate.toFixed(1)}%. Conversion rate of ${convRate.toFixed(1)}% is ${convVsMedian} the site median of ${medianConversionRate.toFixed(1)}%.`,
            note: convRate >= medianConversionRate ? 'Maintain and refresh content regularly' : 'Consider optimization to improve conversion rate',
            source: page.path
        });
    }
    
    // LEAK items: pages in top quartile of sessions with conversion rate < half median
    const leakCandidates = sorted.filter(r => r.sessions >= topQuartileThreshold);
    for (const page of leakCandidates) {
        const convRate = page.sessions > 0 ? ((page.conversions / page.sessions) * 100) : 0;
        if (convRate < medianConversionRate / 2) {
            items.push({
                status: 'LEAK',
                headline: page.path,
                was: `${page.share.toFixed(1)}%`,
                now: `${page.share.toFixed(1)}%`,
                detail: `High-traffic page with ${page.sessions.toLocaleString()} sessions (${page.share.toFixed(1)}% share) but conversion rate of ${convRate.toFixed(1)}% is under half the site median of ${medianConversionRate.toFixed(1)}%. Engagement rate is ${page.engagementRate.toFixed(1)}% vs median ${medianEngagementRate.toFixed(1)}%.`,
                note: 'Investigate user intent mismatch or usability issues on this page',
                source: page.path
            });
        }
    }
    
    // THIN item: pages under 1% of sessions
    const thinPages = sorted.filter(r => r.share < 1);
    if (thinPages.length > 0) {
        const combinedShare = thinPages.reduce((sum, r) => sum + r.share, 0);
        const avgEngagement = thinPages.reduce((sum, r) => sum + r.engagementRate, 0) / thinPages.length;
        items.push({
            status: 'THIN',
            headline: `${thinPages.length} low-traffic pages combined`,
            was: `${combinedShare.toFixed(1)}%`,
            now: `${combinedShare.toFixed(1)}%`,
            detail: `${thinPages.length} pages each receive less than 1% of traffic, together accounting for ${combinedShare.toFixed(1)}% of total sessions. Average engagement rate among these pages is ${avgEngagement.toFixed(1)}%, suggesting content quality or relevance issues.`,
            note: 'Consider consolidating or pruning these pages to improve site authority',
            source: 'Various low-traffic paths'
        });
    }
    
    // TOTAL item
    items.push({
        status: 'TOTAL',
        headline: 'Site-wide totals',
        was: totalSessions.toLocaleString(),
        now: totalSessions.toLocaleString(),
        detail: `Total sessions across all analyzed pages: ${totalSessions.toLocaleString()}. Median engagement rate: ${medianEngagementRate.toFixed(1)}%. Median conversion rate: ${medianConversionRate.toFixed(1)}%. ${metrics.concentrationNote}`,
        note: '',
        source: ''
    });
    
    return items;
}

// ============================================================
// Main run function
// ============================================================
async function run(P, input, sourceName) {
    line(C.dim('Parsing CSV data...'));
    const parsed = parseCSV(input);
    endline();
    
    out(` ${C.teal('Read')} ${parsed.rows.length} pages from ${sourceName} (${parsed.skipped} rows skipped)`);
    
    if (parsed.rows.length === 0) {
        const items = [{
            status: 'FAIL',
            headline: 'No valid data rows found',
            was: '',
            now: '',
            detail: `Could not parse any valid page data from the input. ${parsed.skipped} rows were skipped due to missing or invalid data. Ensure the file is a valid GA4 pages export CSV.`,
            note: 'Check file format and column headers',
            source: sourceName
        }];
        return items;
    }
    
    line(C.dim('Computing metrics...'));
    const metrics = computeMetrics(parsed.rows);
    endline();
    
    if (!metrics) {
        return [{
            status: 'FAIL',
            headline: 'Could not compute metrics',
            was: '',
            now: '',
            detail: 'The data could not be processed to compute site metrics. This may be due to data integrity issues.',
            note: '',
            source: sourceName
        }];
    }
    
    out(` ${C.teal('Metrics')} computed: ${metrics.totalSessions.toLocaleString()} sessions across ${parsed.rows.length} pages`);
    out(` ${C.dim(`Median engagement rate: ${metrics.medianEngagementRate.toFixed(1)}% | Median conversion rate: ${metrics.medianConversionRate.toFixed(1)}%`)}`);
    
    // Check for API key
    const keyVar = PROVIDER_ORDER.find(k => process.env[k]);
    let items = identifyItems(parsed.rows, metrics);
    
    if (keyVar) {
        line(C.dim(`Calling ${keyVar.replace('_API_KEY', '')} API for analysis...`));
        
        try {
            // Build prompt with top 25 rows and computed totals
            const topRows = metrics.sorted.slice(0, 25).map(r => ({
                path: r.path,
                sessions: r.sessions,
                share: r.share.toFixed(1) + '%',
                cumulativeShare: r.cumulativeShare.toFixed(1) + '%',
                engagementRate: r.engagementRate.toFixed(1) + '%',
                avgTime: r.avgTime + 's',
                conversions: r.conversions,
                conversionRate: (r.sessions > 0 ? ((r.conversions / r.sessions) * 100).toFixed(2) : '0.00') + '%'
            }));
            
            const prompt = `Analyze this GA4 pages export data. We have ${parsed.rows.length} pages with ${metrics.totalSessions.toLocaleString()} total sessions.

Site-wide metrics:
- Total sessions: ${metrics.totalSessions.toLocaleString()}
- Median engagement rate: ${metrics.medianEngagementRate.toFixed(1)}%
- Median conversion rate: ${metrics.medianConversionRate.toFixed(1)}%
- ${metrics.first50Count} pages drive the first 50% of traffic
- ${metrics.first80Count} pages drive the first 80% of traffic

Top 25 pages by traffic (with cumulative share):\n${JSON.stringify(topRows, null, 2)}

Provide a JSON object with:
1. headline_finding: One sentence summary of the main traffic pattern
2. concentration_note: How concentrated or distributed the traffic is
3. pages: Array of objects for each page in the top 80% of traffic, with:
   - path: the page path
   - verdict: "workhorse" (above median engagement and conversion), "leaking" (above median traffic but below half median conversion), or "thin" (below 1% traffic)
   - why: One sentence explanation
   - action: One sentence recommended action`;

            const schema = {
                type: 'object',
                properties: {
                    headline_finding: { type: 'string' },
                    concentration_note: { type: 'string' },
                    pages: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string' },
                                verdict: { type: 'string', enum: ['workhorse', 'leaking', 'thin'] },
                                why: { type: 'string' },
                                action: { type: 'string' }
                            },
                            required: ['path', 'verdict', 'why', 'action']
                        }
                    }
                },
                required: ['headline_finding', 'concentration_note', 'pages']
            };
            
            const text = await ask(P, { system: 'You analyze web analytics data and provide concise, actionable insights.', prompt, schema, maxTokens: 6000 });
            const analysis = parseJSON(text);
            
            // Merge AI findings into our items
            if (analysis && analysis.pages) {
                const aiMap = new Map(analysis.pages.map(p => [p.path, p]));
                for (let i = 0; i < items.length; i++) {
                    const ai = aiMap.get(items[i].headline);
                    if (ai && items[i].status === 'TOP') {
                        items[i].note = ai.action || items[i].note;
                    }
                }
                
                // Add AI headline as a TOTAL note
                const totalItem = items.find(i => i.status === 'TOTAL');
                if (totalItem && analysis.headline_finding) {
                    totalItem.detail += ` AI finding: ${analysis.headline_finding}. ${analysis.concentration_note || ''}`;
                }
            }
            
            endline();
            out(` ${C.green('✓')} AI analysis complete`);
        } catch (err) {
            endline();
            out(` ${C.red('✗')} AI analysis failed: ${err.message}`);
            items.push({
                status: 'FAIL',
                headline: 'AI analysis failed',
                was: '',
                now: '',
                detail: `The attempt to get AI-powered analysis failed: ${err.message}. All numeric analysis is still available.`,
                note: 'Check your API key or try again later',
                source: ''
            });
        }
    } else {
        items.push({
            status: 'FAIL',
            headline: 'No API key configured',
            was: '',
            now: '',
            detail: NO_SEARCH_NOTE + ' All numerical analysis is complete. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY to get AI-powered insights.',
            note: 'Set a provider API key and re-run to enrich analysis',
            source: ''
        });
    }
    
    return items;
}

async function runDemo(writeHTML) {
    line(C.dim('Running demo analysis...'));
    await new Promise(r => setTimeout(r, 500));
    endline();
    
    out(` ${C.teal('Demo Mode')} — showing example output`);
    out(` ${C.dim('No API key required; no network calls made')}`);
    out('');
    
    // Simulate progress
    line(C.dim('Parsing CSV data...'));
    await new Promise(r => setTimeout(r, 300));
    endline();
    
    out(` ${C.teal('Read')} 27 pages from demo data (0 rows skipped)`);
    
    line(C.dim('Computing metrics...'));
    await new Promise(r => setTimeout(r, 300));
    endline();
    
    out(` ${C.teal('Metrics')} computed: 35,482 sessions across 27 pages`);
    out(` ${C.dim('Median engagement rate: 52.1% | Median conversion rate: 1.2%')}`);
    
    line(C.dim('Identifying patterns...'));
    await new Promise(r => setTimeout(r, 400));
    endline();
    
    out(` ${C.green('✓')} Analysis complete`);
    
    renderFindings(DEMO);
    
    if (writeHTML) {
        const htmlPath = './ga4-traffic-report-demo.html';
        const { writeFileSync } = require('fs');
        const html = buildHTML({
            subject: 'Demo GA4 pages export analysis',
            body: DEMO
        });
        writeFileSync(htmlPath, html, 'utf-8');
        renderSummary(DEMO, htmlPath);
    } else {
        renderSummary(DEMO, null);
    }
}

// ============================================================
// Entry point
// ============================================================
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        out('');
        out(bold('GA4 Pages Export Analyzer'));
        out(C.dim(PITCH));
        out('');
        out(bold('Usage:'));
        out(`  node ${process.argv[1]} <input>`);
        out(`  node ${process.argv[1]} --demo`);
        out(`  node ${process.argv[1]} --help`);
        out('');
        out(bold('Arguments:'));
        for (const [arg, desc] of USAGE) {
            out(`  ${C.teal(pad(arg, 16))}${desc}`);
        }
        out('');
        out(bold('Environment:'));
        out(`  ${C.teal(pad('ANTHROPIC_API_KEY', 20))}${C.dim('Set one of these to get AI insights')}`);
        out(`  ${C.teal(pad('OPENAI_API_KEY', 20))}${C.dim('(otherwise local analysis only)')}`);
        out(`  ${C.teal(pad('GEMINI_API_KEY', 20))}${C.dim('')}`);
        out('');
        return;
    }
    
    if (args.includes('--demo')) {
        await runDemo(true);
        return;
    }
    
    const inputArg = args[0];
    let input;
    let sourceName;
    
    if (!inputArg || inputArg === '-') {
        // Read from stdin
        sourceName = 'stdin';
        const chunks = [];
        process.stdin.setEncoding('utf-8');
        
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        input = chunks.join('');
        
        if (!input || input.trim().length === 0) {
            out(C.red('Error: No input received from stdin.'));
            out(C.dim('Usage: node ga4-analyzer.js <file> | cat file.csv | node ga4-analyzer.js'));
            process.exit(1);
        }
    } else {
        // Read from file
        const fs = require('fs');
        const path = require('path');
        sourceName = path.resolve(inputArg);
        
        try {
            input = fs.readFileSync(sourceName, 'utf-8');
        } catch (err) {
            out(C.red(`Error reading file: ${err.message}`));
            process.exit(1);
        }
    }
    
    const items = await run(null, input, sourceName);
    
    renderFindings(items);
    renderSummary(items, null);
}

main().catch(err => {
    out(C.red(`Unhandled error: ${err.message}`));
    out(C.dim(err.stack));
    process.exit(1);
});
