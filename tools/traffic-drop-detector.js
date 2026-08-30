// ============================================================
// Ammar Imtiaz - Traffic Drop Detector
// ============================================================
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz
// ============================================================

// traffic-drop-detector.js
// A standalone Node.js script to analyze GA4/Google Search Console traffic drops

// ============================================================
// CONSTANTS AND CONFIGURATION
// ============================================================

const PITCH = "Analyzes GA4 exports to find pages losing traffic and suggests likely causes";
const USAGE = [
  ['<input>', 'read a GA4 CSV export file or two period exports separated by space (quoted)'],
  ['-', 'read from stdin'],
  ['--demo', 'see the output without making any API calls or providing a key'],
  ['--help', 'show this usage information']
];

const STATUS = {
  DROP: { glyph: '-', color: null, label: 'drop' },    // color set later via C.red
  RISE: { glyph: '+', color: null, label: 'rise' },
  NOISE: { glyph: '~', color: null, label: 'noise' },
  SITE: { glyph: '*', color: null, label: 'site' },
  FAIL: { glyph: '!', color: null, label: 'fail' }
};

const ITEM_NOUN = "finding";
const NOTE_LABEL = "Verification";
const NO_SEARCH_NOTE = "No API key found: computed numbers are shown below but the AI-powered cause analysis was skipped.";
const SUMMARY_NOTE = (items) => {
  const drops = items.filter(i => i.status === 'DROP').length;
  const rises = items.filter(i => i.status === 'RISE').length;
  return `${drops} pages declining, ${rises} pages rising. Check the HTML report for details.`;
};

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

// Set colors on STATUS objects after C is defined
STATUS.DROP.color = C.red;
STATUS.RISE.color = C.green;
STATUS.NOISE.color = C.dim;
STATUS.SITE.color = C.teal;
STATUS.FAIL.color = C.amber;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Parse JSON text with fallbacks for code fences and brace scanning
 */
function parseJSON(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Empty or non-string input to parseJSON');
  }

  let cleaned = text.trim();

  // Attempt 1: Direct parse
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // continue to fallbacks
  }

  // Attempt 2: Remove markdown fenced blocks
  const fencedMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch (e) {
      // continue to next fallback
    }
  }

  // Attempt 3: Remove everything before first { and after last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const jsonCandidate = cleaned.substring(firstBrace, lastBrace + 1);
      return JSON.parse(jsonCandidate);
    } catch (e) {
      // continue to error
    }
  }

  // Attempt 4: Look for [ ] array
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const jsonCandidate = cleaned.substring(firstBracket, lastBracket + 1);
      return JSON.parse(jsonCandidate);
    } catch (e) {
      // fall through to error
    }
  }

  throw new Error(`Cannot parse JSON from text. First 200 chars: ${cleaned.substring(0, 200)}`);
}

/**
 * Make a single API call to an LLM provider
 */
