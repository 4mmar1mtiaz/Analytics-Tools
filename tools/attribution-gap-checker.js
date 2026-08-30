#!/usr/bin/env node

// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/4mmar1mtiaz

// ============================================================================
// CONSTANTS AND STATUS OBJECTS
// ============================================================================

const PITCH = "Compare conversions from ad platforms and analytics to find attribution gaps and diagnose their causes.";
const USAGE = [
  ['<input>', 'read from file or stdin (key=value pairs)'],
  ['-', 'read stdin'],
  ['--demo', 'see the output, spend nothing'],
  ['--help', 'show this usage']
];

const STATUS = {
  NORMAL: { glyph: '=', color: null, label: 'Normal' },
  EXPECTED: { glyph: '~', color: null, label: 'Expected' },
  SUSPECT: { glyph: '?', color: null, label: 'Suspect' },
  BROKEN: { glyph: '!', color: null, label: 'Broken' },
  CHECK: { glyph: '>', color: null, label: 'Check' },
  TRUST: { glyph: '*', color: null, label: 'Trust' },
  FAIL: { glyph: 'x', color: null, label: 'Fail' }
};

const ITEM_NOUN = "finding";
const NOTE_LABEL = "Note";
const NO_SEARCH_NOTE = "No API keys found — live analysis skipped, but all numbers are computed locally.";
const SUMMARY_NOTE = (items) => {
  const broken = items.filter(i => i.status === 'BROKEN').length;
  const suspect = items.filter(i => i.status === 'SUSPECT').length;
  if (broken) return `${broken} broken, ${suspect} suspect — check tracking setup`;
  if (suspect) return `${suspect} suspect — review attribution windows`;
  return 'All gaps within normal ranges';
};

// ============================================================================
// COLOUR FUNCTIONS (C)
// ============================================================================

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  teal: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  text: (s) => s
};

// Apply colours to STATUS labels
STATUS.NORMAL.color = C.green;
STATUS.EXPECTED.color = C.teal;
STATUS.SUSPECT.color = C.amber;
STATUS.BROKEN.color = C.red;
STATUS.CHECK.color = C.teal;
STATUS.TRUST.color = C.green;
STATUS.FAIL.color = C.red;

// ============================================================================
// HELPER: text formatting
// ============================================================================

function bold(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

function bar(i, total) {
  const width = 20;
  const filled = Math.round((i / total) * width);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

function wrap(text, width) {
  if (width <= 0) return text;
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      lines.push(current.trim());
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join('\n');
}

function clip(text, n) {
  if (text.length <= n) return text;
  return text.substring(0, n - 3) + '...';
}

function pad(text, n) {
  const str = String(text);
  if (str.length >= n) return str;
  return str + ' '.repeat(n - str.length);
}

// ============================================================================
// HELPER: line output
// ============================================================================

let currentLineLength = 0;

function line(text) {
  // Clear previous line
  if (currentLineLength > 0) {
    process.stdout.write('\x1b[2K\r');
  }
  process.stdout.write(text);
  currentLineLength = text.length;
}

function endline() {
  if (currentLineLength > 0) {
    process.stdout.write('\n');
    currentLineLength = 0;
  }
}

function out(text) {
  console.log(text);
}

// ============================================================================
// HELPER: parseJSON with fallbacks
// ============================================================================

function parseJSON(text) {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // fallback not needed for direct
  }

  // Try fenced block: ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (e) {
      // continue
    }
  }

  // Brace scan: find first { and last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.substring(start, end + 1));
    } catch (e) {
      // continue
    }
  }

  throw new Error('Cannot parse JSON from text: ' + text.substring(0, 100));
}

// ============================================================================
// HELPER: ask() — make API call
// ============================================================================

function getProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { name: 'anthropic', key: process.env.ANTHROPIC_API_KEY };
  if (process.env.OPENAI_API_KEY) return { name: 'openai', key: process.env.OPENAI_API_KEY };
  if (process.env.GEMINI_API_KEY) return { name: 'gemini', key: process.env.GEMINI_API_KEY };
  return null;
}

