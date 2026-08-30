#!/usr/bin/env node
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/4mmar1mtiaz

// ========== CONSTANTS AND HELPERS ==========

const PITCH = "Finds Search Console quick wins: keywords one push from page one that gain the most traffic."
const USAGE = [
  ['<file>', 'read a CSV/TSV file'],
  ['-', 'read stdin'],
  ['--demo', 'see sample output, no API key needed'],
  ['--help', 'show this help']
]
const STATUS = {
  WIN: { glyph: '+', color: null, label: 'WIN' },
  MAYBE: { glyph: '?', color: null, label: 'MAYBE' },
  CURVE: { glyph: '~', color: null, label: 'CURVE' },
  FAIL: { glyph: '!', color: null, label: 'FAIL' }
}
const ITEM_NOUN = "quick win"
const NOTE_LABEL = "Action"
const NO_SEARCH_NOTE = "No search API key was provided; intent and effort labels are estimated from position data only."
const SUMMARY_NOTE = (items) => {
  const wins = items.filter(i => i.status === 'WIN').length
  return wins > 0 ? `Found ${wins} quick win${wins > 1 ? 's' : ''} that could improve with targeted effort.` : ''
}

// CTR curve estimates: position -> estimated CTR
const CTR_CURVE = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06,
  6: 0.04, 7: 0.03, 8: 0.025, 9: 0.022, 10: 0.02,
  11: 0.012, 12: 0.011, 13: 0.01, 14: 0.009, 15: 0.008,
  16: 0.008, 17: 0.007, 18: 0.007, 19: 0.006, 20: 0.005
}

// ========== COLOUR FUNCTIONS ==========

const C = {
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  amber: (s) => `\x1b[33m${s}\x1b[39m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  teal: (s) => `\x1b[36m${s}\x1b[39m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  text: (s) => s
}

STATUS.WIN.color = C.green
STATUS.MAYBE.color = C.amber
STATUS.CURVE.color = C.teal
STATUS.FAIL.color = C.red

// ========== TEXT HELPERS ==========

function bold(text) {
  return `\x1b[1m${text}\x1b[22m`
}

function bar(i, total) {
  const width = 20
  const filled = Math.round((i / Math.max(total, 1)) * width)
  const empty = width - filled
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']'
}

function wrap(text, width) {
  if (!text || text.length <= width) return text
  const lines = []
  let current = ''
  for (const word of text.split(' ')) {
    if (current.length + word.length + 1 > width && current.length > 0) {
      lines.push(current)
      current = word
    } else {
      current += (current.length > 0 ? ' ' : '') + word
    }
  }
  if (current.length > 0) lines.push(current)
  return lines.join('\n')
}

function clip(text, n) {
  if (!text) return ''
  if (text.length <= n) return text
  return text.slice(0, n - 3) + '...'
}

function pad(text, n) {
  const s = String(text)
  return s + ' '.repeat(Math.max(0, n - s.length))
}

// ========== PARSE JSON WITH FALLBACKS ==========

function parseJSON(text) {
  // Try direct parse
  try {
    return JSON.parse(text)
  } catch (e) {
    // fall through
  }

  // Try fenced block
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1])
    } catch (e) {
      // fall through
    }
  }

  // Brace scan: find first { and last }
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1))
    } catch (e) {
      throw new Error('parseJSON failed after all fallbacks')
    }
  }

  throw new Error('parseJSON failed: no JSON structure found')
}

// ========== ASK FUNCTION ==========

