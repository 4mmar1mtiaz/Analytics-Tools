#!/usr/bin/env node

// ============================================================================
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz
// ============================================================================

// ============================================================================
// ANSI colour functions
// ============================================================================
const C = {
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  amber: (s) => `\x1b[33m${s}\x1b[39m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  teal: (s) => `\x1b[36m${s}\x1b[39m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  text: (s) => s,
};

// ============================================================================
// Text helpers
// ============================================================================
function bold(text) {
  return `\x1b[1m${text}\x1b[22m`;
}

function bar(i, total) {
  const width = 20;
  const filled = Math.round((i / total) * width);
  const empty = width - filled;
  return `[${'#'.repeat(filled)}${'.'.repeat(empty)}]`;
}

function wrap(text, width) {
  if (!text || text.length === 0) return '';
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      lines.push(current.trim());
      current = word;
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join('\n');
}

function clip(text, n) {
  if (!text || text.length <= n) return text || '';
  return text.slice(0, n - 3) + '...';
}

function pad(text, n) {
  const s = String(text);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ============================================================================
// Progress line helpers
// ============================================================================
let lastLineLength = 0;

function line(text) {
  const clear = ' '.repeat(lastLineLength);
  process.stdout.write(`\r${clear}\r`);
  process.stdout.write(text);
  lastLineLength = text.length;
}

function endline() {
  process.stdout.write('\n');
  lastLineLength = 0;
}

// ============================================================================
// Output helper
// ============================================================================
function out(text) {
  console.log(text);
}

// ============================================================================
// JSON parsing with fallbacks
// ============================================================================
function parseJSON(text) {
  if (!text || typeof text !== 'string') throw new Error('parseJSON: input must be a non-empty string');

  // Try direct parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // try fenced block
  }

  // Try fenced block: ```json ... ``` or ``` ...
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch (e) {
      // try brace scan
    }
  }

  // Try brace scan: find first { and last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      // give up
    }
  }

  throw new Error('parseJSON: could not parse JSON from text');
}

// ============================================================================
// mapLimit - concurrent map with limit
// ============================================================================
async function mapLimit(items, limit, fn) {
  const results = [];
  const executing = new Set();

  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i));
    results.push(p);
    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// ============================================================================
