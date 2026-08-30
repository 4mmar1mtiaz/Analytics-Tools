#!/usr/bin/env node

// =============================================================================
// Links
// =============================================================================
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/4mmar1mtiaz

// =============================================================================
// COLOUR FUNCTIONS
// =============================================================================

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  teal: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  text: (s) => s,
};

// =============================================================================
// CONSTANTS
// =============================================================================

const PITCH = "Content Decay Detector: finds pages losing traffic over consecutive periods.";
const USAGE = [
  ["<file>", "read a GA4 or Search Console CSV export"],
  ["-", "read stdin"],
  ["--demo", "see the output, spend nothing"],
  ["--help", "show this usage"],
];

const STATUS = {
  DECAYING: { glyph: "-", color: C.red, label: "DECAYING" },
  SITEWIDE: { glyph: "~", color: C.amber, label: "SITEWIDE" },
  STABLE: { glyph: "=", color: C.green, label: "STABLE" },
  FAIL: { glyph: "!", color: C.teal, label: "FAIL" },
};

const ITEM_NOUN = "finding";
const NOTE_LABEL = "Note";
const NO_SEARCH_NOTE =
  "No API key found — computed all numbers, but the AI reason analysis was skipped.";

const SUMMARY_NOTE = (items) => {
  const failing = items.filter((i) => i.status === STATUS.FAIL);
  if (failing.length > 0) return `${failing.length} step(s) failed to complete.`;
  return "All steps completed successfully.";
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const pad = (s, n) => String(s).padEnd(n);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 3) + "..." : s);
const wrap = (text, width) => {
  if (!text || text.length <= width) return text || "";
  const words = text.split(" ");
  let lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n" + " ".repeat(4));
};

const bar = (i, total) => {
  const width = 20;
  const filled = Math.round((i / total) * width);
  return (
    "[" +
    "#".repeat(filled) +
    "-".repeat(width - filled) +
    "] " +
    Math.round((i / total) * 100) +
    "%"
  );
};

// =============================================================================
// TERMINAL OUTPUT HELPERS
// =============================================================================

let _progressLine = "";
const line = (text) => {
  const clear = "\r\x1b[K";
  process.stdout.write(clear + text);
  _progressLine = text;
};

const endline = () => {
  process.stdout.write("\n");
  _progressLine = "";
};

const out = (text) => {
  console.log(text);
};

// =============================================================================
// RENDER FUNCTIONS
// =============================================================================

const renderFindings = (items) => {
  const labelWidth = Math.max(...Object.values(STATUS).map((s) => s.label.length));

  for (const item of items) {
    const statusObj = item.status;
    const label = statusObj.label.padEnd(labelWidth);
    const colorFn = statusObj.color;
    const glyph = statusObj.glyph;

    out("");
    out(colorFn(` ${glyph} ${label}  ${bold(item.headline)}`));
    out(`    ${item.detail}`);
    if (item.was) out(`    ${C.dim("Was:")} ${item.was}`);
    if (item.now) out(`    ${C.dim("Now:")} ${item.now}`);
    if (item.note) out(`    ${C.dim("→")} ${item.note}`);
    if (item.source) out(`    ${C.dim("Source:")} ${item.source}`);
  }
};

const renderSummary = (items, htmlPath) => {
  const counts = {};
  for (const key of Object.keys(STATUS)) counts[key] = 0;
  for (const item of items) {
    const key = Object.keys(STATUS).find((k) => STATUS[k] === item.status);
    if (key) counts[key]++;
  }

  out("\n" + "=".repeat(50));
  out(bold("SUMMARY"));
  for (const [key, obj] of Object.entries(STATUS)) {
    out(`  ${obj.glyph} ${obj.label}: ${counts[key]}`);
  }
  out("=".repeat(50));
  out(SUMMARY_NOTE(items));
  if (htmlPath) {
    out(C.green(`\nHTML report written to: ${htmlPath}`));
  } else {
    out(C.dim("\nNo HTML report written (--demo without --html or no file mode)"));
  }
};