async function ask(P, { system, prompt, schema, search, maxTokens }) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  let provider = null

  if (anthropicKey) {
    provider = 'anthropic'
  } else if (openaiKey) {
    provider = 'openai'
  } else if (geminiKey) {
    provider = 'gemini'
  }

  if (!provider) {
    throw new Error('No API key found in environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY)')
  }

  const userMessage = schema ? `${prompt}\n\nRespond with JSON matching: ${JSON.stringify(schema)}` : prompt

  let url, headers, body

  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01'
    }
    body = JSON.stringify({
      model: 'claude-3-haiku-20240307',
      system: system || '',
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: maxTokens || 1000
    })
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions'
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`
    }
    body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system || '' },
        { role: 'user', content: userMessage }
      ],
      max_tokens: maxTokens || 1000
    })
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`
    headers = { 'Content-Type': 'application/json' }
    body = JSON.stringify({
      contents: [{ parts: [{ text: `${system ? system + '\n\n' : ''}${userMessage}` }] }]
    })
  }

  const response = await fetch(url, { method: 'POST', headers, body })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error (${provider}): ${response.status} ${errorText}`)
  }

  const data = await response.json()

  if (provider === 'anthropic') {
    return data.content[0].text
  } else if (provider === 'openai') {
    return data.choices[0].message.content
  } else if (provider === 'gemini') {
    return data.candidates[0].content.parts[0].text
  }

  throw new Error('Unknown provider')
}

// ========== MAP LIMIT ==========

async function mapLimit(items, limit, fn) {
  const results = []
  const iterator = items.entries()
  const workers = []

  async function worker() {
    for (const [index, item] of iterator) {
      results[index] = await fn(item, index)
    }
  }

  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(worker())
  }

  await Promise.all(workers)
  return results
}

// ========== PROGRESS LINE HELPERS ==========

let progressWritten = false

function line(text) {
  process.stdout.write('\r' + ' '.repeat(80) + '\r' + text)
  progressWritten = true
}

function endline() {
  if (progressWritten) {
    process.stdout.write('\n')
    progressWritten = false
  }
}

function out(text) {
  endline()
  console.log(text)
}

// ========== CSV/TSV PARSER ==========

function parseQuotedRow(line, delimiter) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current.trim())
  return fields
}

function cleanNumber(value) {
  if (!value) return 0
  // Remove commas, percent signs, currency symbols
  let cleaned = value.replace(/[,€$£¥%]/g, '')
  // Handle time strings like "1m 24s"
  const timeMatch = cleaned.match(/(\d+)\s*m\s*(\d+)\s*s/)
  if (timeMatch) {
    return parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2])
  }
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function findHeaderIndex(lines) {
  const requiredColumns = ['query', 'clicks', 'impressions', 'ctr', 'position']
  const altNames = {
    'query': ['query', 'keyword', 'search query', 'search term', 'top queries'],
    'clicks': ['clicks', 'total clicks'],
    'impressions': ['impressions', 'total impressions', 'impression'],
    'ctr': ['ctr', 'click-through rate', 'click through rate'],
    'position': ['position', 'avg position', 'average position', 'rank']
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = parseQuotedRow(line, '\t')
    if (parts.length < 5) continue
    const lowerParts = parts.map(p => p.toLowerCase().trim())
    
    const found = {}
    for (const [key, names] of Object.entries(altNames)) {
      for (const name of names) {
        const idx = lowerParts.indexOf(name)
        if (idx !== -1) {
          found[key] = idx
          break
        }
      }
    }

    if (found.query !== undefined && found.impressions !== undefined && found.position !== undefined) {
      return { index: i, columns: found, delimiter: '\t' }
    }
  }

  // Try comma delimiter
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = parseQuotedRow(line, ',')
    if (parts.length < 5) continue
    const lowerParts = parts.map(p => p.toLowerCase().trim())
    
    const found = {}
    for (const [key, names] of Object.entries(altNames)) {
      for (const name of names) {
        const idx = lowerParts.indexOf(name)
        if (idx !== -1) {
          found[key] = idx
          break
        }
      }
    }

    if (found.query !== undefined && found.impressions !== undefined && found.position !== undefined) {
      return { index: i, columns: found, delimiter: ',' }
    }
  }

  throw new Error('Could not find header row with required columns')
}

// ========== COMPUTE QUICK WINS ==========

function estimateCTR(position) {
  if (position <= 0) return 0
  if (position <= 20) return CTR_CURVE[Math.round(position)] || 0.005
  return 0.005
}

function computeQuickWins(rows) {
  const items = []
  const skippedRows = []

  for (const row of rows) {
    const query = row.query.trim()
    const impressions = cleanNumber(row.impressions)
    const position = cleanNumber(row.position)
    const clicks = cleanNumber(row.clicks)
    const ctr = cleanNumber(row.ctr) / 100 || clicks / Math.max(impressions, 1)

    if (!query || impressions < 100) {
      skippedRows.push({ reason: impressions < 100 ? 'Low impressions' : 'Empty query' })
      continue
    }

    if (position >= 8 && position <= 20) {
      const currentCTR = estimateCTR(position)
      const ctrAt5 = estimateCTR(5)
      const ctrAt3 = estimateCTR(3)
      const projectedClicks5 = Math.round(impressions * (ctrAt5 - currentCTR))
      const projectedClicks3 = Math.round(impressions * (ctrAt3 - currentCTR))

      items.push({
        query,
        impressions,
        position: Math.round(position * 100) / 100,
        currentCTR: Math.round(currentCTR * 10000) / 100,
        projectedClicks5,
        projectedClicks3,
        currentClicks: clicks
      })
    }
  }

  return { items, skippedRows }
}

// ========== RENDER FUNCTIONS ==========

function renderFindings(items) {
  endline()
  const statusWidth = Math.max(...Object.values(STATUS).map(s => s.label.length)) + 2

  for (const item of items) {
    const status = STATUS[item.status]
    if (!status) {
      out(`  ${C.dim('?')} ${item.headline}`)
      continue
    }
    const glyph = status.color ? status.color(status.glyph) : status.glyph
    const label = status.color ? status.color(pad(status.label, statusWidth)) : pad(status.label, statusWidth)
    
    out(` ${glyph} ${label} ${bold(item.headline)}`)
    if (item.was || item.now) {
      out(`    ${C.dim('was:')} ${item.was || '-'} ${C.dim('→ now:')} ${item.now || '-'}`)
    }
    if (item.detail) {
      out(`    ${C.text(wrap(item.detail, 72))}`)
    }
    if (item.note) {
      out(`    ${C.teal('→')} ${C.text(item.note)}`)
    }
    if (item.source) {
      out(`    ${C.dim('source:')} ${C.dim(item.source)}`)
    }
    out('')
  }
}

function renderSummary(items, htmlPath) {
  const counts = {}
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1
  }

  out('')
  out(bold(' Summary'))
  out(`  ${pad('', 3)}${pad('Status', 8)}Count`)
  for (const [key, status] of Object.entries(STATUS)) {
    const count = counts[key] || 0
    const glyph = count > 0 ? (status.color ? status.color(status.glyph) : status.glyph) : ' '
    const label = pad(status.label, 6)
    out(`  ${glyph} ${label} ${count}`)
  }

  const note = SUMMARY_NOTE(items)
  if (note) {
    out(`\n  ${C.dim(note)}`)
  }

  if (htmlPath) {
    out(`\n  ${C.green('✓')} HTML report written to ${C.teal(htmlPath)}`)
  }
}

// ========== BUILD HTML ==========

function buildHTML({ subject, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #333; line-height: 1.5; }
  h1 { color: #1a1a2e; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5rem; }
  h2 { color: #16213e; margin-top: 2rem; }
  .item { background: #f8f9fa; border-left: 4px solid #ccc; padding: 1rem; margin: 1rem 0; border-radius: 0 8px 8px 0; }
  .item.WIN { border-left-color: #28a745; }
  .item.MAYBE { border-left-color: #ffc107; }
  .item.CURVE { border-left-color: #17a2b8; }
  .item.FAIL { border-left-color: #dc3545; }
  .status { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600; }
  .status.WIN { background: #d4edda; color: #155724; }
  .status.MAYBE { background: #fff3cd; color: #856404; }
  .status.CURVE { background: #d1ecf1; color: #0c5460; }
  .status.FAIL { background: #f8d7da; color: #721c24; }
  .headline { font-size: 1.1rem; font-weight: 600; margin: 0.5rem 0; }
  .detail { margin: 0.5rem 0; color: #555; }
  .note { margin: 0.5rem 0; font-style: italic; color: #6c757d; }
  .source { font-size: 0.9rem; color: #007bff; }
  .meta { display: flex; gap: 2rem; margin: 0.5rem 0; font-size: 0.9rem; color: #666; }
  .summary { background: #e9ecef; padding: 1.5rem; border-radius: 8px; margin: 2rem 0; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #dee2e6; }
  th { background: #f1f1f1; font-weight: 600; }
</style>
</head>
<body>
<h1>${subject}</h1>
${body}
</body>
</html>`
}