// ask - single model call via HTTPS
// ============================================================================
async function ask(params) {
  const { system, prompt, schema, search, maxTokens } = params;

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' :
                   process.env.OPENAI_API_KEY ? 'openai' :
                   process.env.GEMINI_API_KEY ? 'gemini' : null;

  if (!provider) {
    throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
  }

  const https = require('https');

  let body, url, headers;

  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens || 8000,
      system: system,
      messages: [{ role: 'user', content: prompt }],
    });
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    body = JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens || 8000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: system + '\n\n' + prompt }] },
      ],
      generationConfig: { maxOutputTokens: maxTokens || 8000 },
    });
  }

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let text = '';
          if (provider === 'anthropic') {
            text = parsed.content?.[0]?.text || '';
          } else if (provider === 'openai') {
            text = parsed.choices?.[0]?.message?.content || '';
          } else if (provider === 'gemini') {
            text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }
          if (!text) {
            reject(new Error(`API returned empty response: ${data.slice(0, 200)}`));
          } else {
            resolve(text);
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

// ============================================================================
// HTML builder
// ============================================================================
function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; line-height: 1.6; color: #1a1a1a; }
  h1 { color: #2d3748; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5em; }
  h2 { color: #4a5568; margin-top: 1.5em; }
  .item { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1em; margin: 0.75em 0; }
  .item.PASS { border-left: 4px solid #48bb78; }
  .item.WEAK { border-left: 4px solid #ecc94b; }
  .item.FAIL, .item.FAIL_CAT { border-left: 4px solid #f56565; }
  .item.SCORE { border-left: 4px solid #4299e1; }
  .item.CHECKLIST { border-left: 4px solid #9f7aea; }
  .status { font-weight: bold; font-size: 0.9em; text-transform: uppercase; }
  .headline { font-size: 1.1em; font-weight: 600; margin: 0.25em 0; }
  .detail { color: #4a5568; margin: 0.25em 0; }
  .note { color: #718096; font-size: 0.9em; margin: 0.25em 0; }
  .note:before { content: "→ "; }
  .source { color: #a0aec0; font-size: 0.85em; margin: 0.25em 0; }
  .score { background: #ebf8ff; border: 1px solid #bee3f8; border-radius: 8px; padding: 1em; text-align: center; margin: 1em 0; }
  .score .number { font-size: 3em; font-weight: bold; color: #2b6cb0; }
  .score .grade { font-size: 1.5em; color: #4a5568; }
  .meta { color: #718096; font-size: 0.85em; margin-top: 2em; border-top: 1px solid #e2e8f0; padding-top: 1em; }
</style>
</head>
<body>
<h1>${subject}</h1>
${body}
</body>
</html>`;
}

// ============================================================================
// Constants
// ============================================================================
const PITCH = 'Audits a landing page for conversion optimization across eight categories, scoring each from 0-100.';
const USAGE = [
  ['<url>', 'audit a page by URL'],
  ['<file>', 'audit a local HTML file'],
  ['-', 'read HTML from stdin'],
  ['--demo', 'show demo output (no API key needed)'],
  ['--help', 'show this help message'],
];
const STATUS = {
  PASS: { glyph: '+', color: C.green, label: 'PASS' },
  WEAK: { glyph: '~', color: C.amber, label: 'WEAK' },
  FAIL_CAT: { glyph: '-', color: C.red, label: 'FAIL' },
  SCORE: { glyph: '#', color: C.teal, label: 'SCORE' },
  CHECKLIST: { glyph: '!', color: C.amber, label: 'CHECK' },
  FAIL: { glyph: 'x', color: C.red, label: 'ERROR' },
};
const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'Impact';
const NO_SEARCH_NOTE = 'No LLM provider was configured, so subjective judgments (value proposition specificity, proof credibility, objection handling) are missing from the analysis.';
const SUMMARY_NOTE = (items) => {
  const passCount = items.filter(i => i.status === 'PASS').length;
  const weakCount = items.filter(i => i.status === 'WEAK').length;
  const failCount = items.filter(i => i.status === 'FAIL_CAT').length;
  return `${passCount} passed, ${weakCount} weak, ${failCount} failing`;
};

// ============================================================================
// Thresholds
// ============================================================================
const THRESHOLDS = {
  headline: { pass: 80, weak: 50 },
  valueProposition: { pass: 80, weak: 50 },
  socialProof: { pass: 80, weak: 50 },
  callsToAction: { pass: 80, weak: 50 },
  objectionHandling: { pass: 80, weak: 50 },
  riskReversal: { pass: 80, weak: 50 },
  urgency: { pass: 80, weak: 50 },
  structure: { pass: 80, weak: 50 },
};

// ============================================================================
// Demo data
// ============================================================================
const DEMO = [
  {
    status: 'PASS',
    headline: 'Headline: Clear and above the fold',
    was: '',
    now: '92/100',
    detail: 'The headline "Transform Your Workflow in 30 Days" is visible immediately without scrolling, uses benefit-driven language, and includes a specific time frame. It is supported by a sub-headline that reinforces the value proposition.',
    note: 'Strong first impression that captures attention and communicates value.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'WEAK',
    headline: 'Value Proposition: Present but generic',
    was: '',
    now: '65/100',
    detail: 'The page states "We help businesses grow" but lacks specificity about how, for whom, or by how much. No concrete metrics, target audience definition, or unique differentiator is mentioned in the first 400 words.',
    note: 'Visitors may not understand why this is better than alternatives.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'FAIL_CAT',
    headline: 'Social Proof: Insufficient credible evidence',
    was: '',
    now: '35/100',
    detail: 'Only one generic testimonial exists ("Great product!"), with no full name, photo, company, or verifiable details. No case studies, logos, review counts, or third-party endorsements are present. The single testimonial appears to be fabricated.',
    note: 'Without credible social proof, trust is low and conversion rates suffer.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'PASS',
    headline: 'Calls to Action: Well-placed and action-oriented',
    was: '',
    now: '88/100',
    detail: 'Three primary CTAs exist: "Start Free Trial" in the hero, "Get Started" in the feature section, and "Claim Your Discount" near the footer. All use imperative verbs, are visually distinct buttons, and appear above the fold and at natural decision points.',
    note: 'Multiple clear paths to conversion increase the likelihood of action.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'FAIL_CAT',
    headline: 'Objection Handling: Common objections not addressed',
    was: '',
    now: '25/100',
    detail: 'No FAQ section, no comparison chart, no mention of pricing concerns, integration compatibility, or learning curve. Visitors who worry about cost, time investment, or technical complexity have no answers on the page and will likely leave.',
    note: 'Unaddressed objections are the #1 reason for abandoned conversions.',
    source: 'https://example.com/landing-page',
  },
  {
    status: 'WEAK',
    headline: 'Risk Reversal: Partial coverage',
    was: '',
    now: '55/100',
    detail: 'A 30-day money-back guarantee is mentioned in the footer, but it is not prominently displayed near the CTA or in the main content area. No free trial period length is stated, no satisfaction guarantee, and no mention of customer support availability.',
    note: 'Risk reversal must be visible at the moment of decision, not hidden in the footer.',
    source: 'https://example.com/landing-page',
  },
];

// ============================================================================
// Deterministic checks
// ============================================================================
function checkHeadline(text) {
  let score = 0;
  const lines = text.split('\n').filter(l => l.trim());
  const firstH1 = text.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const firstH2 = text.match(/<h2[^>]*>([^<]+)<\/h2>/i);
  const firstBold = text.match(/<(?:strong|b)[^>]*>([^<]+)<\/(?:strong|b)>/i);
  const firstBig = text.match(/<[^>]*style=["'][^"']*font-size:\s*(?:2[4-9]|[3-9]\d)/i);

  if (firstH1) score += 30;
  if (firstH2) score += 20;
  if (firstBold) score += 15;
  if (firstBig) score += 15;

  // Check if headline is above the fold (first 500 chars)
  const first500 = text.slice(0, 500);
  if (firstH1 && first500.includes(firstH1[1])) score += 20;

  // Check for benefit words
  const benefitWords = ['transform', 'improve', 'increase', 'save', 'grow', 'boost', 'accelerate', 'streamline', 'optimize', 'better'];
  const headlineText = (firstH1?.[1] || firstH2?.[1] || '').toLowerCase();
  if (benefitWords.some(w => headlineText.includes(w))) score += 20;

  return Math.min(100, score);
}

function checkCTA(text) {
  let score = 0;
  const ctaPatterns = [
    /(?:start|get|try|claim|begin|download|sign\s*up|register|buy|order|shop|subscribe|join)\s+(?:now|today|free|your|my|the|a|an)/gi,
    /(?:free|trial|demo|consultation|quote|estimate)/gi,
    /<button[^>]*>/gi,
    /<a[^>]*class=["'][^"']*(?:btn|button|cta|action|primary|cta-button)[^"']*["'][^>]*>/gi,
  ];

  let matchCount = 0;
  for (const pattern of ctaPatterns) {
    const matches = text.match(pattern);
    if (matches) matchCount += matches.length;
  }

  score += Math.min(30, matchCount * 5);

  // Check for CTAs above the fold
  const first500 = text.slice(0, 500);
  if (ctaPatterns.some(p => p.test(first500))) score += 25;

  // Check for multiple CTAs
  if (matchCount >= 3) score += 25;
  else if (matchCount >= 2) score += 15;
  else if (matchCount >= 1) score += 5;

  // Check for action verbs
  const actionVerbs = ['start', 'get', 'try', 'claim', 'begin', 'download', 'join', 'subscribe', 'buy', 'order'];
  const ctaText = (text.match(/<(?:button|a)[^>]*>([^<]+)<\/(?:button|a)>/gi) || []).join(' ').toLowerCase();
  if (actionVerbs.some(v => ctaText.includes(v))) score += 20;

  return Math.min(100, score);
}

function checkSocialProof(text) {
  let score = 0;
  const proofPatterns = [
    /testimonial/gi, /review/gi, /rating/gi, /star/gi,
    /customer/gi, /client/gi, /user/gi, /member/gi,
    /case\s*study/gi, /success\s*story/gi,
    /logo/gi, /as\s*seen\s*on/gi, /featured/gi,
    /number|figure|statistic|percent|increase|decrease|improve/gi,
    /trusted/gi, /recommended/gi, /award/gi,
  ];

  let matchCount = 0;
  for (const pattern of proofPatterns) {
    const matches = text.match(pattern);
    if (matches) matchCount += matches.length;
  }

  score += Math.min(20, matchCount * 2);

  // Check for specific names
  if (text.match(/[""][^""]{10,}[""]\s*[-–—]\s*[A-Z][a-z]+/)) score += 20;
  if (text.match(/\d+\s*\+?\s*(?:years|customers|users|clients|members|reviews|testimonials)/i)) score += 20;
  if (text.match(/logo|partner|certified|accredited|member\s*of/i)) score += 15;
  if (text.match(/[A-Z][a-z]+ [A-Z][a-z]+.*(?:CEO|Founder|Director|Manager|President)/i)) score += 15;

  return Math.min(100, score);
}

function checkRiskReversal(text) {
  let score = 0;
  const riskWords = [
    /guarantee/gi, /refund/gi, /money.back/gi, /satisfaction/gi,
    /free\s*trial/gi, /no\s*risk/gi, /risk.free/gi, /cancel/gi,
    /warranty/gi, /return/gi, /exchange/gi, /promise/gi,
    /secure/gi, /safe/gi, /protected/gi, /privacy/gi,
    /support/gi, /help/gi, /assistance/gi,
  ];

  let matchCount = 0;
  for (const pattern of riskWords) {
    const matches = text.match(pattern);
    if (matches) matchCount += matches.length;
  }

  score += Math.min(30, matchCount * 3);

  // Check for specific guarantee types
  if (text.match(/30\s*day|60\s*day|90\s*day|year|annual/i)) score += 15;
  if (text.match(/full\s*refund|complete\s*refund|unconditional/i)) score += 15;
  if (text.match(/no\s*questions?\s*asked/i)) score += 10;
  if (text.match(/free\s*trial/i)) score += 15;
  if (text.match(/secure|ssl|encrypted|https/i)) score += 15;

  return Math.min(100, score);
}

function checkUrgency(text) {
  let score = 0;
  const urgencyWords = [
    /limited\s*time/i, /offer\s*ends/i, /expires/i, /deadline/i,
    /only\s*\d+\s*(?:left|remaining|spots|seats|items)/i,
    /hurry|rush|act\s*now|don't\s*wait|last\s*chance/i,
    /today\s*only|while\s*supplies\s*last|exclusive/i,
    /countdown|timer|clock/i,
    /early\s*bird|flash\s*sale|special\s*offer/i,
  ];

  let matchCount = 0;
  for (const pattern of urgencyWords) {
    const matches = text.match(pattern);
    if (matches) matchCount += matches.length;
  }

  score += Math.min(40, matchCount * 5);

  // Check for specific urgency elements
  if (text.match(/countdown|timer|<[^>]*countdown/i)) score += 20;
  if (text.match(/limited\s*time|offer\s*ends|expires/i)) score += 20;
  if (text.match(/only\s*\d+/i)) score += 20;

  return Math.min(100, score);
}

function checkStructure(text) {
  let score = 0;
  const lines = text.split('\n').filter(l => l.trim());

  // Check for heading hierarchy
  const h1s = (text.match(/<h1[^>]*>/gi) || []).length;
  const h2s = (text.match(/<h2[^>]*>/gi) || []).length;
  const h3s = (text.match(/<h3[^>]*>/gi) || []).length;

  if (h1s === 1) score += 20;
  else if (h1s >= 1) score += 10;
  if (h2s >= 2) score += 15;
  if (h3s >= 3) score += 10;

  // Check paragraph length
  const paragraphs = text.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  const avgLength = paragraphs.reduce((sum, p) => sum + p.replace(/<[^>]*>/g, '').length, 0) / (paragraphs.length || 1);
  if (avgLength < 100) score += 15;
  else if (avgLength < 200) score += 10;

  // Check for lists
  if (text.match(/<ul|<ol|<li/gi)) score += 15;

  // Check for form fields
  const formFields = (text.match(/<input|<select|<textarea/gi) || []).length;
  if (formFields >= 3) score += 15;
  else if (formFields >= 1) score += 5;

  // Check for visual hierarchy elements
  if (text.match(/class=["'][^"']*(?:hero|banner|header|footer|section|container|row|col)[^"']*["']/i)) score += 15;
  if (text.match(/class=["'][^"']*(?:card|box|panel|module|block|wrapper)[^"']*["']/i)) score += 10;

  return Math.min(100, score);
}

function checkValueProposition(text) {
  // Deterministic: check for specificity markers
  let score = 0;
  const specificityWords = [
    /percent|%|\d+x|\d+\.\d+/g,
    /[A-Z][a-z]+ [A-Z][a-z]+/g,  // proper names
    /before|after|before\s*and\s*after/g,
    /specific|exactly|precisely|particularly/g,
    /target|audience|ideal|customer|persona/g,
    /unique|different|unlike|compared\s*to|versus/g,
    /problem|pain\s*point|challenge|difficulty|struggle/g,
    /solution|result|outcome|benefit|advantage/g,
  ];

  let matchCount = 0;
  for (const pattern of specificityWords) {
    const matches = text.match(pattern);
    if (matches) matchCount += matches.length;
  }

  score += Math.min(30, matchCount);

  // Check for value proposition structure
  if (text.match(/<h1[^>]*>.*(?:transform|improve|increase|save|grow|boost)/i)) score += 20;
  if (text.match(/<p[^>]*>.*(?:help|enables|allows|provides|delivers)/i)) score += 15;
  if (text.match(/for\s+(?:[A-Z][a-z]+\s*){2,}/)) score += 15;  // "for small business owners"
  if (text.match(/in\s+(?:just|only|as\s+little\s+as)\s+\d+/)) score += 10;  // time frame
  if (text.match(/unlike|compared|versus|instead\s*of|alternative/i)) score += 10;

  return Math.min(100, score);
}

function checkObjectionHandling(text) {
  // Deterministic: check for FAQ and objection-related content
  let score = 0;
  const objectionWords = [
    /faq|frequently\s*asked|questions\s*and\s*answers/i,
    /pricing|cost|price|investment|afford/i,
    /how\s*(?:does|do|can|will|is|are)/i,
    /what\s*(?:if|about|happens|is)/i,
    /why\s*(?:should|would|is|are|do)/i,
    /comparison|compare|alternatives|vs|versus/i,
    /integration|compatible|works\s*with|api|plugin/i,
    /support|help|assistance|customer\s*service|contact/i,
    /setup|installation|onboarding|implementation/i,
    /security|privacy|data|encryption|safe/i,
  ];

  let matchCount = 0;
  for (const pattern of objectionWords) {
    const matches = text.match(pattern);
    if (matches) matchCount += matches.length;
  }

  score += Math.min(40, matchCount * 2);

  // Check for specific objection handling elements
  if (text.match(/<details|<summary/i)) score += 20;
  if (text.match(/accordion|collapse|toggle|expand/i)) score += 15;
  if (text.match(/comparison\s*table|vs|versus|alternatives/i)) score += 15;
  if (text.match(/testimonial.*(?:hesitant|skeptical|doubt|concern|worried)/i)) score += 10;

  return Math.min(100, score);
}

// ============================================================================
// Render functions
// ============================================================================
function renderFindings(items) {
  for (const item of items) {
    const statusConfig = STATUS[item.status] || { glyph: '?', color: C.text, label: 'UNKN' };
    const glyph = statusConfig.glyph;
    const color = statusConfig.color;
    const label = statusConfig.label;

    const paddedLabel = pad(label, 6);
    const source = item.source ? ` ${C.dim(item.source)}` : '';
    const was = item.was ? ` ${C.dim('was ' + item.was)}` : '';
    const now = item.now ? ` ${C.teal('→ ' + item.now)}` : '';
    const note = item.note ? `\n        ${C.dim('→ ' + item.note)}` : '';

    const lineText = `${color(glyph)} ${color(paddedLabel)} ${bold(item.headline)}${was}${now}${source}`;
    const wrappedDetail = wrap(item.detail, 72);
    const detailLines = wrappedDetail.split('\n').map(l => `        ${l}`).join('\n');

    out(lineText);
    out(detailLines);
    if (note) out(note);
    out('');
  }
}

function renderSummary(items, htmlPath) {
  const passCount = items.filter(i => i.status === 'PASS').length;
  const weakCount = items.filter(i => i.status === 'WEAK').length;
  const failCount = items.filter(i => i.status === 'FAIL_CAT').length;
  const errorCount = items.filter(i => i.status === 'FAIL').length;

  out(C.dim('─'.repeat(60)));
  out(`${C.green('+' + ' PASS'.padEnd(6))} ${passCount}  ${C.amber('~' + ' WEAK'.padEnd(6))} ${weakCount}  ${C.red('-' + ' FAIL'.padEnd(6))} ${failCount}${errorCount ? `  ${C.red('x' + ' ERROR'.padEnd(6))} ${errorCount}` : ''}`);
  if (htmlPath) {
    out(C.teal(`\n📄 HTML report written to ${htmlPath}`));
  }
  out(C.dim(SUMMARY_NOTE(items)));
}

// ============================================================================
// Run demo
// ============================================================================
async function runDemo(writeHTML) {
  const totalSteps = 3;
  line(`  ${bar(0, totalSteps)} Initializing demo...`);
  await new Promise(r => setTimeout(r, 500));
  line(`  ${bar(1, totalSteps)} Running deterministic checks...`);
  await new Promise(r => setTimeout(r, 400));
  line(`  ${bar(2, totalSteps)} Compiling findings...`);
  await new Promise(r => setTimeout(r, 300));
  endline();

  renderFindings(DEMO);

  let htmlPath = null;
  if (writeHTML) {
    const body = DEMO.map(item => {
      const statusClass = item.status;
      const statusLabel = STATUS[item.status]?.label || item.status;
      return `<div class="item ${statusClass}">
        <div class="status">${statusLabel}</div>
        <div class="headline">${item.headline}</div>
        <div class="detail">${item.detail}</div>
        ${item.note ? `<div class="note">${item.note}</div>` : ''}
        ${item.source ? `<div class="source">${item.source}</div>` : ''}
      </div>`;
    }).join('\n');

    const scoreItem = DEMO.find(i => i.status === 'SCORE');
    const scoreBody = scoreItem ? `<div class="score"><div class="number">${scoreItem.now}</div><div class="grade">${scoreItem.headline}</div></div>` : '';
    const overview = DEMO.filter(i => i.status === 'PASS' || i.status === 'WEAK' || i.status === 'FAIL_CAT').length;

    const html = buildHTML({
      subject: 'CRO Audit Checker — Demo Report',
      body: `<p>Demo analysis of a landing page across ${overview} categories.</p>
        ${scoreBody}
        <h2>Findings</h2>
        ${body}`,
    });

    const fs = require('fs');
    const filename = './cro-audit-checker-demo.html';
    fs.writeFileSync(filename, html, 'utf-8');
    htmlPath = filename;
  }

  renderSummary(DEMO, htmlPath);
}

// ============================================================================
// Run function
// ============================================================================
async function run(input, sourceName) {
  const items = [];
  const errors = [];

  try {
    line('  Checking headline...');
    const headlineScore = checkHeadline(input);
    const headlineStatus = headlineScore >= 80 ? 'PASS' : headlineScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: headlineStatus,
      headline: 'Headline: ' + (headlineScore >= 80 ? 'Clear and above the fold' : headlineScore >= 50 ? 'Present but could be improved' : 'Missing or ineffective'),
      was: '',
      now: `${headlineScore}/100`,
      detail: headlineScore >= 80 ? 'The headline is clearly visible, benefit-driven, and appears above the fold.' :
              headlineScore >= 50 ? 'A headline exists but may lack clarity, specificity, or prominent placement.' :
              'No clear headline was found or it is too small / hidden below the fold.',
      note: headlineScore >= 80 ? 'Strong first impression that captures attention.' :
            headlineScore >= 50 ? 'Improving headline clarity can boost engagement.' :
            'A headline is critical for capturing visitor attention.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'Headline check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  try {
    line('  Checking value proposition...');
    const vpScore = checkValueProposition(input);
    const vpStatus = vpScore >= 80 ? 'PASS' : vpScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: vpStatus,
      headline: 'Value Proposition: ' + (vpScore >= 80 ? 'Specific and compelling' : vpScore >= 50 ? 'Present but generic' : 'Missing or unclear'),
      was: '',
      now: `${vpScore}/100`,
      detail: vpScore >= 80 ? 'The value proposition is specific, quantifiable, and clearly targets the right audience.' :
              vpScore >= 50 ? 'A value proposition exists but lacks specificity, metrics, or clear audience targeting.' :
              'No clear value proposition was found; the page does not explain what makes it unique.',
      note: vpScore >= 80 ? 'Visitors immediately understand why they should care.' :
            vpScore >= 50 ? 'Adding specific metrics and audience focus can improve conversion.' :
            'Without a value proposition, visitors have no reason to stay.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'Value proposition check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  try {
    line('  Checking social proof...');
    const spScore = checkSocialProof(input);
    const spStatus = spScore >= 80 ? 'PASS' : spScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: spStatus,
      headline: 'Social Proof: ' + (spScore >= 80 ? 'Strong and credible' : spScore >= 50 ? 'Present but insufficient' : 'Insufficient credible evidence'),
      was: '',
      now: `${spScore}/100`,
      detail: spScore >= 80 ? 'Multiple testimonials, case studies, or social proof elements with verifiable details.' :
              spScore >= 50 ? 'Some social proof exists but lacks credibility markers like names, photos, or specifics.' :
              'No or very few social proof elements; trust is difficult to establish.',
      note: spScore >= 80 ? 'Social proof builds trust and reduces purchase anxiety.' :
            spScore >= 50 ? 'Adding credible testimonials and case studies can improve trust.' :
            'Without social proof, visitors may not trust your claims.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'Social proof check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  try {
    line('  Checking calls to action...');
    const ctaScore = checkCTA(input);
    const ctaStatus = ctaScore >= 80 ? 'PASS' : ctaScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: ctaStatus,
      headline: 'Calls to Action: ' + (ctaScore >= 80 ? 'Well-placed and action-oriented' : ctaScore >= 50 ? 'Present but could be optimized' : 'Missing or ineffective'),
      was: '',
      now: `${ctaScore}/100`,
      detail: ctaScore >= 80 ? 'Multiple clear CTAs with action verbs, prominent styling, and strategic placement.' :
              ctaScore >= 50 ? 'CTAs exist but may lack urgency, visibility, or compelling language.' :
              'No clear CTAs found or they are not visible / actionable.',
      note: ctaScore >= 80 ? 'Multiple clear paths to conversion increase likelihood of action.' :
            ctaScore >= 50 ? 'Optimizing CTA copy and placement can improve click-through rates.' :
            'Without CTAs, visitors do not know what to do next.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'CTA check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  try {
    line('  Checking objection handling...');
    const ohScore = checkObjectionHandling(input);
    const ohStatus = ohScore >= 80 ? 'PASS' : ohScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: ohStatus,
      headline: 'Objection Handling: ' + (ohScore >= 80 ? 'Common objections addressed' : ohScore >= 50 ? 'Partially addressed' : 'Common objections not addressed'),
      was: '',
      now: `${ohScore}/100`,
      detail: ohScore >= 80 ? 'FAQ, comparison charts, pricing info, and other objection-handling content present.' :
              ohScore >= 50 ? 'Some objection-handling content exists but may be incomplete or hard to find.' :
              'No FAQ, comparison, pricing, or other objection-handling content found.',
      note: ohScore >= 80 ? 'Visitors get answers to their concerns before they leave.' :
            ohScore >= 50 ? 'Adding FAQ and comparison content can reduce abandonment.' :
            'Unaddressed objections are the #1 reason for abandoned conversions.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'Objection handling check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  try {
    line('  Checking risk reversal...');
    const rrScore = checkRiskReversal(input);
    const rrStatus = rrScore >= 80 ? 'PASS' : rrScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: rrStatus,
      headline: 'Risk Reversal: ' + (rrScore >= 80 ? 'Comprehensive coverage' : rrScore >= 50 ? 'Partial coverage' : 'Insufficient coverage'),
      was: '',
      now: `${rrScore}/100`,
      detail: rrScore >= 80 ? 'Multiple risk reversal elements present: guarantees, refunds, free trials, security badges.' :
              rrScore >= 50 ? 'Some risk reversal exists but may be hidden or lack specificity.' :
              'No or very few risk reversal elements; visitors bear all the risk.',
      note: rrScore >= 80 ? 'Risk reversal removes barriers to purchase.' :
            rrScore >= 50 ? 'Prominent guarantee and refund policies can increase conversion.' :
            'Risk reversal must be visible at the moment of decision.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'Risk reversal check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  try {
    line('  Checking urgency...');
    const urScore = checkUrgency(input);
    const urStatus = urScore >= 80 ? 'PASS' : urScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: urStatus,
      headline: 'Urgency: ' + (urScore >= 80 ? 'Effectively used' : urScore >= 50 ? 'Present but subtle' : 'Missing or ineffective'),
      was: '',
      now: `${urScore}/100`,
      detail: urScore >= 80 ? 'Limited-time offers, countdown timers, or scarcity indicators are prominently used.' :
              urScore >= 50 ? 'Some urgency elements exist but may be weak or hidden.' :
              'No urgency elements found; visitors have no reason to act now.',
      note: urScore >= 80 ? 'Urgency motivates immediate action and reduces procrastination.' :
            urScore >= 50 ? 'Adding time-limited offers or scarcity can boost conversion rates.' :
            'Without urgency, visitors may delay and forget.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'Urgency check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  try {
    line('  Checking structure...');
    const stScore = checkStructure(input);
    const stStatus = stScore >= 80 ? 'PASS' : stScore >= 50 ? 'WEAK' : 'FAIL_CAT';
    items.push({
      status: stStatus,
      headline: 'Structure: ' + (stScore >= 80 ? 'Well-organized and scannable' : stScore >= 50 ? 'Adequate but could be improved' : 'Poorly organized'),
      was: '',
      now: `${stScore}/100`,
      detail: stScore >= 80 ? 'Clear heading hierarchy, short paragraphs, lists, and form fields are well-organized.' :
              stScore >= 50 ? 'Structure exists but may have inconsistent headings, long paragraphs, or missing lists.' :
              'Poor heading hierarchy, long paragraphs, and no clear visual structure.',
      note: stScore >= 80 ? 'Good structure makes content easy to scan and digest.' :
            stScore >= 50 ? 'Improving heading hierarchy and paragraph length improves readability.' :
            'Poor structure leads to high bounce rates.',
      source: sourceName,
    });
  } catch (e) {
    errors.push({ status: 'FAIL', headline: 'Structure check failed', was: '', now: '', detail: e.message, note: '', source: sourceName });
  }

  // Try LLM call for subjective judgments
  const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' :
                   process.env.OPENAI_API_KEY ? 'openai' :
                   process.env.GEMINI_API_KEY ? 'gemini' : null;

  if (provider) {
    try {
      line('  Consulting LLM for subjective judgments...');
      const deterministicSummary = items.map(i => `${i.headline}: ${i.now}`).join('\n');
      const systemPrompt = `You are a CRO (Conversion Rate Optimization) expert analyzing a landing page. Given the page content and deterministic findings, provide subjective judgments on three categories: value proposition specificity, social proof credibility, and objection handling completeness. Return a JSON object with a "categories" array containing objects with "name", "score" (0-100), "verdict" (PASS/WEAK/FAIL_CAT), "missing" (array of missing elements), and "fix" (single highest-value fix).`;

      const userPrompt = `Page content (first 5000 chars):\n${input.slice(0, 5000)}\n\nDeterministic findings:\n${deterministicSummary}\n\nPlease evaluate:\n1. How specific is the value proposition? (not whether it exists, but how specific and credible it is)\n2. How credible is the social proof? (not whether it exists, but how believable and verifiable)\n3. How well are common buyer objections addressed? (are the real objections a buyer would have answered?)`;

      const llmResponse = await ask({
        system: systemPrompt,
        prompt: userPrompt,
        schema: { categories: [{ name: '', score: 0, verdict: '', missing: [], fix: '' }] },
        maxTokens: 8000,
      });

      const llmData = parseJSON(llmResponse);

      if (llmData && llmData.categories && Array.isArray(llmData.categories)) {
        for (const cat of llmData.categories) {
          if (cat.name && cat.score !== undefined) {
            const existingIdx = items.findIndex(i => i.headline.toLowerCase().includes(cat.name.toLowerCase()));
            if (existingIdx !== -1) {
              items[existingIdx].now = `${cat.score}/100`;
              items[existingIdx].status = cat.verdict || items[existingIdx].status;
              if (cat.detail) items[existingIdx].detail = cat.detail;
              if (cat.fix) items[existingIdx].note = cat.fix;
            }
          }
        }
      }
    } catch (e) {
      errors.push({ status: 'FAIL', headline: 'LLM subjective judgment failed', was: '', now: '', detail: e.message, note: 'Using deterministic scores only.', source: sourceName });
    }
  } else {
    // No provider: add note about missing subjective judgments
    const noteItem = {
      status: 'CHECKLIST',
      headline: 'No LLM provider configured — subjective judgments missing',
      was: '',
      now: '',
      detail: NO_SEARCH_NOTE,
      note: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for full analysis.',
      source: '',
    };
    items.push(noteItem);
  }

  // Compute overall score (mean of the 8 category scores)
  const categoryItems = items.filter(i => i.status === 'PASS' || i.status === 'WEAK' || i.status === 'FAIL_CAT');
  const scores = categoryItems.map(i => {
    const match = i.now.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  });
  const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const overallGrade = overallScore >= 80 ? 'A' : overallScore >= 60 ? 'B' : overallScore >= 40 ? 'C' : overallScore >= 20 ? 'D' : 'F';

  items.push({
    status: 'SCORE',
    headline: `Overall Score: ${overallScore}/100 (Grade ${overallGrade})`,
    was: '',
    now: `${overallScore}/100`,
    detail: `Mean of ${scores.length} category scores. This is a calculated value, not AI-generated.`,
    note: overallScore >= 80 ? 'Page is well-optimized for conversion.' :
          overallScore >= 60 ? 'Page has some conversion issues that should be addressed.' :
          overallScore >= 40 ? 'Page has significant conversion problems.' :
          'Page is poorly optimized for conversion.',
    source: sourceName,
  });

  // Build checklist of missing elements
  const missingElements = [];
  for (const item of items) {
    if (item.status === 'FAIL_CAT' || item.status === 'WEAK') {
      missingElements.push(item.headline);
    }
  }
  items.push({
    status: 'CHECKLIST',
    headline: 'Priority Improvements',
    was: '',
    now: '',
    detail: missingElements.length > 0 ? missingElements.map(e => `• ${e}`).join('\n') : 'All categories are passing. No immediate improvements needed.',
    note: missingElements.length > 0 ? `Focus on ${missingElements.length} areas for maximum impact.` : 'Keep monitoring and testing.',
    source: sourceName,
  });

  // Add any errors as FAIL items
  for (const err of errors) {
    items.push(err);
  }

  return items;
}

// ============================================================================
// Entry point
// ============================================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    out(PITCH);
    out('');
    out('Usage: node cro-audit-checker.js <input> [options]');
    out('');
    out('Arguments:');
    for (const [arg, desc] of USAGE) {
      out(`  ${pad(arg, 12)} ${desc}`);
    }
    process.exit(0);
  }

  if (args.includes('--demo')) {
    await runDemo(true);
    process.exit(0);
  }

  const inputArg = args[0];
  let input, sourceName;

  if (inputArg === '-') {
    // Read from stdin
    sourceName = 'stdin';
    const fs = require('fs');
    input = fs.readFileSync(0, 'utf-8');
  } else if (inputArg.startsWith('http://') || inputArg.startsWith('https://')) {
    // Fetch URL
    sourceName = inputArg;
    const https = require('https');
    try {
      line('  Fetching page...');
      const data = await new Promise((resolve, reject) => {
        https.get(inputArg, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', (e) => reject(e));
      });
      // Strip HTML tags
      input = data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      endline();
    } catch (e) {
      out(C.red(`Error fetching URL: ${e.message}`));
      process.exit(1);
    }
  } else {
    // Read file
    sourceName = inputArg;
    const fs = require('fs');
    if (!fs.existsSync(inputArg)) {
      out(C.red(`File not found: ${inputArg}`));
      process.exit(1);
    }
    input = fs.readFileSync(inputArg, 'utf-8');
  }

  const items = await run(input, sourceName);
  renderFindings(items);

  const htmlPath = null;
  renderSummary(items, htmlPath);
}

main().catch((e) => {
  out(C.red(`Fatal error: ${e.message}`));
  process.exit(1);
});