async function ask(P, { system, prompt, schema, maxTokens }) {
  let apiKey, endpoint, model, provider;

  // Determine which provider to use
  if (process.env.ANTHROPIC_API_KEY) {
    apiKey = process.env.ANTHROPIC_API_KEY;
    provider = 'Anthropic';
    endpoint = 'https://api.anthropic.com/v1/messages';
    model = 'claude-3-haiku-20240307';
    line(`Using ${C.green('Anthropic')} API`);
  } else if (process.env.OPENAI_API_KEY) {
    apiKey = process.env.OPENAI_API_KEY;
    provider = 'OpenAI';
    endpoint = 'https://api.openai.com/v1/chat/completions';
    model = 'gpt-4-1106-preview';
    line(`Using ${C.green('OpenAI')} API`);
  } else if (process.env.GEMINI_API_KEY) {
    apiKey = process.env.GEMINI_API_KEY;
    provider = 'Gemini';
    endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
    model = 'gemini-pro';
    line(`Using ${C.green('Gemini')} API`);
  } else {
    throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
  }

  const url = new URL(endpoint);
  const headers = { 'Content-Type': 'application/json' };
  let body;

  if (provider === 'Anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = JSON.stringify({
      model: model,
      max_tokens: maxTokens || 4096,
      system: system || '',
      messages: [
        ...(prompt ? [{ role: 'user', content: prompt }] : []),
        { role: 'user', content: `Return ONLY valid JSON matching this schema: ${JSON.stringify(schema)}. No other text.` }
      ]
    });
  } else if (provider === 'OpenAI') {
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = JSON.stringify({
      model: model,
      max_tokens: maxTokens || 4096,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...(prompt ? [{ role: 'user', content: prompt }] : []),
        { role: 'user', content: `Return ONLY valid JSON matching this schema: ${JSON.stringify(schema)}. No other text.` }
      ]
    });
  } else if (provider === 'Gemini') {
    body = JSON.stringify({
      contents: [{
        parts: [{
          text: `${system ? system + '\n\n' : ''}${prompt ? prompt + '\n\n' : ''}Return ONLY valid JSON matching this schema: ${JSON.stringify(schema)}. No other text.`
        }]
      }],
      generationConfig: {
        maxOutputTokens: maxTokens || 4096
      }
    });
    url.searchParams.set('key', apiKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: headers,
      body: body,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    if (provider === 'Anthropic') {
      return data.content[0].text;
    } else if (provider === 'OpenAI') {
      return data.choices[0].message.content;
    } else if (provider === 'Gemini') {
      return data.candidates[0].content.parts[0].text;
    }
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Process items in parallel with concurrency limit
 */
async function mapLimit(items, limit, fn) {
  const results = [];
  const executing = [];
  
  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i));
    results.push(p);
    
    if (items.length > limit) {
      const e = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
      executing.push(e);
      
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  
  return Promise.all(results);
}

/**
 * Write a progress line that can be overwritten
 */
let currentLine = '';
function line(text) {
  const lines = text.split('\n');
  const lastLine = lines[lines.length - 1];
  
  if (currentLine) {
    process.stdout.write('\x1b[K\r');
  }
  currentLine = lastLine;
  process.stdout.write(lastLine);
}

/**
 * Close the current progress line
 */
function endline() {
  if (currentLine) {
    process.stdout.write('\n');
    currentLine = '';
  }
}

/**
 * Standard output
 */
function out(text) {
  console.log(text);
}

/**
 * Bold text
 */
function bold(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

/**
 * Simple progress bar
 */
function bar(i, total) {
  const width = 20;
  const filled = Math.round((i / total) * width);
  const empty = width - filled;
  return `[${'#'.repeat(filled)}${'-'.repeat(empty)}]`;
}

/**
 * Wrap text to a given width
 */
function wrap(text, width) {
  if (text.length <= width) return [text];
  
  const words = text.split(' ');
  const lines = [];
  let current = '';
  
  for (const word of words) {
    if ((current + ' ' + word).length > width) {
      lines.push(current.trim());
      current = word;
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current) lines.push(current.trim());
  
  return lines;
}

/**
 * Clip text to n chars, adding ellipsis
 */
function clip(text, n) {
  if (text.length <= n) return text;
  return text.substring(0, n - 3) + '...';
}

/**
 * Pad text to n characters
 */
function pad(text, n) {
  const s = String(text);
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

/**
 * Render findings to terminal
 */
function renderFindings(items) {
  endline();
  out('');
  out(bold('Findings:'));
  out('');
  
  for (const item of items) {
    const status = STATUS[item.status];
    const color = status.color;
    const glyph = status.glyph;
    const label = status.label;
    
    // Headline with status
    const headline = color(`${glyph} [${label}] ${item.headline}`);
    out(headline);
    
    // Detail (indented and dimmed)
    const detailLines = wrap(item.detail, 72);
    for (const line of detailLines) {
      out(C.dim(`  ${line}`));
    }
    
    // Was/Now if present
    if (item.was || item.now) {
      out(C.dim(`  Was: ${item.was || 'N/A'} → Now: ${item.now || 'N/A'}`));
    }
    
    // Note if present
    if (item.note) {
      out(`  ${C.amber('→')} ${item.note}`);
    }
    
    // Source if present
    if (item.source) {
      out(C.dim(`  ${item.source}`));
    }
    
    out('');
  }
}

/**
 * Render summary line
 */
function renderSummary(items, htmlPath) {
  endline();
  
  const drops = items.filter(i => i.status === 'DROP').length;
  const rises = items.filter(i => i.status === 'RISE').length;
  const noises = items.filter(i => i.status === 'NOISE').length;
  const fails = items.filter(i => i.status === 'FAIL').length;
  
  out('');
  out(bold('Summary:'));
  out(C.red(`  ${drops} pages dropping`));
  out(C.green(`  ${rises} pages rising`));
  if (noises > 0) out(C.dim(`  ${noises} pages below threshold (noise)`));
  if (fails > 0) out(C.amber(`  ${fails} failures`));
  
  const note = SUMMARY_NOTE(items);
  if (note) out(C.dim(`  ${note}`));
  
  if (htmlPath) {
    out(C.green(`\n  HTML report written to: ${htmlPath}`));
  }
}

/**
 * Build a complete standalone HTML page
 */
function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; line-height: 1.6; color: #333; }
  h1 { color: #1a1a1a; border-bottom: 2px solid #eee; padding-bottom: 0.5em; }
  h2 { color: #444; margin-top: 2em; }
  .finding { margin: 1.5em 0; padding: 1em; border-left: 4px solid #ddd; background: #fafafa; }
  .finding.DROP { border-left-color: #e74c3c; }
  .finding.RISE { border-left-color: #27ae60; }
  .finding.NOISE { border-left-color: #95a5a6; }
  .finding.SITE { border-left-color: #3498db; }
  .finding.FAIL { border-left-color: #f39c12; }
  .headline { font-weight: bold; font-size: 1.1em; margin-bottom: 0.5em; }
  .detail { color: #555; margin: 0.5em 0; }
  .wasnow { color: #777; font-size: 0.9em; margin: 0.5em 0; }
  .note { color: #e67e22; font-size: 0.9em; margin: 0.5em 0; }
  .note:before { content: "→ "; }
  .source { color: #999; font-size: 0.85em; margin: 0.5em 0; font-family: monospace; }
  .status-badge { display: inline-block; padding: 0.2em 0.6em; border-radius: 3px; font-size: 0.8em; margin-right: 0.5em; }
  .status-DROP { background: #fce4e4; color: #c0392b; }
  .status-RISE { background: #e8f8f0; color: #1e8449; }
  .status-NOISE { background: #f0f0f0; color: #666; }
  .status-SITE { background: #e4f0fc; color: #2874a6; }
  .status-FAIL { background: #fef3e4; color: #b7950b; }
  .summary { background: #f8f9fa; padding: 1em; border-radius: 6px; margin-top: 2em; }
  .note-text { font-style: italic; color: #888; margin-top: 2em; padding: 0.5em; border-top: 1px solid #eee; }
</style>
</head>
<body>
<h1>${subject}</h1>
${body}
</body>
</html>`;
}

// ============================================================
// DEMO DATA AND DEMO RUNNER
// ============================================================

const DEMO = [
  {
    status: 'DROP',
    headline: '/blog/seo-guide-2024 loses 47% of traffic',
    was: '12,847 sessions',
    now: '6,802 sessions',
    detail: 'This comprehensive SEO guide was the top-performing blog post in Q1 2024, generating significant organic traffic through featured snippets. The traffic drop coincides with a Google core algorithm update in March 2024 that devalued certain types of listicle-style content. The page lost its featured snippet position to a competitor with more recent publication date and fresher statistics.',
    note: 'Check Google Search Console for query-level changes; consider updating with 2024 data and restructuring the content format to match current best practices.',
    source: 'https://example.com/blog/seo-guide-2024'
  },
  {
    status: 'DROP',
    headline: '/products/analytics-tool drops 63% month-over-month',
    was: '5,234 sessions',
    now: '1,937 sessions',
    detail: 'The product page for the Analytics Pro tool experienced a sudden drop coinciding with the removal of a prominent "Free Trial" CTA button above the fold. User flow analysis shows the bounce rate increased from 34% to 62% on this page, suggesting visitors cannot find the conversion path they expect. The page also lost backlinks from three major review sites that updated their recommendations.',
    note: 'Restore prominent CTA button and audit backlink profile using Ahrefs or Majestic to identify lost opportunities.',
    source: 'https://example.com/products/analytics-tool'
  },
  {
    status: 'DROP',
    headline: '/resources/whitepaper-2023 declines by 82%',
    was: '3,456 sessions',
    now: '622 sessions',
    detail: 'This gated whitepaper download page for "Digital Transformation in 2023" has become obsolete as the industry has moved to 2024 strategies. The content is dated and the form asks for outdated job titles and company sizes. Additionally, the redirect from the original marketing campaign URL was left in place past the campaign end date, causing a 301 chain that hurts ranking signals.',
    note: 'Update to 2024 version or set proper 410 Gone status; remove campaign redirect chains.',
    source: 'https://example.com/resources/whitepaper-2023'
  },
  {
    status: 'RISE',
    headline: '/blog/remote-work-tools gains 145% traffic',
    was: '892 sessions',
    now: '2,186 sessions',
    detail: 'This article about remote work productivity tools has seen substantial growth driven by a viral LinkedIn post from a industry influencer who shared the article with their 50,000+ followers. The article ranks for 12 new long-tail keywords following a recent content refresh that added tool comparisons and real user reviews. The page now appears in Google\'s "People Also Ask" section for three high-volume queries.',
    note: 'Capitalize on momentum with related content; consider adding email capture to build audience.',
    source: 'https://example.com/blog/remote-work-tools'
  },
  {
    status: 'NOISE',
    headline: '24 pages with minimal traffic changes (below 50-session floor)',
    was: '',
    now: '',
    detail: 'These pages had fewer than 50 sessions in the earlier period, making percent-change calculations unreliable and susceptible to noise. They represent a cumulative 287 sessions in the earlier period and 203 sessions in the later period. No meaningful conclusions can be drawn about individual page performance.',
    note: 'Consider consolidating thin content pages or adding internal links to boost discoverability.',
    source: ''
  },
  {
    status: 'SITE',
    headline: 'Site-wide traffic change: -18.3% overall',
    was: '45,678 sessions',
    now: '37,289 sessions',
    detail: 'The site experienced a net loss of 8,389 sessions (-18.3%) across all pages. The top 3 declining pages account for 62% of the total loss. Seasonal factors (summer holiday period) may account for some decline, but the magnitude exceeds typical seasonal variation of +/-5% observed in the same period last year. Multiple algorithm updates and technical issues may be contributing factors.',
    note: 'Conduct comprehensive site audit including Core Web Vitals, backlink profile, and competitor analysis.',
    source: 'https://example.com'
  }
];

async function runDemo(writeHTML) {
  line(`Running ${C.green('demo')} mode - no API calls`);
  await new Promise(r => setTimeout(r, 500));
  line('Processing demo data...');
  await new Promise(r => setTimeout(r, 500));
  endline();
  
  renderFindings(DEMO);
  
  let htmlPath = null;
  
  if (writeHTML) {
    const bodyItems = DEMO.map(item => {
      const statusClass = item.status;
      return `
    <div class="finding ${statusClass}">
      <div class="headline"><span class="status-badge status-${statusClass}">${item.status}</span> ${item.headline}</div>
      <div class="detail">${item.detail}</div>
      ${item.was || item.now ? `<div class="wasnow">Was: ${item.was || 'N/A'} → Now: ${item.now || 'N/A'}</div>` : ''}
      ${item.note ? `<div class="note">${item.note}</div>` : ''}
      ${item.source ? `<div class="source">${item.source}</div>` : ''}
    </div>`;
    }).join('\n');
    
    const summary = `
  <div class="summary">
    <h2>Summary</h2>
    <p>${DEMO.filter(i => i.status === 'DROP').length} pages dropping, ${DEMO.filter(i => i.status === 'RISE').length} pages rising, ${DEMO.filter(i => i.status === 'NOISE').length} below threshold, ${DEMO.filter(i => i.status === 'FAIL').length} failures.</p>
  </div>
  <div class="note-text">${NO_SEARCH_NOTE}</div>`;
    
    const html = buildHTML({
      subject: 'Traffic Drop Detector - Demo Report',
      body: bodyItems + summary
    });
    
    const fs = require('fs');
    htmlPath = './traffic-drop-detector-demo.html';
    fs.writeFileSync(htmlPath, html);
    out(C.green(`HTML report written to: ${htmlPath}`));
  }
  
  renderSummary(DEMO, htmlPath);
}

// ============================================================
// MAIN FUNCTIONALITY
// ============================================================

/**
 * Run the analysis on real data
 */
async function run(P, input, sourceName) {
  line(`Analyzing ${C.green(sourceName)}...`);
  
  // Determine the shape of input
  const lines = input.split('\n');
  let headerLine = -1;
  let dataStartLine = -1;
  
  // Find the header row
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim().toLowerCase();
    if (l.includes('page') || l.includes('path') || l.includes('url') || 
        (l.includes('sessions') && (l.includes('period') || l.includes('date')))) {
      headerLine = i;
      break;
    }
  }
  
  if (headerLine === -1) {
    throw new Error('Could not find header row containing "page", "path", "sessions", or date columns');
  }
  
  // Detect if two periods or one period with date column
  const header = parseCSVLine(lines[headerLine]);
  const hasDateColumn = header.some(h => h.toLowerCase().includes('date') || h.toLowerCase().includes('period'));
  const shape = hasDateColumn ? 'single export with date column' : 'two periods in one file';
  
  out(`Detected: ${C.green(shape)}`);
  
  // Parse the CSV data
  const data = [];
  let skippedRows = 0;
  
  for (let i = headerLine + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '' || l.startsWith('#')) continue;
    if (l.toLowerCase().startsWith('page') || l.toLowerCase().startsWith('path')) continue;
    
    try {
      const row = parseCSVLine(l);
      const page = row[0] || '';
      
      // Find session columns
      let before = 0, after = 0;
      
      if (hasDateColumn) {
        // Need to aggregate by period
        // For simplicity, assume columns are: page, date, sessions
        const sessions = parseNumber(row[2] || '0');
        const dateStr = row[1] || '';
        // Assume dates before July 2024 are "before", July onwards are "after"
        const refDate = new Date('2024-07-01');
        const rowDate = parseDate(dateStr);
        if (rowDate && rowDate < refDate) {
          before += sessions;
        } else {
          after += sessions;
        }
      } else {
        // Two sets of columns: page, before_sessions, after_sessions, etc.
        before = parseNumber(row[1] || '0');
        after = parseNumber(row[2] || '0');
      }
      
      if (page) {
        data.push({ page, before, after });
      } else {
        skippedRows++;
      }
    } catch (e) {
      skippedRows++;
    }
  }
  
  if (data.length === 0) {
    throw new Error('No valid data rows found in the export');
  }
  
  out(`Parsed ${C.green(data.length)} rows, skipped ${C.amber(skippedRows)} rows`);
  line('Computing page-level changes...');
  
  // Compute per-page metrics
  const totalBefore = data.reduce((sum, d) => sum + d.before, 0);
  const totalAfter = data.reduce((sum, d) => sum + d.after, 0);
  const totalChange = totalAfter - totalBefore;
  
  const computed = data.map(d => {
    const change = d.after - d.before;
    const pctChange = d.before > 0 ? ((change / d.before) * 100) : 0;
    const shareOfLoss = totalChange !== 0 && change < 0 ? (Math.abs(change) / Math.abs(totalChange)) * 100 : 0;
    return {
      page: d.page,
      before: d.before,
      after: d.after,
      change,
      pctChange,
      shareOfLoss
    };
  });
  
  // Apply floor: need at least 50 sessions in earlier period for meaningful percent change
  const aboveFloor = computed.filter(d => d.before >= 50);
  const belowFloor = computed.filter(d => d.before < 50);
  
  // Sort by absolute sessions lost
  const sortedByLoss = [...aboveFloor].sort((a, b) => a.change - b.change);
  
  // Build items
  const items = [];
  
  // Top drops (20 largest absolute losses)
  const topDrops = sortedByLoss.filter(d => d.change < 0).slice(0, 20);
  line(`Top ${C.red(topDrops.length)} drops identified`);
  
  // Build drops as preliminary items (will be enriched by AI if available)
  for (const d of topDrops) {
    const pctStr = d.before >= 50 ? `${d.pctChange.toFixed(1)}%` : 'N/A (below floor)';
    items.push({
      status: 'DROP',
      headline: `${d.page} loses ${Math.abs(d.change).toLocaleString()} sessions`,
      was: `${d.before.toLocaleString()} sessions`,
      now: `${d.after.toLocaleString()} sessions`,
      detail: `This page had ${d.before.toLocaleString()} sessions in the earlier period and ${d.after.toLocaleString()} in the later period, a change of ${d.change > 0 ? '+' : ''}${d.change.toLocaleString()} (${pctStr}). It accounts for ${d.shareOfLoss.toFixed(1)}% of the site's total traffic decline.`,
      note: NO_SEARCH_NOTE,
      source: d.page
    });
  }
  
  // Top gainers (3 largest absolute gains)
  const topGainers = sortedByLoss.filter(d => d.change > 0).sort((a, b) => b.change - a.change).slice(0, 3);
  for (const d of topGainers) {
    items.push({
      status: 'RISE',
      headline: `${d.page} gains ${d.change.toLocaleString()} sessions`,
      was: `${d.before.toLocaleString()} sessions`,
      now: `${d.after.toLocaleString()} sessions`,
      detail: `This page gained ${d.change.toLocaleString()} sessions (+${d.pctChange.toFixed(1)}%), going from ${d.before.toLocaleString()} to ${d.after.toLocaleString()} sessions. This growth offsets some of the site's overall decline.`,
      note: 'Consider what drove this growth and replicate successful strategies on declining pages.',
      source: d.page
    });
  }
  
  // Noise items (below floor)
  if (belowFloor.length > 0) {
    const belowBefore = belowFloor.reduce((sum, d) => sum + d.before, 0);
    const belowAfter = belowFloor.reduce((sum, d) => sum + d.after, 0);
    items.push({
      status: 'NOISE',
      headline: `${belowFloor.length} pages with minimal traffic (below 50-session floor)`,
      was: '',
      now: '',
      detail: `These ${belowFloor.length} pages had fewer than 50 sessions in the earlier period, making percent-change calculations unreliable. They represent ${belowBefore} sessions before and ${belowAfter} sessions after. No meaningful individual conclusions can be drawn.`,
      note: 'Consider whether these pages should be consolidated or promoted with internal links.',
      source: ''
    });
  }
  
  // Site-wide item
  const totalPct = totalBefore > 0 ? ((totalChange / totalBefore) * 100) : 0;
  items.push({
    status: 'SITE',
    headline: `Site-wide traffic change: ${totalChange >= 0 ? '+' : ''}${totalChange.toLocaleString()} sessions (${totalPct.toFixed(1)}%)`,
    was: `${totalBefore.toLocaleString()} sessions`,
    now: `${totalAfter.toLocaleString()} sessions`,
    detail: `Across all ${data.length} pages, the site went from ${totalBefore.toLocaleString()} to ${totalAfter.toLocaleString()} sessions, a ${totalChange >= 0 ? 'gain' : 'loss'} of ${Math.abs(totalChange).toLocaleString()} sessions (${totalPct.toFixed(1)}%). The top ${topDrops.length} declining pages account for ${topDrops.reduce((sum, d) => sum + d.shareOfLoss, 0).toFixed(1)}% of the total change.`,
    note: 'Seasonal factors, algorithm updates, or technical issues may be at play. Check Google Search Console for broader trends.',
    source: ''
  });
  
  // Try to enrich with AI if provider is available
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  
  if (hasKey) {
    endline();
    line('Calling AI for cause analysis...');
    
    const dropItems = items.filter(i => i.status === 'DROP').slice(0, 20);
    const promptData = dropItems.map(i => ({
      path: i.headline.split(' loses')[0],
      beforeSessions: i.was,
      afterSessions: i.now,
      change: i.headline.split(' loses ')[1]?.split(' ')[0] || 'unknown'
    }));
    
    try {
      const result = await ask(P, {
        system: 'You are a traffic analysis expert. Analyze the provided data and return JSON only.',
        prompt: `Analyze these traffic drops and suggest likely causes. Data: ${JSON.stringify(promptData, null, 2)}`,
        schema: {
          site_verdict: 'Overall assessment of the traffic pattern',
          drops: [
            {
              path: 'string',
              likely_cause: 'string',
              check_first: 'string',
              confidence: 'confirmed|likely|assumption'
            }
          ]
        },
        maxTokens: 6000
      });
      
      const analysis = parseJSON(result);
      
      if (analysis && analysis.drops) {
        for (const drop of analysis.drops) {
          const item = items.find(i => i.headline.startsWith(drop.path));
          if (item) {
            const confGlyph = drop.confidence === 'confirmed' ? '✓' : drop.confidence === 'likely' ? '~' : '?';
            item.detail += `\nLikely cause: ${drop.likely_cause}`;
            item.note = `Check first: ${drop.check_first} [${confGlyph} ${drop.confidence}]`;
          }
        }
        
        // Update site item with verdict
        const siteItem = items.find(i => i.status === 'SITE');
        if (siteItem && analysis.site_verdict) {
          siteItem.detail += `\nAI assessment: ${analysis.site_verdict}`;
        }
      }
    } catch (e) {
      items.push({
        status: 'FAIL',
        headline: 'AI analysis failed',
        was: '',
        now: '',
        detail: `The AI provider returned an error: ${e.message}. Numeric analysis is still complete and shown above.`,
        note: 'Check API key validity and try again.',
        source: ''
      });
    }
  } else {
    // Add note to DROP items that AI wasn't used
    for (const item of items) {
      if (item.status === 'DROP' && item.note === NO_SEARCH_NOTE) {
        // Already set
      }
    }
  }
  
  return items;
}

// ============================================================
// CSV PARSING HELPERS
// ============================================================

/**
 * Parse a single CSV line with quoted field support
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    
    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a number from various formats (commas, percent signs, currency, time)
 */
function parseNumber(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'string') return 0;
  
  let cleaned = value.trim();
  
  // Remove common prefixes/suffixes
  cleaned = cleaned.replace(/^[\$€£¥]/, '');
  cleaned = cleaned.replace(/[%]$/, '');
  cleaned = cleaned.replace(/,/g, '');
  
  // Handle time format like "1m 24s" - convert to seconds
  const timeMatch = cleaned.match(/^(\d+)\s*m\s*(\d+)\s*s$/);
  if (timeMatch) {
    return parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
  }
  
  const timeMatch2 = cleaned.match(/^(\d+)\s*s$/);
  if (timeMatch2) {
    return parseInt(timeMatch2[1]);
  }
  
  // Try to parse as number
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse a date string into Date object (handles common formats)
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  
  // Try MM/DD/YYYY
  const parts = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parts) {
    return new Date(parseInt(parts[3]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  
  return null;
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length === 0) {
    out(bold(PITCH));
    out('');
    out(bold('Usage:'));
    out(`  node ${process.argv[1]} <input>`);
    out('');
    out(bold('Arguments:'));
    for (const [arg, desc] of USAGE) {
      out(`  ${pad(arg, 12)} ${desc}`);
    }
    out('');
    process.exit(0);
  }
  
  if (args.includes('--demo')) {
    const writeHTML = !args.includes('--no-html');
    await runDemo(writeHTML);
    process.exit(0);
  }
  
  // Read input
  const inputArg = args[0];
  let input, sourceName;
  
  if (inputArg === '-') {
    // Read from stdin
    sourceName = 'stdin';
    input = await new Promise((resolve, reject) => {
      const chunks = [];
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => chunks.push(chunk));
      process.stdin.on('end', () => resolve(chunks.join('')));
      process.stdin.on('error', reject);
    });
  } else {
    // Read file(s)
    const fs = require('fs');
    const paths = inputArg.split(' ').filter(p => p.trim());
    
    if (paths.length === 1) {
      sourceName = paths[0];
      input = fs.readFileSync(paths[0], 'utf8');
    } else if (paths.length === 2) {
      sourceName = `${paths[0]} and ${paths[1]}`;
      // Combine the two files: assume first is "before", second is "after"
      const beforeFile = fs.readFileSync(paths[0], 'utf8');
      const afterFile = fs.readFileSync(paths[1], 'utf8');
      input = `page,before_sessions,after_sessions\n${combinePeriods(beforeFile, afterFile)}`;
    } else {
      out(C.red('Error: Provide one CSV file, or two files separated by a space (quoted if paths contain spaces)'));
      process.exit(1);
    }
  }
  
  if (!input || input.trim().length === 0) {
    out(C.red('Error: Empty input'));
    process.exit(1);
  }
  
  // Run analysis
  try {
    const items = await run(null, input, sourceName);
    renderFindings(items);
    
    // Write HTML report
    const fs = require('fs');
    const bodyItems = items.map(item => {
      const statusClass = item.status;
      return `
    <div class="finding ${statusClass}">
      <div class="headline"><span class="status-badge status-${statusClass}">${item.status}</span> ${item.headline}</div>
      <div class="detail">${item.detail}</div>
      ${item.was || item.now ? `<div class="wasnow">Was: ${item.was || 'N/A'} → Now: ${item.now || 'N/A'}</div>` : ''}
      ${item.note ? `<div class="note">${item.note}</div>` : ''}
      ${item.source ? `<div class="source">${item.source}</div>` : ''}
    </div>`;
    }).join('\n');
    
    const drops = items.filter(i => i.status === 'DROP').length;
    const rises = items.filter(i => i.status === 'RISE').length;
    const noises = items.filter(i => i.status === 'NOISE').length;
    const fails = items.filter(i => i.status === 'FAIL').length;
    
    const summary = `
  <div class="summary">
    <h2>Summary</h2>
    <p>${drops} pages dropping, ${rises} pages rising, ${noises} below threshold, ${fails} failures.</p>
    <p>${SUMMARY_NOTE(items)}</p>
  </div>
  <div class="note-text">${NO_SEARCH_NOTE}</div>`;
    
    const html = buildHTML({
      subject: `Traffic Drop Detector - ${sourceName}`,
      body: bodyItems + summary
    });
    
    const htmlPath = './traffic-drop-detector-report.html';
    fs.writeFileSync(htmlPath, html);
    
    renderSummary(items, htmlPath);
    
  } catch (error) {
    out(C.red(`\nError: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Combine two period files into one CSV string
 */
function combinePeriods(beforeFile, afterFile) {
  const beforeLines = beforeFile.split('\n');
  const afterLines = afterFile.split('\n');
  
  // Find headers
  let beforeHeader = -1;
  let afterHeader = -1;
  
  for (let i = 0; i < beforeLines.length; i++) {
    const l = beforeLines[i].trim().toLowerCase();
    if (l.includes('page') || l.includes('path') || l.includes('url')) {
      beforeHeader = i;
      break;
    }
  }
  
  for (let i = 0; i < afterLines.length; i++) {
    const l = afterLines[i].trim().toLowerCase();
    if (l.includes('page') || l.includes('path') || l.includes('url')) {
      afterHeader = i;
      break;
    }
  }
  
  if (beforeHeader === -1 || afterHeader === -1) {
    throw new Error('Could not find header in one or both files');
  }
  
  // Parse both files into maps
  const beforeMap = new Map();
  const afterMap = new Map();
  
  for (let i = beforeHeader + 1; i < beforeLines.length; i++) {
    const l = beforeLines[i].trim();
    if (l === '' || l.startsWith('#')) continue;
    const row = parseCSVLine(l);
    const page = row[0];
    const sessions = parseNumber(row[1] || '0');
    if (page) beforeMap.set(page, sessions);
  }
  
  for (let i = afterHeader + 1; i < afterLines.length; i++) {
    const l = afterLines[i].trim();
    if (l === '' || l.startsWith('#')) continue;
    const row = parseCSVLine(l);
    const page = row[0];
    const sessions = parseNumber(row[1] || '0');
    if (page) afterMap.set(page, sessions);
  }
  
  // Combine all pages
  const allPages = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const lines = [];
  
  for (const page of allPages) {
    const before = beforeMap.get(page) || 0;
    const after = afterMap.get(page) || 0;
    // Escape quotes in page name
    const escapedPage = page.includes(',') ? `"${page}"` : page;
    lines.push(`${escapedPage},${before},${after}`);
  }
  
  return lines.join('\n');
}

// Run the program
main().catch(error => {
  out(C.red(`\nFatal error: ${error.message}`));
  process.exit(1);
});