// ========== DEMO DATA ==========

const DEMO = [
  {
    status: 'WIN',
    headline: 'ergonomic office chair',
    was: 'position 12',
    now: 'projected ~530 clicks at pos 5',
    detail: 'Currently at position 12 with 8,250 impressions and 0.9% CTR. Moving to position 5 (estimated 6% CTR) would gain approximately 420 additional clicks per month based on the CTR curve.',
    note: 'Create comparative guide: "Top 10 Ergo Chairs Under $500" targeting commercial intent',
    source: 'Search Console / Last 28 days'
  },
  {
    status: 'WIN',
    headline: 'standing desk converter',
    was: 'position 9',
    now: 'projected ~340 clicks at pos 5',
    detail: 'Position 9 with 6,100 impressions and 1.8% CTR. This is a high-intent commercial query with strong purchase signals. Adding a buying guide with price comparisons could push this to page one.',
    note: 'Write "Best Standing Desk Converters 2024" with affiliate links',
    source: 'Search Console / Last 28 days'
  },
  {
    status: 'WIN',
    headline: 'wireless mechanical keyboard',
    was: 'position 15',
    now: 'projected ~280 clicks at pos 5',
    detail: 'This query has 4,500 impressions but sits at position 15 with only 0.5% CTR. The category is trending up 20% month-over-month. A detailed comparison post could capture significant traffic.',
    note: 'Update existing post with 2024 models and battery life comparisons',
    source: 'Search Console / Last 28 days'
  },
  {
    status: 'WIN',
    headline: 'laptop docking station dual monitor',
    was: 'position 11',
    now: 'projected ~190 clicks at pos 5',
    detail: '3,200 impressions at position 11, currently getting about 35 clicks. The CTR curve suggests we are leaving 150+ clicks on the table. This is a technical query where thorough specs tables perform well.',
    note: 'Add compatibility matrix and troubleshooting section to existing guide',
    source: 'Search Console / Last 28 days'
  },
  {
    status: 'MAYBE',
    headline: 'gaming headset under 100',
    was: 'position 18',
    now: 'projected ~90 clicks at pos 5',
    detail: '2,100 impressions but buried at position 18 with 0.3% CTR. Budget gaming gear is competitive but this page has strong internal links. The effort-to-reward ratio is moderate given the lower impression volume.',
    note: 'Consolidate three thin posts into one comprehensive budget guide',
    source: 'Search Console / Last 28 days'
  },
  {
    status: 'FAIL',
    headline: 'ultrawide monitor for programming',
    was: 'position 22',
    now: 'N/A',
    detail: 'Only 85 impressions in the last 28 days — below the 100-impression threshold for quick win analysis. The keyword may be too niche or the current content may not be well optimised for search intent.',
    note: 'Reconsider targeting or improve meta description and H1',
    source: 'Search Console / Last 28 days'
  }
]