// =============================================================================
// HTML BUILDING
// =============================================================================

const buildHTML = ({ subject, body }) => {
  const statusColors = {
    DECAYING: "#e74c3c",
    SITEWIDE: "#f39c12",
    STABLE: "#2ecc71",
    FAIL: "#9b59b6",
  };

  const itemsHtml = body
    .map((item) => {
      const statusKey = Object.keys(STATUS).find((k) => STATUS[k] === item.status);
      const color = statusColors[statusKey] || "#333";
      const statusLabel = item.status.label;
      return `
        <div style="border-left: 4px solid ${color}; margin: 10px 0; padding: 8px 12px; background: #f8f9fa;">
          <div style="font-weight: bold; color: ${color};">${statusLabel}: ${item.headline}</div>
          <div style="margin-top: 4px;">${item.detail}</div>
          ${item.was ? `<div style="color: #666; font-size: 0.9em;">Was: ${item.was}</div>` : ""}
          ${item.now ? `<div style="color: #666; font-size: 0.9em;">Now: ${item.now}</div>` : ""}
          ${item.note ? `<div style="color: #888; font-style: italic; margin-top: 4px;">→ ${item.note}</div>` : ""}
          ${item.source ? `<div style="color: #888; font-size: 0.9em;">Source: ${item.source}</div>` : ""}
        </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Content Decay Detector Report</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 20px auto; padding: 0 20px;">
  <h1>Content Decay Detector Report</h1>
  <h2>${subject}</h2>
  <div>${itemsHtml}</div>
  <p style="color: #888; font-size: 0.8em; margin-top: 30px;">Generated by Content Decay Detector — built with Node.js</p>
</body></html>`;
};

// =============================================================================
// PARSEJSON
// =============================================================================

const parseJSON = (text) => {
  // Direct parse first
  try {
    return JSON.parse(text);
  } catch (e) {
    // fallback
  }

  // Try fenced block extraction
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch (e) {
      // fallback
    }
  }

  // Brace-scan fallback: find the first { and last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch (e) {
      // fallback
    }
  }

  throw new Error("parseJSON: could not parse JSON from:\n" + text.slice(0, 200));
};

// =============================================================================
// MAPLIMIT
// =============================================================================

const mapLimit = async (items, limit, fn) => {
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
};

// =============================================================================
// ASK — HTTP MODEL CALL
// =============================================================================

const https = require("https");

