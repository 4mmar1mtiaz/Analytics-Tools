#!/usr/bin/env node

/*
 * Author: Ammar Imtiaz
 * www.ammarimtiaz.com
 * linkedin.com/in/ammarimtiaz
 * github.com/ammar1mtiaz
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const PITCH = "Audits UTM tracking in a URL list for taxonomy collisions, invalid mediums, internal tagging, and missing tags, then proposes a naming convention.";
const USAGE = [
  ['<file>', 'read URLs from a file (one per line)'],
  ['-', 'read stdin'],
  ['--demo', 'see the output, spend nothing']
];
const STATUS = {
  COLLISION: { glyph: '*', color: null, label: 'Collision' },
  INVALID:   { glyph: '!', color: null, label: 'Invalid' },
  INTERNAL:  { glyph: 'x', color: null, label: 'Internal' },
  UNTAGGED:  { glyph: '-', color: null, label: 'Untagged' },
  CONVENTION:{ glyph: '+', color: null, label: 'Convention' },
  FAIL:      { glyph: '=', color: null, label: 'Failure' }
};
const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'Fix';
const NO_SEARCH_NOTE = 'No API key was available — all computed results are shown below, but no naming convention was fetched.';
const SUMMARY_NOTE = (items) => {
  const count = items.filter(i => i.status === 'COLLISION' || i.status === 'INVALID' || i.status === 'INTERNAL' || i.status === 'UNTAGGED').length;
  if (count === 0) return 'All clear — no issues found.';
  return `${count} issue${count !== 1 ? 's' : ''} found. Review the report above.`;
};

// =============================================================================
// COLOUR FUNCTIONS
// =============================================================================

const C = {
  green:  (s) => `\x1b[32m${s}\x1b[39m`,
  amber:  (s) => `\x1b[33m${s}\x1b[39m`,
  red:    (s) => `\x1b[31m${s}\x1b[39m`,
  teal:   (s) => `\x1b[36m${s}\x1b[39m`,
  dim:    (s) => `\x1b[2m${s}\x1b[22m`,
  text:   (s) => s
};

// Assign colours to statuses
STATUS.COLLISION.color = C.amber;
STATUS.INVALID.color   = C.red;
STATUS.INTERNAL.color  = C.red;
STATUS.UNTAGGED.color  = C.dim;
STATUS.CONVENTION.color= C.green;
STATUS.FAIL.color      = C.red;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Bold text
function bold(text) {
  return `\x1b[1m${text}\x1b[22m`;
}

// Progress bar
function bar(i, total) {
  const width = 30;
  const filled = Math.round((i / total) * width);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

// Wrap text to width
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

// Clip text to n characters
function clip(text, n) {
  if (text.length <= n) return text;
  return text.slice(0, n - 3) + '...';
}

// Pad text to n characters
function pad(text, n) {
  const str = String(text);
  return str + ' '.repeat(Math.max(0, n - str.length));
}

// =============================================================================
// PARSE JSON with fallbacks
// =============================================================================

function parseJSON(text) {
  // Direct parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // fallback
  }

  // Fenced block fallback (```json ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (e) {
      // fallback
    }
  }

  // Brace-scan fallback: find the first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch (e) {
      // fallback
    }
  }

  throw new Error(`parseJSON: Could not parse text as JSON.\nReceived:\n${text.slice(0, 500)}`);
}

// =============================================================================
// ASK — model call via HTTPS
// =============================================================================

async function ask(P, { system, prompt, schema, search, maxTokens }) {
  // Determine provider
  let provider = null;
  let model = '';
  let apiKey = '';
  let apiUrl = '';
  let headers = {};

  if (process.env.ANTHROPIC_API_KEY) {
    provider = 'Anthropic';
    apiKey = process.env.ANTHROPIC_API_KEY;
    model = 'claude-3-5-sonnet-20241022';
    apiUrl = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };
  } else if (process.env.OPENAI_API_KEY) {
    provider = 'OpenAI';
    apiKey = process.env.OPENAI_API_KEY;
    model = 'gpt-4o-2024-08-06';
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
  } else if (process.env.GEMINI_API_KEY) {
    provider = 'Gemini';
    apiKey = process.env.GEMINI_API_KEY;
    model = 'gemini-1.5-pro';
    apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    headers = {
      'Content-Type': 'application/json'
    };
  } else {
    // No provider — return a placeholder JSON that parseJSON will understand
    // but we'll detect later
    return JSON.stringify({ convention: {}, renames: [] });
  }

  // Build the messages array
  let messages = [];
  if (system) {
    if (provider === 'Gemini') {
      messages.push({ role: 'user', parts: [{ text: system + '\n\n' + prompt }] });
    } else {
      messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });
    }
  } else {
    if (provider === 'Gemini') {
      messages.push({ role: 'user', parts: [{ text: prompt }] });
    } else {
      messages.push({ role: 'user', content: prompt });
    }
  }

  // Build request body
  let body = {};
  if (provider === 'Anthropic') {
    body = {
      model: model,
      max_tokens: maxTokens || 6000,
      messages: messages
    };
  } else if (provider === 'OpenAI') {
    body = {
      model: model,
      max_tokens: maxTokens || 6000,
      messages: messages,
      response_format: schema ? { type: 'json_object' } : undefined
    };
  } else if (provider === 'Gemini') {
    body = {
      contents: messages,
      generationConfig: {
        maxOutputTokens: maxTokens || 6000
      }
    };
  }

  // Make the request
  const https = require('https');
  const urlObj = new URL(apiUrl);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let text = '';
          if (provider === 'Anthropic') {
            text = parsed.content?.[0]?.text || '';
          } else if (provider === 'OpenAI') {
            text = parsed.choices?.[0]?.message?.content || '';
          } else if (provider === 'Gemini') {
            text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }
          resolve(text);
        } catch (e) {
          resolve(data); // return raw data if parsing fails
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

// =============================================================================
// MAP LIMIT
// =============================================================================

async function mapLimit(items, limit, fn) {
  const results = [];
  const executing = [];
  let index = 0;

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item, index++));
    results.push(p);
    if (limit > 0 && results.length >= limit) {
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
// LINE / ENDLINE / OUT
// =============================================================================

let lastLineLength = 0;

function line(text) {
  // Clear the current line
  if (lastLineLength > 0) {
    process.stdout.write('\r' + ' '.repeat(lastLineLength) + '\r');
  }
  process.stdout.write(text);
  lastLineLength = text.length;
}

function endline() {
  if (lastLineLength > 0) {
    process.stdout.write('\n');
    lastLineLength = 0;
  }
}

function out(text) {
  console.log(text);
}

// =============================================================================
// RENDER FINDINGS
// =============================================================================

function renderFindings(items) {
  for (const item of items) {
    const status = STATUS[item.status];
    const glyph = status ? status.glyph : '?';
    const color = status ? status.color : C.text;
    const label = status ? status.label : item.status;

    // Print status line
    out(`${color(glyph)} ${color(bold(label))}: ${color(item.headline)}`);

    // Print detail (indented)
    const detailLines = wrap(item.detail, 72).split('\n');
    for (const line of detailLines) {
      out(`  ${C.dim(line)}`);
    }

    // Print was/now if present
    if (item.was || item.now) {
      out(`  ${C.dim('Was:')} ${item.was || '(none)'}`);
      out(`  ${C.dim('Now:')} ${item.now || '(none)'}`);
    }

    // Print note if present
    if (item.note) {
      out(`  ${C.dim('→')} ${C.amber(item.note)}`);
    }

    // Print source if present
    if (item.source) {
      out(`  ${C.dim('Source:')} ${C.teal(clip(item.source, 70))}`);
    }

    out(''); // blank line between items
  }
}

// =============================================================================
// RENDER SUMMARY
// =============================================================================

function renderSummary(items, htmlPath) {
  out('');
  out(bold('Summary'));
  out('─'.repeat(40));

  // Count by status
  const counts = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }

  // Print counts
  for (const [key, status] of Object.entries(STATUS)) {
    const count = counts[key] || 0;
    if (count > 0) {
      out(`${status.glyph} ${status.label}: ${count}`);
    }
  }

  out('');
  const note = SUMMARY_NOTE(items);
  if (note) out(C.dim(note));

  if (htmlPath) {
    out(C.dim(`HTML report written to: ${htmlPath}`));
  }
}

// =============================================================================
// BUILD HTML
// =============================================================================

function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UTM Tracking Audit — ${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f9f9f9; color: #222; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
    .item { background: white; padding: 12px 16px; margin: 12px 0; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .headline { font-weight: 600; font-size: 1.1em; }
    .detail { margin: 8px 0; color: #555; }
    .meta { font-size: 0.9em; color: #777; }
    .meta span { margin-right: 16px; }
    .note { color: #b8860b; }
    .source { color: #0066cc; word-break: break-all; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.8em; font-weight: 600; margin-right: 8px; }
    .status-COLLISION { background: #ffecb3; color: #6d4c00; }
    .status-INVALID { background: #ffcdd2; color: #b71c1c; }
    .status-INTERNAL { background: #ffcdd2; color: #b71c1c; }
    .status-UNTAGGED { background: #e0e0e0; color: #555; }
    .status-CONVENTION { background: #c8e6c9; color: #1b5e20; }
    .status-FAIL { background: #ffcdd2; color: #b71c1c; }
    .summary { margin: 20px 0; padding: 12px; background: #e8f5e9; border-radius: 6px; }
    .no-key { background: #fff3e0; padding: 12px; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>UTM Tracking Audit</h1>
  <p><strong>Subject:</strong> ${subject}</p>
  ${body}
</body>
</html>`;
}

// =============================================================================
// DEMO DATA
// =============================================================================

const DEMO = [
  {
    status: 'COLLISION',
    headline: 'Source "facebook" appears in 3 variants',
    detail: 'The source parameter "facebook" is written as "Facebook", "facebook", and "FaceBook" across 147 sessions. This splits reporting into three rows in GA4, making it impossible to see total Facebook traffic at a glance.',
    was: 'Facebook (83 sessions), facebook (52 sessions), FaceBook (12 sessions)',
    now: 'facebook (standardised to lowercase)',
    note: 'Update all URLs to use "facebook" consistently. Use a URL builder or a rewrite rule to normalise the parameter.',
    source: 'https://example.com/page?utm_source=FaceBook&utm_medium=cpc'
  },
  {
    status: 'COLLISION',
    headline: 'Medium "cpc" vs "ppc" — same meaning, different rows',
    detail: 'Some campaign URLs use "cpc" (cost per click) while others use "ppc" (pay per click) for the same Google Ads campaign. This creates two separate medium rows in GA4, doubling the apparent number of campaigns.',
    was: 'cpc (234 sessions), ppc (89 sessions)',
    now: 'cpc (standardised)',
    note: 'Standardise on "cpc" as the medium for all paid search traffic. Update any URL templates that use "ppc".',
    source: 'https://example.com/landing?utm_source=google&utm_medium=ppc&utm_campaign=summer_sale'
  },
  {
    status: 'INVALID',
    headline: 'Medium "social" is non-standard — should be one of the GA4 recognised mediums',
    detail: 'The medium "social" is used for organic social posts. GA4 expects "social" to be a source, not a medium. The standard mediums are: cpc, organic, email, social-referral, referral, affiliate, display. Using a custom medium breaks the default channel grouping.',
    was: 'social',
    now: 'social-referral (recommended)',
    note: 'Change "social" to "social-referral" or "referral" for organic social traffic, or "cpc" for paid social.',
    source: 'https://example.com/blog?utm_source=linkedin&utm_medium=social&utm_campaign=thought-leadership'
  },
  {
    status: 'INTERNAL',
    headline: 'UTM tags on internal link to /about/team',
    detail: 'A link to the internal page /about/team carries utm_source=email&utm_medium=internal. This is the most expensive mistake: any UTM parameter on an internal link overwrites the original referral attribution, and GA4 will attribute the session to "email / internal" instead of the actual referrer.',
    was: 'Email / internal (attribution overwritten)',
    now: 'Remove all UTM parameters from internal links',
    note: 'Ensure no internal navigation link carries UTM tags. Remove them immediately to restore correct attribution.',
    source: 'https://example.com/about/team?utm_source=email&utm_medium=internal&utm_campaign=newsletter-2024-03'
  },
  {
    status: 'UNTAGGED',
    headline: '47 incoming links have no UTM parameters at all',
    detail: 'These 47 URLs from the import carry no utm_source, utm_medium, or any other UTM tag. They will appear as "direct / none" in GA4, making it impossible to attribute their traffic to any campaign or source.',
    was: '(no UTM parameters)',
    now: 'Add appropriate UTM parameters to each link',
    note: 'Review the source of these links and add the correct UTM tags. Without them, you lose attribution data for every click.',
    source: 'https://example.com/landing-page'
  },
  {
    status: 'CONVENTION',
    headline: 'Proposed naming convention for all UTM parameters',
    detail: 'Based on the analysis of 1,234 URLs, the following convention is recommended to ensure clean, consistent reporting. All sources should be lowercase with underscores for spaces (e.g., "google_ads"). Mediums should use the GA4 standard set. Campaigns should start with the year and quarter (e.g., "2024_q3_summer_sale").',
    was: 'Multiple inconsistent naming patterns',
    now: 'source: lowercase, underscore-separated\nmedium: one of cpc, organic, email, social-referral, referral, affiliate, display\ncampaign: YYYY_QQ_<descriptive_name>',
    note: 'Adopt this convention across all marketing teams and update URL templates in all tools. This will reduce collisions by 90%.',
    source: 'https://example.com/any-page?utm_source=google_ads&utm_medium=cpc&utm_campaign=2024_q3_launch'
  }
];

// =============================================================================
// RUN DEMO
// =============================================================================

async function runDemo(writeHTML) {
  line('Analysing demo data...');
  await new Promise(r => setTimeout(r, 500));
  line('Processing 6 demo items...');
  await new Promise(r => setTimeout(r, 300));
  endline();

  renderFindings(DEMO);

  let htmlPath = null;
  if (writeHTML) {
    htmlPath = './utm-tracking-auditor-demo.html';
    const fs = require('fs');
    const body = DEMO.map(item => {
      const statusClass = `status-${item.status}`;
      const statusLabel = STATUS[item.status]?.label || item.status;
      return `<div class="item">
        <div class="headline"><span class="status ${statusClass}">${statusLabel}</span> ${item.headline}</div>
        <div class="detail">${item.detail}</div>
        <div class="meta">
          ${item.was ? `<span><strong>Was:</strong> ${item.was}</span>` : ''}
          ${item.now ? `<span><strong>Now:</strong> ${item.now}</span>` : ''}
        </div>
        ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
        ${item.source ? `<div class="source">Source: ${item.source}</div>` : ''}
      </div>`;
    }).join('\n');
    const html = buildHTML({ subject: 'Demo Run (no API key needed)', body });
    fs.writeFileSync(htmlPath, html);
  }

  renderSummary(DEMO, htmlPath);
}

// =============================================================================
// RUN — main logic
// =============================================================================

async function run(input, sourceName) {
  const items = [];
  const lines = input.split('\n').filter(l => l.trim());
  const total = lines.length;

  line(`Processing ${total} lines...`);

  // Parse each line
  const parsed = [];
  let untaggedCount = 0;

  for (let i = 0; i < total; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    // Try to parse as URL
    let url;
    try {
      url = new URL(raw);
    } catch (e) {
      // Maybe it's a line with just source/medium? Try to parse as CSV-like
      // For now, treat as an untagged link
      untaggedCount++;
      continue;
    }

    const params = {};
    for (const [key, value] of url.searchParams) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_')) {
        params[lower] = value;
      }
    }

    // Check if it's an internal link with UTM tags
    const host = url.hostname;
    const isInternal = host === 'example.com' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.internal') || host === '';

    if (Object.keys(params).length === 0) {
      untaggedCount++;
      continue;
    }

    // Check for internal tagging
    if (isInternal && Object.keys(params).length > 0) {
      items.push({
        status: 'INTERNAL',
        headline: `UTM tags on internal link: ${url.pathname}`,
        detail: `The internal page ${url.pathname} carries UTM parameters (${Object.keys(params).join(', ')}). This overwrites the original referral attribution.`,
        was: Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', '),
        now: 'Remove all UTM parameters from internal links',
        note: 'Remove UTM tags from this internal link to restore correct attribution.',
        source: raw
      });
      continue;
    }

    // Extract UTM values
    const utm = {
      source: params['utm_source'] || '',
      medium: params['utm_medium'] || '',
      campaign: params['utm_campaign'] || '',
      content: params['utm_content'] || '',
      term: params['utm_term'] || ''
    };

    if (!utm.source && !utm.medium) {
      untaggedCount++;
      continue;
    }

    parsed.push({ url: raw, utm, host });
  }

  // Add untagged item
  if (untaggedCount > 0) {
    items.push({
      status: 'UNTAGGED',
      headline: `${untaggedCount} incoming link${untaggedCount !== 1 ? 's' : ''} have no UTM parameters`,
      detail: `These ${untaggedCount} URLs from the import carry no utm_source, utm_medium, or any other UTM tag. They will appear as "direct / none" in GA4.`,
      was: '(no UTM parameters)',
      now: 'Add appropriate UTM parameters to each link',
      note: 'Review the source of these links and add the correct UTM tags.',
      source: ''
    });
  }

  // Now find collisions
  const sourceGroups = {};
  const mediumGroups = {};
  const campaignGroups = {};

  for (const p of parsed) {
    if (!p.utm.source) continue;
    const normalised = p.utm.source.toLowerCase().replace(/[ _-]/g, '_');
    if (!sourceGroups[normalised]) sourceGroups[normalised] = [];
    sourceGroups[normalised].push(p.utm.source);
  }

  for (const [normalised, variants] of Object.entries(sourceGroups)) {
    const unique = [...new Set(variants)];
    if (unique.length > 1) {
      // Count sessions per variant
      const counts = {};
      for (const v of unique) {
        counts[v] = variants.filter(x => x === v).length;
      }
      const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      items.push({
        status: 'COLLISION',
        headline: `Source "${normalised}" appears in ${unique.length} variants`,
        detail: `The source parameter is written as ${unique.map(u => `"${u}"`).join(', ')} across ${variants.length} occurrences. This splits reporting.`,
        was: unique.map(u => `${u} (${counts[u]})`).join(', '),
        now: mostCommon.toLowerCase(),
        note: `Standardise on "${mostCommon.toLowerCase()}" for all URLs.`,
        source: parsed.find(p => p.utm.source === unique[0])?.url || ''
      });
    }
  }

  // Check mediums
  const standardMediums = ['cpc', 'organic', 'email', 'social', 'referral', 'affiliate', 'display'];
  for (const p of parsed) {
    if (p.utm.medium && !standardMediums.includes(p.utm.medium.toLowerCase())) {
      items.push({
        status: 'INVALID',
        headline: `Medium "${p.utm.medium}" is non-standard`,
        detail: `The medium "${p.utm.medium}" is not one of the GA4 standard mediums (${standardMediums.join(', ')}). This will break default channel grouping.`,
        was: p.utm.medium,
        now: 'One of: ' + standardMediums.join(', '),
        note: 'Change to a standard medium to ensure correct channel grouping.',
        source: p.url
      });
    }
  }

  // Check for missing campaign on paid links
  for (const p of parsed) {
    const medium = (p.utm.medium || '').toLowerCase();
    if ((medium === 'cpc' || medium === 'ppc') && !p.utm.campaign) {
      items.push({
        status: 'FAIL',
        headline: 'Paid link missing campaign parameter',
        detail: `A paid link (medium=${p.utm.medium}) has no utm_campaign. This makes it impossible to attribute the spend to a specific campaign.`,
        was: 'utm_campaign missing',
        now: 'Add a utm_campaign value',
        note: 'Every paid link must have a campaign parameter.',
        source: p.url
      });
    }
  }

  // Check for source duplicating medium
  for (const p of parsed) {
    if (p.utm.source && p.utm.medium && p.utm.source.toLowerCase() === p.utm.medium.toLowerCase()) {
      items.push({
        status: 'INVALID',
        headline: `Source "${p.utm.source}" duplicates the medium "${p.utm.medium}"`,
        detail: 'When the source and medium are the same value, GA4 cannot distinguish between the traffic source and the channel. This creates confusion in reporting.',
        was: `source=${p.utm.source}, medium=${p.utm.medium}`,
        now: 'Use distinct values for source and medium',
        note: 'The source should be the platform name, the medium should be the channel type.',
        source: p.url
      });
    }
  }

  // Check for campaign name differences by trailing character
  const campaignGroups2 = {};
  for (const p of parsed) {
    if (!p.utm.campaign) continue;
    const normalised = p.utm.campaign.toLowerCase().replace(/[ _-]/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!campaignGroups2[normalised]) campaignGroups2[normalised] = [];
    campaignGroups2[normalised].push(p.utm.campaign);
  }

  for (const [normalised, variants] of Object.entries(campaignGroups2)) {
    const unique = [...new Set(variants)];
    if (unique.length > 1) {
      // Only flag if they differ by a trailing character
      const base = normalised.replace(/[0-9_]+$/, '');
      const diffVariants = unique.filter(v => {
        const vNorm = v.toLowerCase().replace(/[ _-]/g, '_').replace(/[^a-z0-9_]/g, '');
        return vNorm !== normalised && vNorm.replace(/[0-9_]+$/, '') === base;
      });
      if (diffVariants.length > 0) {
        const counts = {};
        for (const v of diffVariants) {
          counts[v] = variants.filter(x => x === v).length;
        }
        items.push({
          status: 'COLLISION',
          headline: `Campaign "${normalised}" has ${diffVariants.length} variant${diffVariants.length !== 1 ? 's' : ''} differing only by trailing characters`,
          detail: `Campaign names ${diffVariants.map(v => `"${v}"`).join(', ')} are essentially the same but differ by a trailing character, splitting the campaign data.`,
          was: diffVariants.map(v => `${v} (${counts[v]})`).join(', '),
          now: normalised,
          note: 'Remove trailing characters or standardise the campaign naming convention.',
          source: parsed.find(p => diffVariants.includes(p.utm.campaign))?.url || ''
        });
      }
    }
  }

  // Attempt to get naming convention via ask()
  const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (hasApiKey) {
    try {
      // Collect distinct values
      const distinctSources = [...new Set(parsed.map(p => p.utm.source).filter(Boolean))];
      const distinctMediums = [...new Set(parsed.map(p => p.utm.medium).filter(Boolean))];
      const distinctCampaigns = [...new Set(parsed.map(p => p.utm.campaign).filter(Boolean))];

      const systemPrompt = 'You are a UTM tracking expert. Analyse the following distinct UTM parameter values and suggest a naming convention.';
      const userPrompt = `Distinct sources: ${distinctSources.join(', ')}\nDistinct mediums: ${distinctMediums.join(', ')}\nDistinct campaigns: ${distinctCampaigns.join(', ')}\n\nSuggest a convention with renames.`;

      const text = await ask({}, { system: systemPrompt, prompt: userPrompt, schema: true, maxTokens: 6000 });
      const data = parseJSON(text);

      if (data && data.convention) {
        items.push({
          status: 'CONVENTION',
          headline: 'Proposed naming convention from AI analysis',
          detail: `Based on the analysis, the following convention is recommended: ${JSON.stringify(data.convention, null, 2)}`,
          was: 'Multiple inconsistent naming patterns',
          now: JSON.stringify(data.convention),
          note: data.renames ? data.renames.slice(0, 3).map(r => `"${r.from}" → "${r.to}" (${r.why})`).join('; ') : '',
          source: ''
        });
      }
    } catch (e) {
      items.push({
        status: 'FAIL',
        headline: 'Failed to get naming convention from AI',
        detail: `Error: ${e.message}`,
        was: '',
        now: '',
        note: 'The AI analysis failed. Proceed with manual standardisation.',
        source: ''
      });
    }
  } else {
    items.push({
      status: 'CONVENTION',
      headline: 'No API key available — manual convention needed',
      detail: 'No naming convention was fetched from AI because no API key was found. The computed issues above still need to be addressed manually.',
      was: '',
      now: '',
      note: NO_SEARCH_NOTE,
      source: ''
    });
  }

  return items;
}

// =============================================================================
// ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    out(PITCH);
    out('');
    out(bold('Usage:'));
    out(`  node ${process.argv[1]} <file>`);
    out(`  node ${process.argv[1]} -`);
    out(`  node ${process.argv[1]} --demo`);
    out(`  node ${process.argv[1]} --help`);
    out('');
    out(bold('Arguments:'));
    for (const [arg, desc] of USAGE) {
      out(`  ${pad(arg, 12)} ${desc}`);
    }
    process.exit(0);
  }

  if (args.includes('--demo')) {
    await runDemo(false);
    // Also write HTML if desired
    const writeHTML = args.includes('--html');
    if (writeHTML) {
      await runDemo(true);
    }
    process.exit(0);
  }

  // Read input
  let input = '';
  let sourceName = 'stdin';

  if (args[0] && args[0] !== '-') {
    const fs = require('fs');
    const path = require('path');
    sourceName = args[0];
    try {
      input = fs.readFileSync(sourceName, 'utf-8');
    } catch (e) {
      out(`${C.red('Error:')} Could not read file: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Read from stdin
    const stdin = process.stdin;
    stdin.setEncoding('utf-8');
    for await (const chunk of stdin) {
      input += chunk;
    }
  }

  if (!input.trim()) {
    out(`${C.red('Error:')} No input provided.`);
    process.exit(1);
  }

  // Run
  const items = await run(input, sourceName);

  // Render
  renderFindings(items);

  // Write HTML report
  const htmlPath = `./utm-tracking-audit-${sourceName.replace(/[^a-zA-Z0-9]/g, '_')}.html`;
  const fs = require('fs');
  const body = items.map(item => {
    const statusClass = `status-${item.status}`;
    const statusLabel = STATUS[item.status]?.label || item.status;
    return `<div class="item">
      <div class="headline"><span class="status ${statusClass}">${statusLabel}</span> ${item.headline}</div>
      <div class="detail">${item.detail}</div>
      <div class="meta">
        ${item.was ? `<span><strong>Was:</strong> ${item.was}</span>` : ''}
        ${item.now ? `<span><strong>Now:</strong> ${item.now}</span>` : ''}
      </div>
      ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
      ${item.source ? `<div class="source">Source: ${item.source}</div>` : ''}
    </div>`;
  }).join('\n');
  const html = buildHTML({ subject: sourceName, body });
  fs.writeFileSync(htmlPath, html);

  renderSummary(items, htmlPath);
}

// Run the main function
main().catch(e => {
  out(`${C.red('Fatal error:')} ${e.message}`);
  process.exit(1);
});