// ========== RUN DEMO ==========

async function runDemo(writeHTML) {
  line(' Running quick wins analysis (demo mode)...')
  await new Promise(r => setTimeout(r, 300))
  line(' Reading data...')
  await new Promise(r => setTimeout(r, 200))
  line(' Computing quick wins...')
  await new Promise(r => setTimeout(r, 300))
  line(' Analysing top candidates...')
  await new Promise(r => setTimeout(r, 200))
  endline()

  renderFindings(DEMO)

  let htmlPath = null
  if (writeHTML) {
    const body = DEMO.map(item => {
      const status = STATUS[item.status]
      return `<div class="item ${item.status}">
        <span class="status ${item.status}">${status.glyph} ${status.label}</span>
        <div class="headline">${item.headline}</div>
        <div class="meta">
          <span>Was: ${item.was || '—'}</span>
          <span>Now: ${item.now || '—'}</span>
        </div>
        <div class="detail">${item.detail}</div>
        ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
        ${item.source ? `<div class="source">${item.source}</div>` : ''}
      </div>`
    }).join('\n')

    const html = buildHTML({
      subject: 'GSC Quick Wins Finder — Demo Report',
      body: `<p>${NO_SEARCH_NOTE}</p>
        <p><em>Demo mode — no API key used, no live data.</em></p>
        ${body}
        <div class="summary">
          <h2>CTR Curve Used</h2>
          <table>
            <tr><th>Position</th><th>Est. CTR</th></tr>
            ${Object.entries(CTR_CURVE).slice(0, 10).map(([pos, ctr]) =>
              `<tr><td>${pos}</td><td>${(ctr * 100).toFixed(1)}%</td></tr>`
            ).join('\n')}
            <tr><td>11–20</td><td>1.2% → 0.5%</td></tr>
          </table>
          <p><small>Note: These are estimates based on industry averages; actual CTR varies by query, device, and SERP features.</small></p>
        </div>`
    })

    htmlPath = './gsc-quick-wins-finder-demo.html'
    require('fs').writeFileSync(htmlPath, html)
  }

  renderSummary(DEMO, htmlPath)
}

// ========== RUN ACTUAL ANALYSIS ==========