const ask = async (prompt, { system, prompt: prompt2, schema, search, maxTokens }) => {
  const apiKeyAnthropic = process.env.ANTHROPIC_API_KEY;
  const apiKeyOpenAI = process.env.OPENAI_API_KEY;
  const apiKeyGemini = process.env.GEMINI_API_KEY;

  let provider, apiKey, url, body;

  if (apiKeyAnthropic) {
    provider = "Anthropic";
    apiKey = apiKeyAnthropic;
    url = "https://api.anthropic.com/v1/messages";
    body = JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: maxTokens || 7000,
      system: system || "",
      messages: [{ role: "user", content: prompt2 || prompt || "" }],
    });
  } else if (apiKeyOpenAI) {
    provider = "OpenAI";
    apiKey = apiKeyOpenAI;
    url = "https://api.openai.com/v1/chat/completions";
    body = JSON.stringify({
      model: "gpt-4o",
      max_tokens: maxTokens || 7000,
      messages: [
        { role: "system", content: system || "" },
        { role: "user", content: prompt2 || prompt || "" },
      ],
    });
  } else if (apiKeyGemini) {
    provider = "Gemini";
    apiKey = apiKeyGemini;
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;
    body = JSON.stringify({
      contents: [
        {
          parts: [
            { text: (system ? system + "\n\n" : "") + (prompt2 || prompt || "") },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens || 7000,
      },
    });
  } else {
    throw new Error("No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.");
  }

  line(`  Calling ${provider}...`);

  return new Promise((resolve, reject) => {
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider === "Anthropic"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
          : provider === "OpenAI"
          ? { Authorization: `Bearer ${apiKey}` }
          : {}),
      },
    };

    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          let text = "";
          if (provider === "Anthropic") {
            text = parsed.content?.[0]?.text || "";
          } else if (provider === "OpenAI") {
            text = parsed.choices?.[0]?.message?.content || "";
          } else if (provider === "Gemini") {
            text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
          }
          if (!text) throw new Error("Empty response from " + provider);
          resolve(text);
        } catch (e) {
          reject(new Error(`Failed to parse ${provider} response: ${e.message}\n${data.slice(0, 300)}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

// =============================================================================
// CSV PARSER (quoted fields)
// =============================================================================

const parseCSVLine = (line) => {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
};

// =============================================================================
// CLEAN NUMBERS
// =============================================================================

const cleanNumber = (str) => {
  if (!str) return NaN;
  let s = str.trim();
  // Remove currency symbols, percent signs, commas
  s = s.replace(/[$€£¥%]/g, "");
  s = s.replace(/,/g, "");
  // Handle time strings like "1m 24s" -> approximate seconds as a number
  const timeMatch = s.match(/^(\d+)\s*m\s*(\d+)\s*s$/);
  if (timeMatch) {
    return parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
  }
  const num = parseFloat(s);
  return isNaN(num) ? NaN : num;
};

// =============================================================================
// FIND HEADER ROW
// =============================================================================

const findHeaderRow = (lines) => {
  const requiredCols = [
    /path/i,
    /page/i,
    /url/i,
    /session/i,
    /traffic/i,
    /visitor/i,
    /date/i,
    /published/i,
    /last.?updated/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    const fieldLower = fields.map((f) => f.toLowerCase());

    // Check if at least 3 required columns are present
    let matches = 0;
    for (const regex of requiredCols) {
      if (fieldLower.some((f) => regex.test(f))) matches++;
    }
    if (matches >= 3) {
      return { index: i, fields, rawFields: fields };
    }
  }
  return null;
};

// =============================================================================
// COMPUTE DECAY
// =============================================================================

const computeDecay = (pageData, siteTrend) => {
  // pageData: array of period sessions [{period, sessions}, ...]
  // siteTrend: 'up' | 'down' | 'flat'

  if (pageData.length < 2) return "stable";

  const periods = pageData.sort((a, b) => a.period - b.period);
  const sessions = periods.map((p) => p.sessions);

  // Check consecutive declines
  let consecutiveDeclines = 0;
  for (let i = 1; i < sessions.length; i++) {
    if (sessions[i] < sessions[i - 1]) {
      consecutiveDeclines++;
    } else {
      consecutiveDeclines = 0;
    }
  }

  if (consecutiveDeclines >= 2) return "decaying";

  // Check >20% loss while site not down
  const firstSessions = sessions[0];
  const lastSessions = sessions[sessions.length - 1];
  if (firstSessions > 0) {
    const lossPercent = (firstSessions - lastSessions) / firstSessions;
    if (lossPercent > 0.2 && siteTrend !== "down") return "decaying";
  }

  // If site is down and page went down too
  if (siteTrend === "down" && lastSessions < firstSessions) return "sitewide";

  return "stable";
};

// ==============================================================================
// RUN — MAIN LOGIC
// ==============================================================================

const run = async (input, sourceName) => {
  const lines = input.split("\n");
  const headerInfo = findHeaderRow(lines);
  if (!headerInfo) {
    return [{
      status: STATUS.FAIL,
      headline: "Could not find CSV header row",
      detail: `Searched ${lines.length} lines for columns matching path, sessions, date.`,
      was: "",
      now: "",
      note: "The file may not be a valid GA4 or Search Console export.",
      source: sourceName,
    }];
  }

  const { index: headerIdx, fields: headerFields } = headerInfo;
  const fieldLower = headerFields.map((f) => f.toLowerCase());

  // Find column indices
  const pathIdx = fieldLower.findIndex(
    (f) => /path/i.test(f) || /page/i.test(f) || /url/i.test(f)
  );
  const sessionsIdx = fieldLower.findIndex(
    (f) => /session/i.test(f) || /traffic/i.test(f) || /visitors/i.test(f)
  );
  const dateIdx = fieldLower.findIndex(
    (f) => /date/i.test(f) || /published/i.test(f) || /last.?updated/i.test(f)
  );

  if (pathIdx === -1 || sessionsIdx === -1) {
    return [{
      status: STATUS.FAIL,
      headline: "Missing required columns",
      detail: `Need a path/page/url column and a sessions/traffic/visitors column.`,
      was: "",
      now: "",
      note: "Check the file header row.",
      source: sourceName,
    }];
  }

  // Parse rows
  const rows = [];
  const skippedRows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    const path = fields[pathIdx];
    const sessionsRaw = fields[sessionsIdx];
    const dateRaw = dateIdx !== -1 ? fields[dateIdx] : "";

    if (!path || !sessionsRaw) {
      skippedRows.push(i + 1);
      continue;
    }

    const sessions = cleanNumber(sessionsRaw);
    if (isNaN(sessions)) {
      skippedRows.push(i + 1);
      continue;
    }

    rows.push({
      path,
      sessions,
      date: dateRaw,
      line: i + 1,
    });
  }

  if (rows.length === 0) {
    return [{
      status: STATUS.FAIL,
      headline: "No valid data rows found",
      detail: `Parsed ${headerIdx + 1} rows but none had valid path and sessions.`,
      was: "",
      now: "",
      note: `Skipped ${skippedRows.length} row(s) with missing or invalid data.`,
      source: sourceName,
    }];
  }

  // Compute periods (assuming chronological order)
  // For simplicity, we split data into two halves: before and after
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);

  // Compute site trend
  const firstTotal = firstHalf.reduce((sum, r) => sum + r.sessions, 0);
  const secondTotal = secondHalf.reduce((sum, r) => sum + r.sessions, 0);
  const siteTrend =
    secondTotal > firstTotal * 1.05 ? "up" :
    secondTotal < firstTotal * 0.95 ? "down" : "flat";

  // Compute decay for each page
  const items = [];

  for (const row of rows) {
    // Use row's sessions as latest; for "was" we need previous period
    // Since we don't have true periods, we estimate from position in list
    const index = rows.indexOf(row);
    const period = index < mid ? 1 : 2;
    const otherPeriodRows = period === 1 ? secondHalf : firstHalf;
    const otherRow = otherPeriodRows.find(
      (r) => r.path === row.path
    );

    const wasSessions = otherRow ? otherRow.sessions : row.sessions;
    const nowSessions = row.sessions;
    const loss = wasSessions - nowSessions;

    const pageData = [
      { period: 1, sessions: wasSessions },
      { period: 2, sessions: nowSessions },
    ];

    const decayType = computeDecay(pageData, siteTrend);

    // Compute age if date exists
    let age = "";
    if (row.date) {
      const pubDate = new Date(row.date);
      if (!isNaN(pubDate.getTime())) {
        const now = new Date();
        const diffDays = Math.floor((now - pubDate) / (1000 * 60 * 60 * 24));
        age = `${diffDays} days`;
      }
    }

    const statusKey = decayType === "decaying" ? "DECAYING" :
                      decayType === "sitewide" ? "SITEWIDE" : "STABLE";

    const detail =
      decayType === "decaying"
        ? `Lost ${loss} sessions from ${wasSessions} to ${nowSessions}. ${age ? `Page age: ${age}. ` : ""}Consecutive decline detected.`
        : decayType === "sitewide"
        ? `Lost ${loss} sessions with the site (site trend: ${siteTrend}). ${age ? `Page age: ${age}. ` : ""}`
        : `Held stable at ${nowSessions} sessions. ${age ? `Page age: ${age}. ` : ""}`;

    items.push({
      status: STATUS[statusKey],
      headline: row.path,
      detail,
      was: String(wasSessions),
      now: String(nowSessions),
      note: decayType === "decaying" ? "Requires attention" : decayType === "sitewide" ? "Part of site trend" : "No action needed",
      source: `${sourceName}:${row.line}`,
    });
  }

  // Sort: decaying first, then sitewide, then stable
  const order = { DECAYING: 0, SITEWIDE: 1, STABLE: 2 };
  items.sort((a, b) => {
    const aKey = Object.keys(STATUS).find((k) => STATUS[k] === a.status);
    const bKey = Object.keys(STATUS).find((k) => STATUS[k] === b.status);
    return (order[aKey] || 99) - (order[bKey] || 99);
  });

  // Pick worst 20 decaying for AI call
  const decayingItems = items.filter((i) => i.status === STATUS.DECAYING);
  const top20Decaying = decayingItems.slice(0, 20);

  if (top20Decaying.length > 0) {
    const providerResolved =
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY;

    if (providerResolved) {
      try {
        const promptText = `Analyze these 20 decaying pages. For each, suggest a refresh type (rewrite|update stats|add section|consolidate|retire) and confidence. Respond with JSON: { site_event: boolean, pages: [{ path, likely_reason, refresh_type, confidence }] }. Pages: ${JSON.stringify(
          top20Decaying.map((i) => ({
            path: i.headline,
            was: i.was,
            now: i.now,
            age: i.detail.match(/Page age: ([^.]+)/)?.[1] || "unknown",
            loss: parseInt(i.was) - parseInt(i.now),
          }))
        )}`;

        const systemText =
          "You are a content decay analyst. Respond ONLY with valid JSON matching the schema.";

        const response = await ask(promptText, {
          system: systemText,
          prompt: promptText,
          maxTokens: 7000,
        });

        const data = parseJSON(response);

        if (data && data.pages) {
          for (const page of data.pages) {
            const item = items.find(
              (i) => i.headline === page.path && i.status === STATUS.DECAYING
            );
            if (item) {
              item.note = `${page.refresh_type} (${Math.round(page.confidence * 100)}% confidence) — ${page.likely_reason}`;
            }
          }
        }
      } catch (e) {
        // If AI call fails, keep existing items as is
        items.push({
          status: STATUS.FAIL,
          headline: "AI analysis failed",
          detail: `Could not get AI recommendations: ${e.message}`,
          was: "",
          now: "",
          note: "Decay numbers are still computed correctly.",
          source: "",
        });
      }
    } else {
      // No API key — add note to decaying items
      for (const item of top20Decaying) {
        item.note = NO_SEARCH_NOTE;
      }
    }
  }

  // Report skipped rows
  if (skippedRows.length > 0) {
    items.push({
      status: STATUS.FAIL,
      headline: `${skippedRows.length} row(s) skipped`,
      detail: `Rows ${skippedRows.join(", ")} had missing or invalid data.`,
      was: "",
      now: "",
      note: "These were excluded from analysis.",
      source: sourceName,
    });
  }

  return items;
};

// =============================================================================
// DEMO DATA
// =============================================================================

const DEMO = [
  {
    status: STATUS.DECAYING,
    headline: "/guides/seo-best-practices-2023",
    detail: "Lost 2,450 sessions from 4,100 peak to 1,650 latest across 3 consecutive periods. Page published 847 days ago — content is stale and competitors have overtaken.",
    was: "4,100",
    now: "1,650",
    note: "rewrite (85% confidence) — outdated statistics and broken links",
    source: "demo-data.csv:42",
  },
  {
    status: STATUS.DECAYING,
    headline: "/blog/email-marketing-tips",
    detail: "Declined from 3,200 to 1,100 sessions over two periods — a 65% drop. Published 623 days ago; the email marketing landscape has changed significantly.",
    was: "3,200",
    now: "1,100",
    note: "update stats (78% confidence) — core advice still valid but data is old",
    source: "demo-data.csv:87",
  },
  {
    status: STATUS.SITEWIDE,
    headline: "/resources/industry-report-2024",
    detail: "Lost 890 sessions along with the rest of the site during a Google algorithm update. The site as a whole dropped 23% in the same period.",
    was: "4,200",
    now: "3,310",
    note: "Part of site trend — wait for recovery before taking action",
    source: "demo-data.csv:156",
  },
  {
    status: STATUS.STABLE,
    headline: "/about/team",
    detail: "Held steady at 1,800 sessions across both periods. Content is evergreen and still relevant.",
    was: "1,800",
    now: "1,800",
    note: "No action needed",
    source: "demo-data.csv:201",
  },
  {
    status: STATUS.FAIL,
    headline: "/pricing page",
    detail: "Row had missing sessions data — could not compute trend.",
    was: "",
    now: "",
    note: "Skipped due to incomplete data",
    source: "demo-data.csv:302",
  },
  {
    status: STATUS.DECAYING,
    headline: "/tutorials/python-for-beginners",
    detail: "Dropped from 5,600 to 3,100 sessions — a 45% decline. Published 512 days ago; newer tutorials from competitors rank higher now.",
    was: "5,600",
    now: "3,100",
    note: "add section (91% confidence) — needs modern examples and updated code",
    source: "demo-data.csv:45",
  },
];

// =============================================================================
// RUN DEMO
// =============================================================================

const runDemo = async (writeHTML) => {
  line("  Processing demo data...");
  await new Promise((r) => setTimeout(r, 100));
  line(bar(1, 5) + " Parsing CSV...");
  await new Promise((r) => setTimeout(r, 100));
  line(bar(2, 5) + " Computing trends...");
  await new Promise((r) => setTimeout(r, 100));
  line(bar(3, 5) + " Classifying pages...");
  await new Promise((r) => setTimeout(r, 100));
  line(bar(4, 5) + " Generating report...");
  await new Promise((r) => setTimeout(r, 100));
  line(bar(5, 5) + " Done.");
  endline();

  renderFindings(DEMO);

  let htmlPath = null;
  if (writeHTML) {
    htmlPath = "./content-decay-detector-demo.html";
    const html = buildHTML({
      subject: "Demo Report (no API key needed)",
      body: DEMO,
    });
    require("fs").writeFileSync(htmlPath, html);
  }
  renderSummary(DEMO, htmlPath);
};

// =============================================================================
// ENTRY POINT
// =============================================================================

const main = async () => {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    console.log(PITCH);
    console.log("");
    console.log("USAGE:");
    for (const [arg, desc] of USAGE) {
      console.log(`  ${arg.padEnd(15)} ${desc}`);
    }
    console.log("");
    console.log("ENVIRONMENT:");
    console.log("  Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for AI analysis.");
    process.exit(0);
  }

  if (args.includes("--demo")) {
    const writeHTML = args.includes("--html");
    await runDemo(writeHTML);
    process.exit(0);
  }

  // Read input
  let input = "";
  let sourceName = "";

  if (args.length === 0 || args[0] === "-") {
    // Read stdin
    sourceName = "stdin";
    const fs = require("fs");
    input = fs.readFileSync(0, "utf-8");
  } else {
    sourceName = args[0];
    const fs = require("fs");
    if (!fs.existsSync(sourceName)) {
      console.error(C.red(`Error: File not found: ${sourceName}`));
      process.exit(1);
    }
    input = fs.readFileSync(sourceName, "utf-8");
  }

  line("  Starting analysis...");
  const items = await run(input, sourceName);
  endline();

  renderFindings(items);

  // Write HTML report
  const providerResolved =
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY;

  const htmlPath = sourceName !== "stdin" ? `./${sourceName}-report.html` : "./report.html";
  const html = buildHTML({
    subject: `Content Decay Report: ${sourceName}`,
    body: items,
  });
  require("fs").writeFileSync(htmlPath, html);
  renderSummary(items, htmlPath);
};

// Run main and handle errors
main().catch((err) => {
  console.error(C.red(`\nFatal error: ${err.message}`));
  process.exit(1);
});