async function ask(P, { system, prompt, schema, search, maxTokens }) {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
  }

  // Build the request based on provider
  let url, headers, body;

  if (provider.name === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': provider.key,
      'anthropic-version': '2023-06-01'
    };
    body = JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: maxTokens || 6000,
      system: system,
      messages: [
        { role: 'user', content: prompt }
      ]
    });
  } else if (provider.name === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.key}`
    };
    body = JSON.stringify({
      model: 'gpt-4',
      max_tokens: maxTokens || 6000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    });
  } else if (provider.name === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${provider.key}`;
    headers = {
      'Content-Type': 'application/json'
    };
    body = JSON.stringify({
      contents: [
        {
          parts: [
            { text: system + '\n\n' + prompt }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens || 6000
      }
    });
  }

  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let text = '';
          if (provider.name === 'anthropic') {
            text = parsed.content[0].text;
          } else if (provider.name === 'openai') {
            text = parsed.choices[0].message.content;
          } else if (provider.name === 'gemini') {
            text = parsed.candidates[0].content.parts[0].text;
          }
          resolve(text);
        } catch (e) {
          reject(new Error(`API error: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============================================================================
// HELPER: mapLimit
// ============================================================================

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

// ============================================================================
// DEMO DATA
// ============================================================================

const DEMO = [
  {
    status: 'NORMAL',
    headline: 'Google Ads vs GA4 — Search brand campaign',
    was: '1,247',
    now: '1,152',
    detail: 'Platform reports 1,247 conversions, analytics attributes 1,152. The 95-conversion gap (7.6%) falls within the normal range for last-click vs. position-based attribution models. Both CPAs are close: $32.07 vs $34.72 for the same $40,000 spend.',
    note: 'No action needed — monitor monthly trend.',
    source: ''
  },
  {
    status: 'EXPECTED',
    headline: 'Meta Ads vs GA4 — Retargeting campaign',
    was: '892',
    now: '634',
    detail: 'Platform reports 892 conversions, analytics attributes 634. The 258-conversion gap (28.9%) is expected for view-through attribution. Meta counts 1-day view-through conversions that GA4 (last-click) does not. CPA: $22.42 (platform) vs $31.55 (analytics).',
    note: 'Standard view-through discrepancy — budget Meta on platform numbers.',
    source: ''
  },
  {
    status: 'SUSPECT',
    headline: 'LinkedIn Ads vs GA4 — Lead gen campaign',
    was: '156',
    now: '89',
    detail: 'Platform reports 156 conversions, analytics attributes 89. The 67-conversion gap (42.9%) exceeds typical model differences. Likely cause: LinkedIn Insight Tag loading issues or consent-mode blocking. CPA: $96.15 (platform) vs $168.54 (analytics).',
    note: 'Check Insight Tag firing with LinkedIn Partner API.',
    source: ''
  },
  {
    status: 'BROKEN',
    headline: 'TikTok Ads vs GA4 — App install campaign',
    was: '3,401',
    now: '412',
    detail: 'Platform reports 3,401 conversions, analytics attributes 412. The 2,989-conversion gap (87.9%) indicates one system is wrong. TikTok counts installs via SKAdNetwork postbacks; GA4 relies on Google Play Referrer. These fundamentally different measurement methods produce irreconcilable numbers.',
    note: 'Trust TikTok for campaign optimisation, GA4 for UA comparison.',
    source: ''
  },
  {
    status: 'CHECK',
    headline: 'Verify UTM parameters on all paid social links',
    was: '',
    now: '',
    detail: 'A common cause of attribution gaps is missing or malformed UTM parameters on ad destination URLs. Use the UTM builder to ensure all campaigns have consistent utm_source, utm_medium, and utm_campaign values.',
    note: 'Run URL audit weekly — automate with your tag manager.',
    source: 'https://ga-dev-tools.google/campaign-url-builder/'
  },
  {
    status: 'TRUST',
    headline: 'Recommendation: Use platform numbers for budget allocation',
    was: '',
    now: '',
    detail: 'For paid media optimisation, trust the platform-reported conversions since they capture view-through and cross-device journeys that analytics last-click models miss. Use analytics data for channel comparison and attribution modelling.',
    note: 'Recalibrate every quarter with a holdout test.',
    source: ''
  }
];

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function renderFindings(items) {
  endline();
  out(bold('Findings:'));
  out('');

  for (const item of items) {
    const status = STATUS[item.status];
    let colorFn = status.color || C.text;
    let glyph = status.glyph || ' ';
    const label = pad(status.label, 10);
    const line = `${glyph} ${colorFn(label)} ${item.headline}`;
    out(line);

    if (item.was || item.now) {
      out(`   ${C.dim('was:')} ${item.was ? C.text(item.was) : '-'}  ${C.dim('now:')} ${item.now ? C.text(item.now) : '-'}`);
    }

    out(`   ${wrap(item.detail, 76)}`);

    if (item.note) {
      out(`   ${C.dim('→')} ${item.note}`);
    }

    if (item.source) {
      out(`   ${C.dim('source:')} ${item.source}`);
    }

    out('');
  }
}

function renderSummary(items, htmlPath) {
  const total = items.length;
  const groups = {};
  for (const item of items) {
    if (!groups[item.status]) groups[item.status] = 0;
    groups[item.status]++;
  }

  out(bold('Summary:'));
  out('');
  for (const [key, count] of Object.entries(groups)) {
    const status = STATUS[key];
    if (status) {
      out(`  ${status.glyph} ${status.color ? status.color(pad(status.label, 10)) : pad(status.label, 10)}: ${count}`);
    }
  }
  out('');
  out(`Total: ${total} ${ITEM_NOUN}${total !== 1 ? 's' : ''}`);

  const note = SUMMARY_NOTE(items);
  if (note) {
    out('');
    out(C.dim(note));
  }

  if (htmlPath) {
    out('');
    out(C.green(`HTML report written to: ${htmlPath}`));
  }
}

function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Attribution Gap Checker — ${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #333; }
    h1 { color: #1a1a2e; border-bottom: 3px solid #16213e; padding-bottom: 0.5rem; }
    h2 { color: #0f3460; margin-top: 2rem; }
    .item { background: #f8f9fa; border-left: 4px solid #dee2e6; padding: 1rem; margin: 1rem 0; border-radius: 0 4px 4px 0; }
    .item.NORMAL { border-left-color: #28a745; }
    .item.EXPECTED { border-left-color: #17a2b8; }
    .item.SUSPECT { border-left-color: #ffc107; }
    .item.BROKEN { border-left-color: #dc3545; }
    .item.CHECK { border-left-color: #17a2b8; }
    .item.TRUST { border-left-color: #28a745; }
    .item.FAIL { border-left-color: #dc3545; }
    .headline { font-size: 1.1rem; font-weight: 600; color: #1a1a2e; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem; }
    .status.NORMAL { background: #d4edda; color: #155724; }
    .status.EXPECTED { background: #d1ecf1; color: #0c5460; }
    .status.SUSPECT { background: #fff3cd; color: #856404; }
    .status.BROKEN { background: #f8d7da; color: #721c24; }
    .status.CHECK { background: #d1ecf1; color: #0c5460; }
    .status.TRUST { background: #d4edda; color: #155724; }
    .status.FAIL { background: #f8d7da; color: #721c24; }
    .values { color: #6c757d; font-size: 0.9rem; margin: 0.5rem 0; }
    .detail { margin: 0.5rem 0; line-height: 1.5; }
    .note { color: #6c757d; font-style: italic; margin: 0.5rem 0; }
    .source { color: #007bff; font-size: 0.85rem; }
    .summary { background: #e9ecef; padding: 1rem; border-radius: 4px; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Attribution Gap Checker</h1>
  <p><strong>Subject:</strong> ${subject}</p>
  ${body}
</body>
</html>`;
}

// ============================================================================
// RUN FUNCTION
// ============================================================================

function parseInput(input, sourceName) {
  // Try JSON first
  try {
    const data = JSON.parse(input);
    return data;
  } catch (e) {
    // Not JSON, try key=value lines
  }

  const lines = input.split('\n').filter(l => l.trim());
  const data = {};
  for (const line of lines) {
    const match = line.match(/^(\w[\w_]*)\s*=\s*(\d+)$/);
    if (match) {
      data[match[1]] = parseInt(match[2], 10);
    }
  }
  return data;
}

function classifyGap(pct) {
  if (pct < 10) return { status: 'NORMAL', cause: 'Normal model difference between attribution systems' };
  if (pct < 30) return { status: 'EXPECTED', cause: 'View-through and cross-device attribution splits' };
  if (pct < 60) return { status: 'SUSPECT', cause: 'Possible tracking fault — check implementation' };
  return { status: 'BROKEN', cause: 'One number is wrong — need to check which system is accurate' };
}

function nameCauses(pct, platformConv, analyticsConv, spend) {
  const causes = [];
  if (pct > 10 && pct < 30) {
    causes.push('Platform click-and-view windows vs last-click analytics model');
    causes.push('iOS view-through attribution limitations');
  }
  if (pct >= 30) {
    causes.push('Consent-mode denial affecting analytics tracking');
    causes.push('Missing UTMs on paid links');
    causes.push('Redirect chains stripping tracking parameters');
    causes.push('Deduplication failure between pixel and server-side events');
  }
  if (pct > 60) {
    causes.push('Cross-device journeys counted multiple times by platform');
  }
  return causes;
}

async function run(P, input, sourceName) {
  const items = [];
  const data = parseInput(input, sourceName);

  // Extract channel data
  let channels = [];
  if (data.ga4_conversions && data.meta_reported) {
    channels.push({
      name: 'Meta Ads',
      platform: data.meta_reported,
      analytics: data.ga4_conversions,
      spend: data.spend || 0
    });
  }

  // If we have other channel data, add it
  if (data.linkedin_reported) {
    channels.push({
      name: 'LinkedIn Ads',
      platform: data.linkedin_reported,
      analytics: data.ga4_adwords || 0,
      spend: data.linkedin_spend || 0
    });
  }

  if (channels.length === 0) {
    // Generic processing
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i += 2) {
      if (i + 1 < keys.length) {
        channels.push({
          name: keys[i].replace(/_reported|_conversions/g, '').replace(/_/g, ' ').toUpperCase(),
          platform: data[keys[i]],
          analytics: data[keys[i + 1]],
          spend: 0
        });
      }
    }
  }

  // Process each channel
  for (const channel of channels) {
    const gap = Math.abs(channel.platform - channel.analytics);
    const pct = channel.platform > 0 ? (gap / channel.platform) * 100 : 0;
    const classification = classifyGap(pct);
    const causes = nameCauses(pct, channel.platform, channel.analytics, channel.spend);

    const platformCPA = channel.spend > 0 && channel.platform > 0
      ? (channel.spend / channel.platform).toFixed(2)
      : 'N/A';
    const analyticsCPA = channel.spend > 0 && channel.analytics > 0
      ? (channel.spend / channel.analytics).toFixed(2)
      : 'N/A';

    items.push({
      status: classification.status,
      headline: `${channel.name} — ${classification.cause}`,
      was: String(channel.platform),
      now: String(channel.analytics),
      detail: `Platform reports ${channel.platform} conversions, analytics ${channel.analytics}. Gap: ${gap} (${pct.toFixed(1)}%). Platform CPA: $${platformCPA}, analytics CPA: $${analyticsCPA}. ${causes.length > 0 ? 'Possible causes: ' + causes.join('; ') : ''}`,
      note: classification.status === 'BROKEN' ? 'Verify which system is accurate — run a tracking audit' : 'Monitor regularly',
      source: ''
    });
  }

  // Add CHECK items
  items.push({
    status: 'CHECK',
    headline: 'Verify UTM parameters on all ad links',
    was: '',
    now: '',
    detail: 'Ensure all ad destination URLs have proper utm_source, utm_medium, and utm_campaign values. Malformed UTMs are the #1 cause of attribution gaps.',
    note: 'Use the Campaign URL Builder from Google Analytics.',
    source: 'https://ga-dev-tools.google/campaign-url-builder/'
  });

  items.push({
    status: 'CHECK',
    headline: 'Check consent mode implementation',
    was: '',
    now: '',
    detail: 'If using Google Consent Mode, verify that analytics tags are firing correctly for consented users. Consent mode denial can reduce tracked conversions by 30-60%.',
    note: 'Test with consent mode debugger in Google Tag Manager.',
    source: ''
  });

  // Add TRUST item
  items.push({
    status: 'TRUST',
    headline: 'Trust platform numbers for budget decisions',
    was: '',
    now: '',
    detail: 'Platform-reported conversions are generally more accurate for campaign optimisation as they capture all attribution windows. Use analytics for channel comparison and model validation.',
    note: 'Run quarterly holdout tests to validate platform attribution.',
    source: ''
  });

  // If no API key, add note
  const provider = getProvider();
  if (!provider) {
    items.unshift({
      status: 'FAIL',
      headline: NO_SEARCH_NOTE,
      was: '',
      now: '',
      detail: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for AI-powered diagnosis. All numeric analysis is complete.',
      note: 'AI diagnosis skipped — manual review recommended.',
      source: ''
    });
  } else {
    // Single API call for AI diagnosis
    try {
      const gapTable = items
        .filter(i => i.was && i.now)
        .map(i => `${i.headline}: ${i.was} vs ${i.now}`)
        .join('\n');

      const system = 'You are an attribution analyst. Given the gap data, provide a structured diagnosis.';
      const prompt = `Analyse these attribution gaps and provide diagnosis:\n\n${gapTable}\n\nRespond with JSON: { verdict: string, causes: [{ cause: string, likelihood: "likely"|"possible"|"unlikely", how_to_confirm: string, fix: string }] }`;

      const response = await ask(P, {
        system,
        prompt,
        maxTokens: 6000
      });

      const diagnosis = parseJSON(response);

      items.push({
        status: 'CHECK',
        headline: 'AI Diagnosis: ' + (diagnosis.verdict || 'see details'),
        was: '',
        now: '',
        detail: diagnosis.causes
          ? diagnosis.causes.map(c => `${c.cause} (${c.likelihood}): ${c.how_to_confirm} → ${c.fix}`).join('; ')
          : 'No specific causes identified',
        note: 'AI-powered analysis — verify with manual checks.',
        source: ''
      });
    } catch (e) {
      items.push({
        status: 'FAIL',
        headline: 'AI diagnosis failed',
        was: '',
        now: '',
        detail: `Error: ${e.message}. Manual diagnosis recommended.`,
        note: 'Check API key or network connection.',
        source: ''
      });
    }
  }

  return items;
}

async function runDemo(writeHTML) {
  const items = DEMO;
  endline();

  // Simulate progress
  line('Analysing channels...');
  await new Promise(r => setTimeout(r, 200));
  endline();

  line('Processing Google Ads data...');
  await new Promise(r => setTimeout(r, 150));
  endline();

  line('Processing Meta Ads data...');
  await new Promise(r => setTimeout(r, 150));
  endline();

  line('Processing LinkedIn Ads data...');
  await new Promise(r => setTimeout(r, 150));
  endline();

  line('Processing TikTok Ads data...');
  await new Promise(r => setTimeout(r, 150));
  endline();

  line('Generating recommendations...');
  await new Promise(r => setTimeout(r, 200));
  endline();

  renderFindings(items);

  if (writeHTML) {
    const htmlBody = items.map(item => {
      const status = STATUS[item.status];
      return `<div class="item ${item.status}">
        <div class="status ${item.status}">${status.glyph} ${status.label}</div>
        <div class="headline">${item.headline}</div>
        <div class="values">${item.was ? `Was: ${item.was}` : ''} ${item.now ? `| Now: ${item.now}` : ''}</div>
        <div class="detail">${item.detail}</div>
        ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
        ${item.source ? `<div class="source">Source: ${item.source}</div>` : ''}
      </div>`;
    }).join('\n');

    const html = buildHTML({
      subject: 'Demo Report — Attribution Gap Checker',
      body: htmlBody + `<div class="summary">${SUMMARY_NOTE(items)}</div>`
    });

    const fs = require('fs');
    const path = './attribution-gap-checker-demo.html';
    fs.writeFileSync(path, html);
    renderSummary(items, path);
  } else {
    renderSummary(items, null);
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    out(bold(PITCH));
    out('');
    out('Usage:');
    for (const [arg, desc] of USAGE) {
      out(`  ${pad(arg, 12)} ${desc}`);
    }
    out('');
    out('Environment:');
    out('  ANTHROPIC_API_KEY     Use Anthropic Claude');
    out('  OPENAI_API_KEY        Use OpenAI GPT-4');
    out('  GEMINI_API_KEY        Use Google Gemini');
    out('');
    out('Input format:');
    out('  key=value pairs, one per line');
    out('  JSON object');
    return;
  }

  if (args.includes('--demo')) {
    const writeHTML = true;
    await runDemo(writeHTML);
    return;
  }

  // Read input
  let input, sourceName;

  if (args.length === 0 || args[0] === '-') {
    // Read from stdin
    const fs = require('fs');
    input = fs.readFileSync('/dev/stdin', 'utf-8');
    sourceName = 'stdin';
  } else {
    const fs = require('fs');
    const filePath = args[0];
    try {
      input = fs.readFileSync(filePath, 'utf-8');
      sourceName = filePath;
    } catch (e) {
      // Try as raw input string
      input = args.join(' ');
      sourceName = 'command line';
    }
  }

  try {
    const P = 'Attribution Gap Checker';
    const items = await run(P, input, sourceName);
    renderFindings(items);
    renderSummary(items, null);
  } catch (e) {
    out(C.red(`Error: ${e.message}`));
    process.exit(1);
  }
}

main().catch(e => {
  out(C.red(`Fatal error: ${e.message}`));
  process.exit(1);
});