async function run(input, sourceName) {
  const lines = input.split('\n').filter(l => l.trim() !== '' && !l.trim().startsWith('#'))
  if (lines.length === 0) {
    throw new Error('No data lines found')
  }

  line(' Parsing header...')
  const headerInfo = findHeaderIndex(lines)
  const headerLine = lines[headerInfo.index]
  const headers = parseQuotedRow(headerLine, headerInfo.delimiter)

  line(` Reading data rows (${lines.length - headerInfo.index - 1} lines)...`)
  const rows = []
  const parseErrors = []

  for (let i = headerInfo.index + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const parts = parseQuotedRow(line, headerInfo.delimiter)
      const row = {}
      for (const [col, idx] of Object.entries(headerInfo.columns)) {
        row[col] = idx < parts.length ? parts[idx] : ''
      }
      rows.push(row)
    } catch (e) {
      parseErrors.push(`Row ${i}: ${e.message}`)
    }
  }

  line(' Computing quick win candidates...')
  const { items: candidates, skippedRows } = computeQuickWins(rows)
  candidates.sort((a, b) => b.projectedClicks5 - a.projectedClicks5)

  const items = []

  // Add CURVE item
  items.push({
    status: 'CURVE',
    headline: 'Position-to-CTR curve used for projections',
    was: '',
    now: '',
    detail: `Positions 1-5: ${Object.entries(CTR_CURVE).slice(0, 5).map(([p, c]) => `#${p} ${(c*100).toFixed(1)}%`).join(', ')}. Positions 6-10 decrease from 4% to 2%. Positions 11-20 average 1%. Estimates based on industry benchmarks.`,
    note: 'Actual CTR varies; these are directional estimates, not guarantees.',
    source: 'curve built into analysis tool'
  })

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY
  
  if (!apiKey) {
    // No API key — use position-based estimates for intent
    line(' No API key found — estimating intent from position data...')
    await new Promise(r => setTimeout(r, 500))
    
    for (const c of candidates.slice(0, 25)) {
      const intent = c.position < 12 ? 'commercial' : (c.position < 16 ? 'informational' : 'navigational')
      const effort = c.projectedClicks5 > 200 ? 'new page' : (c.projectedClicks5 > 100 ? 'page edit' : 'trivial')
      const action = effort === 'new page' ? 'Create dedicated landing page' : (effort === 'page edit' ? 'Update existing content' : 'Minor SEO tweaks')

      items.push({
        status: 'WIN',
        headline: c.query,
        was: `position ${c.position}`,
        now: `~${c.projectedClicks5} clicks at pos 5`,
        detail: `${c.impressions.toLocaleString()} impressions, ${c.currentCTR}% current CTR. Projected ${c.projectedClicks5} additional clicks/month at position 5 (${c.projectedClicks3} at position 3).`,
        note: `${action} — ${intent} intent, ${effort} effort`,
        source: sourceName || 'Search Console export'
      })
    }

    items.push({
      status: 'MAYBE',
      headline: 'No search API key configured — intent/effort labels are estimated',
      was: '',
      now: '',
      detail: NO_SEARCH_NOTE,
      note: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for enhanced analysis',
      source: ''
    })
  } else {
    // Has API key — call LLM for intent/effort
    const topCandidates = candidates.slice(0, 25)
    line(` Calling API for ${topCandidates.length} candidates...`)
    
    const schema = { wins: [{ query: 'string', intent: 'string', effort: 'string', action: 'string' }] }
    const prompt = `Analyse these Search Console quick wins for commercial intent and required effort. 
Return a JSON object with a "wins" array. For each query, provide:
- intent: one of transactional|commercial|informational|navigational
- effort: one of trivial|page edit|new section|new page
- action: a brief recommended action

Queries:
${topCandidates.map((c, i) => `${i+1}. "${c.query}" — pos ${c.position}, ${c.impressions} impressions, ${c.projectedClicks5} projected clicks at pos 5`).join('\n')}`

    try {
      const text = await ask(null, {
        system: 'You are an SEO analyst. Respond only with valid JSON matching the requested schema.',
        prompt,
        search: null,
        schema,
        maxTokens: 6000
      })
      const data = parseJSON(text)

      for (let i = 0; i < Math.min(topCandidates.length, data.wins.length); i++) {
        const c = topCandidates[i]
        const analysis = data.wins[i] || { intent: 'commercial', effort: 'page edit', action: 'Optimise content' }
        
        items.push({
          status: 'WIN',
          headline: c.query,
          was: `position ${c.position}`,
          now: `~${c.projectedClicks5} clicks at pos 5`,
          detail: `${c.impressions.toLocaleString()} impressions, ${c.currentCTR}% current CTR. Projected ${c.projectedClicks5} additional clicks/month at position 5 (${c.projectedClicks3} at position 3).`,
          note: `${analysis.action} — ${analysis.intent} intent, ${analysis.effort} effort`,
          source: sourceName || 'Search Console export'
        })
      }
    } catch (e) {
      // API call failed — fall back to position-based estimates
      for (const c of candidates.slice(0, 25)) {
        items.push({
          status: 'WIN',
          headline: c.query,
          was: `position ${c.position}`,
          now: `~${c.projectedClicks5} clicks at pos 5`,
          detail: `${c.impressions.toLocaleString()} impressions, ${c.currentCTR}% current CTR. Projected ${c.projectedClicks5} additional clicks/month at position 5 (${c.projectedClicks3} at position 3).`,
          note: `API call failed — ${e.message}`,
          source: sourceName || 'Search Console export'
        })
      }
    }
  }

  endline()
  renderFindings(items)

  // Write HTML report
  const body = items.map(item => {
    const status = STATUS[item.status]
    return `<div class="item ${item.status}">
      <span class="status ${item.status}">${status.glyph} ${status.label}</span>
      <div class="headline">${item.headline}</div>
      <div class="meta">
        <span>Was: ${item.was || '—'}</span>
        <span>Now: ${item.now || '—'}</span>
      </div>
      <div class="detail">${item.detail}</div>
      ${item.note ? `<div class="note">→ ${item.note}</div>` : ''}
      ${item.source ? `<div class="source">${item.source}</div>` : ''}
    </div>`
  }).join('\n')

  const html = buildHTML({
    subject: 'GSC Quick Wins Finder — Analysis Report',
    body: `<p>${items.length} items found from ${sourceName || 'provided data'}.</p>
      ${!apiKey ? `<p>${NO_SEARCH_NOTE}</p>` : ''}
      ${body}
      <div class="summary">
        <h2>CTR Curve Used</h2>
        <table>
          <tr><th>Position</th><th>Est. CTR</th></tr>
          ${Object.entries(CTR_CURVE).slice(0, 10).map(([pos, ctr]) =>
            `<tr><td>${pos}</td><td>${(ctr * 100).toFixed(1)}%</td></tr>`
          ).join('\n')}
          <tr><td>11–20</td><td>1.2% → 0.5%</td></tr>
        </table>
        <p><small>Note: These are estimates based on industry averages; actual CTR varies by query, device, and SERP features. Use as directional guidance, not guaranteed traffic projections.</small></p>
      </div>`
  })

  const htmlPath = './gsc-quick-wins-finder.html'
  require('fs').writeFileSync(htmlPath, html)
  renderSummary(items, htmlPath)
}

// ========== ENTRY POINT ==========

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.length === 0) {
    out(bold(' GSC Quick Wins Finder'))
    out(` ${PITCH}`)
    out('')
    out(bold(' Usage:'))
    for (const [arg, desc] of USAGE) {
      out(`   ${pad(arg, 12)} ${desc}`)
    }
    out('')
    out(bold(' Environment variables (optional):'))
    out('   ANTHROPIC_API_KEY   For enhanced intent/effort analysis')
    out('   OPENAI_API_KEY      Alternative provider')
    out('   GEMINI_API_KEY      Alternative provider')
    out('')
    out(bold(' Output:'))
    out('   Terminal report + gsc-quick-wins-finder.html')
    return
  }

  if (args.includes('--demo')) {
    await runDemo(true)
    return
  }

  // Check for file argument
  const fileArg = args.find(a => !a.startsWith('--'))
  
  if (fileArg === '-') {
    // Read from stdin
    line(' Reading from stdin...')
    const chunks = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk)
    }
    const input = Buffer.concat(chunks).toString('utf-8')
    await run(input, 'stdin')
  } else if (fileArg) {
    // Read from file
    line(` Reading file: ${fileArg}...`)
    const fs = require('fs')
    const input = fs.readFileSync(fileArg, 'utf-8')
    await run(input, fileArg)
  } else {
    out(bold(' Error:'))
    out('   No input provided. Use --help for usage.')
    out('   Provide a file path, "-" for stdin, or --demo for sample output.')
    process.exit(1)
  }
}

main().catch(e => {
  out('')
  out(C.red(bold(' Fatal error:')))
  out(`   ${e.message}`)
  process.exit(1)
})
