#!/usr/bin/env node

// =============================================================================
// AUTHOR & LINKS
// =============================================================================
// www.ammarimtiaz.com
// linkedin.com/in/ammarimtiaz
// github.com/ammar1mtiaz

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

const PITCH = 'Analyzes calls-to-action in web content for strength, alignment, and distribution.';
const USAGE = [
    ['<input>', 'URL or file path to analyze'],
    ['-', 'read stdin'],
    ['--demo', 'see demo output (no API key needed)'],
    ['--help', 'show this help']
];

const STATUS = {
    STRONG: { glyph: '+', color: 'green', label: 'STRONG' },
    WEAK: { glyph: '-', color: 'amber', label: 'WEAK' },
    OFF_GOAL: { glyph: '!', color: 'red', label: 'OFF_GOAL' },
    GAP: { glyph: '>', color: 'teal', label: 'GAP' },
    MIX: { glyph: '*', color: 'amber', label: 'MIX' },
    FAIL: { glyph: 'x', color: 'red', label: 'FAIL' }
};

const ITEM_NOUN = 'finding';
const NOTE_LABEL = 'Impact';
const NO_SEARCH_NOTE = 'No API key found; analysis uses computed metrics only without AI alignment assessment.';
const SUMMARY_NOTE = (items) => {
    const strong = items.filter(i => i.status === 'STRONG').length;
    const weak = items.filter(i => i.status === 'WEAK').length;
    if (strong > weak) return 'Overall CTA strategy appears solid with strong calls-to-action leading.';
    if (weak > strong) return 'Consider revising weaker calls-to-action to improve conversion potential.';
    return 'Mixed results — review individual findings for targeted improvements.';
};

// =============================================================================
// DEMO DATA
// =============================================================================

const DEMO = [
    {
        status: 'STRONG',
        headline: '"Start Free Trial" appears 3 times in first 25% of page',
        detail: 'The primary conversion CTA "Start Free Trial" is prominently placed in the hero section, navigation bar, and above the fold as a sticky banner. This triple placement ensures users see the action immediately from any scroll position.',
        was: 'Start Free Trial',
        now: 'Start Free Trial',
        note: 'Consistent positioning reinforces the primary conversion goal without confusing alternatives.',
        source: 'https://example-saas.com/pricing'
    },
    {
        status: 'STRONG',
        headline: '"Get Started Now" button uses imperative verb with time urgency',
        detail: 'The CTA combines a strong action verb ("Get") with temporal pressure ("Now"), which studies show increases click-through rates by 14-28%. The button appears in a high-contrast orange on white background.',
        was: 'Get Started Now',
        now: 'Get Started Now',
        note: 'Length of 3 words is optimal for above-the-fold conversion buttons.',
        source: 'https://example-saas.com/'
    },
    {
        status: 'WEAK',
        headline: '"Learn More" link on features page lacks specificity',
        detail: 'The generic "Learn More" text appears 4 times across feature cards without any contextual differentiation. Users cannot distinguish between reading about API docs, pricing, or use cases without clicking through first.',
        was: 'Learn More',
        now: 'Explore API Documentation',
        note: 'Replacing generic text with specific outcomes could increase feature page conversion by 22%.',
        source: 'https://example-saas.com/features'
    },
    {
        status: 'OFF_GOAL',
        headline: '"Subscribe to Newsletter" competes with primary "Start Free Trial"',
        detail: 'A secondary CTA for newsletter subscription appears directly below the main conversion CTA using equal visual weight (same button style, size, and color). This creates decision paralysis for new visitors who should be focused on trial signup.',
        was: 'Subscribe to Newsletter',
        now: 'Get Product Updates (secondary link style)',
        note: 'Downgrading visual hierarchy of secondary actions improves primary conversion by 18%.',
        source: 'https://example-saas.com/'
    },
    {
        status: 'GAP',
        headline: 'No CTA between 42% and 86% scroll depth on pricing page',
        detail: 'After the initial pricing table header, there is a 44% scroll gap with zero calls-to-action. Users reach detailed plan comparisons and feature breakdowns but have no way to act until they reach the bottom comparison table.',
        was: '',
        now: 'Insert "Compare Plans →" CTA at 55% scroll',
        note: 'Adding mid-page CTAs recovers users who scroll past initial offerings without committing.',
        source: 'https://example-saas.com/pricing'
    },
    {
        status: 'FAIL',
        headline: 'Broken "Buy Now" link on product page leads to 404',
        detail: 'The primary purchase CTA at position 15% of the product page targets a non-existent URL (/checkout/legacy instead of /checkout/v2). This affects all visitors arriving from marketing campaigns since last week\'s site migration.',
        was: 'Buy Now → /checkout/legacy (404)',
        now: 'Buy Now → /checkout/v2',
        note: 'Revenue impact of broken purchase paths averages $2,847 per hour for typical SaaS products.',
        source: 'https://example-saas.com/product/pro'
    }
];

// =============================================================================
// HELPER: COLOR FUNCTIONS (C)
// =============================================================================

const C = {
    green: (s) => `\x1b[32m${s}\x1b[39m`,
    amber: (s) => `\x1b[33m${s}\x1b[39m`,
    red: (s) => `\x1b[31m${s}\x1b[39m`,
    teal: (s) => `\x1b[36m${s}\x1b[39m`,
    dim: (s) => `\x1b[2m${s}\x1b[22m`,
    text: (s) => s
};

// =============================================================================
// HELPER: TEXT UTILITIES
// =============================================================================

function bold(text) {
    return `\x1b[1m${text}\x1b[22m`;
}

function bar(i, total) {
    const width = 20;
    const filled = Math.round((i / total) * width);
    const empty = width - filled;
    return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

function wrap(text, width) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        if ((line + ' ' + word).trim().length > width) {
            lines.push(line.trim());
            line = word;
        } else {
            line += ' ' + word;
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
    if (s.length >= n) return s;
    return s + ' '.repeat(n - s.length);
}

// =============================================================================
// HELPER: JSON PARSING
// =============================================================================

function parseJSON(text) {
    // Try direct parse
    try {
        return JSON.parse(text);
    } catch (e) {
        // fallback: try to extract from fenced code block
    }

    // Fenced block fallback
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
        try {
            return JSON.parse(fenceMatch[1]);
        } catch (e) {
            // continue to next fallback
        }
    }

    // Brace-scan fallback: find first { and last }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch (e) {
            // throw original error
        }
    }

    throw new Error('Could not parse JSON from text: ' + clip(text, 100));
}

// =============================================================================
// HELPER: ASYNC UTILITIES
// =============================================================================

async function mapLimit(items, limit, fn) {
    const results = [];
    const running = [];
    let index = 0;

    for (const item of items) {
        const promise = fn(item, index).then(result => {
            results.push(result);
            return result;
        });
        running.push(promise);
        index++;

        if (running.length >= limit) {
            await Promise.race(running);
            // Clean settled promises
            for (let i = running.length - 1; i >= 0; i--) {
                if (Object.prototype.toString.call(running[i]) === '[object Promise]') {
                    // Check if settled (hacky but works in Node)
                    const state = await Promise.race([running[i], Promise.resolve('pending')]);
                    if (state !== 'pending') {
                        running.splice(i, 1);
                    }
                }
            }
        }
    }

    await Promise.all(running);
    return results;
}

// =============================================================================
// HELPER: OUTPUT
// =============================================================================

let currentLineLength = 0;

function line(text) {
    const clear = ' '.repeat(currentLineLength);
    process.stdout.write('\r' + clear + '\r' + text);
    currentLineLength = text.length;
}

function endline() {
    process.stdout.write('\n');
    currentLineLength = 0;
}

function out(text) {
    console.log(text);
}

// =============================================================================
// HELPER: ASK (AI MODEL CALL)
// =============================================================================

async function ask(P, { system, prompt, schema, search, maxTokens = 6000 }) {
    // Determine provider
    let apiKey, baseUrl, model;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (anthropicKey) {
        apiKey = anthropicKey;
        baseUrl = 'https://api.anthropic.com/v1/messages';
        model = 'claude-3-sonnet-20240229';
    } else if (openaiKey) {
        apiKey = openaiKey;
        baseUrl = 'https://api.openai.com/v1/chat/completions';
        model = 'gpt-4-turbo-preview';
    } else if (geminiKey) {
        apiKey = geminiKey;
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
        model = 'gemini-pro';
    } else {
        throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.');
    }

    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
    ];

    let body, headers;

    if (baseUrl.includes('anthropic')) {
        body = JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages,
            system
        });
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        };
    } else if (baseUrl.includes('openai')) {
        body = JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens
        });
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };
    } else if (baseUrl.includes('google')) {
        body = JSON.stringify({
            contents: [{
                parts: [{ text: system + '\n\n' + prompt }]
            }],
            generationConfig: {
                maxOutputTokens: maxTokens
            }
        });
        headers = {
            'Content-Type': 'application/json'
        };
        baseUrl += `?key=${apiKey}`;
    }

    const response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body
    });

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Extract text from different API response formats
    if (data.content && Array.isArray(data.content)) {
        // Anthropic format
        return data.content.map(c => c.text).join(' ');
    } else if (data.choices && data.choices[0] && data.choices[0].message) {
        // OpenAI format
        return data.choices[0].message.content;
    } else if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        // Gemini format
        return data.candidates[0].content.parts.map(p => p.text).join(' ');
    }

    throw new Error('Unknown API response format');
}

// =============================================================================
// HELPER: FETCH CONTENT
// =============================================================================

async function fetchContent(input) {
    // Check if input is URL
    const urlPattern = /^https?:\/\//i;
    if (urlPattern.test(input)) {
        const response = await fetch(input);
        return await response.text();
    }

    // Check if file exists
    const fs = require('fs');
    try {
        return fs.readFileSync(input, 'utf-8');
    } catch (e) {
        // Treat as raw text
        return input;
    }
}

// =============================================================================
// HELPER: ANALYZE CTAS
// =============================================================================

function analyzeCTAs(text, goal) {
    const ctas = [];
    const lines = text.split('\n');
    const totalLines = lines.length;

    // Verb strength scoring
    const strongVerbs = ['start', 'get', 'book', 'claim', 'buy', 'purchase', 'subscribe', 'sign up', 'register', 'order'];
    const weakVerbs = ['learn more', 'click here', 'submit', 'read more', 'view', 'see', 'check out', 'find out'];

    // Find links and buttons via common patterns
    const linkRegex = /<a\s[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const buttonRegex = /<button[^>]*>([^<]*)<\/button>/gi;
    const inputRegex = /<input[^>]*type="(?:submit|button)"[^>]*value="([^"]*)"[^>]*>/gi;

    let match;
    
    // Extract from HTML links
    while ((match = linkRegex.exec(text)) !== null) {
        const position = Math.round((match.index / text.length) * 100);
        ctas.push({
            text: match[2].trim(),
            position,
            type: 'link',
            url: match[1]
        });
    }

    // Extract from HTML buttons
    while ((match = buttonRegex.exec(text)) !== null) {
        const position = Math.round((match.index / text.length) * 100);
        ctas.push({
            text: match[1].trim(),
            position,
            type: 'button',
            url: ''
        });
    }

    // Extract from input buttons
    while ((match = inputRegex.exec(text)) !== null) {
        const position = Math.round((match.index / text.length) * 100);
        ctas.push({
            text: match[1].trim(),
            position,
            type: 'button',
            url: ''
        });
    }

    // Find imperative sentences in text (heuristic)
    const imperativePattern = /^[A-Z][a-z]*(?:\s+[a-z]+){1,10}[.!]?$/gm;
    while ((match = imperativePattern.exec(text)) !== null) {
        const lineNum = text.slice(0, match.index).split('\n').length;
        const position = Math.round((lineNum / totalLines) * 100);
        const ctaText = match[0].trim();
        
        // Check if it looks like a CTA (starts with verb)
        const firstWord = ctaText.split(' ')[0].toLowerCase();
        const allVerbs = [...strongVerbs, ...weakVerbs];
        const isVerb = allVerbs.some(v => firstWord.startsWith(v) || v.startsWith(firstWord));
        
        if (isVerb && ctaText.length > 5 && ctaText.length < 80) {
            ctas.push({
                text: ctaText,
                position,
                type: 'bare line',
                url: ''
            });
        }
    }

    return ctas;
}

// =============================================================================
// HELPER: SCORE CTAS
// =============================================================================

function scoreCTA(cta, goal) {
    const text = cta.text.toLowerCase();
    const words = text.split(' ').filter(w => w.length > 0);
    const wordCount = words.length;

    // Verb strength
    const strongVerbs = ['start', 'get', 'book', 'claim', 'buy', 'purchase', 'subscribe', 'sign', 'register', 'order'];
    const weakVerbs = ['learn', 'click', 'submit', 'read', 'view', 'see', 'check', 'find'];

    let verbScore = 0;
    for (const verb of strongVerbs) {
        if (text.includes(verb)) verbScore += 2;
    }
    for (const verb of weakVerbs) {
        if (text.includes(verb)) verbScore -= 1;
    }

    // Specificity score
    let specificityScore = 0;
    if (wordCount >= 2 && wordCount <= 5) specificityScore += 1;
    if (wordCount >= 3 && wordCount <= 4) specificityScore += 1;
    if (/\d+/.test(text)) specificityScore += 1; // numbers add specificity
    if (text.includes('free')) specificityScore += 1;
    if (text.includes('now')) specificityScore += 1;
    if (text.includes('today')) specificityScore += 1;

    // Person (first vs second)
    const firstPersonWords = ['my', 'me', 'our'];
    const secondPersonWords = ['your', 'you'];
    let personScore = 0;
    if (firstPersonWords.some(w => text.includes(w))) personScore = -1;
    if (secondPersonWords.some(w => text.includes(w))) personScore = 1;

    // Outcome vs mechanic
    const outcomeWords = ['result', 'success', 'grow', 'increase', 'improve', 'better', 'faster', 'easier'];
    const mechanicWords = ['click', 'submit', 'enter', 'fill', 'type', 'select'];
    let outcomeScore = 0;
    if (outcomeWords.some(w => text.includes(w))) outcomeScore += 1;
    if (mechanicWords.some(w => text.includes(w))) outcomeScore -= 1;

    // Goal alignment
    let goalScore = 0;
    if (goal) {
        const goalWords = goal.toLowerCase().split(' ');
        for (const gw of goalWords) {
            if (text.includes(gw)) goalScore += 2;
            if (words.some(w => w.includes(gw) || gw.includes(w))) goalScore += 1;
        }
    }

    // Position score (earlier is better)
    let positionScore = 0;
    if (cta.position <= 25) positionScore += 2;
    else if (cta.position <= 50) positionScore += 1;

    // Total score
    const totalScore = verbScore + specificityScore + personScore + outcomeScore + goalScore + positionScore;

    return {
        totalScore,
        verbScore,
        specificityScore,
        personScore,
        outcomeScore,
        goalScore,
        positionScore,
        wordCount
    };
}

// =============================================================================
// HELPER: ANALYZE DISTRIBUTION
// =============================================================================

function analyzeDistribution(ctas, totalLength) {
    const result = {
        total: ctas.length,
        firstIn25: false,
        largestGap: 0,
        hasRepetition: false,
        repetitionText: '',
        repetitionCount: 0,
        isConfusingRepetition: false
    };

    if (ctas.length === 0) return result;

    // Check if any CTA in first 25%
    const first25 = ctas.some(c => c.position <= 25);
    result.firstIn25 = first25;

    // Calculate gaps between consecutive CTAs
    const sorted = [...ctas].sort((a, b) => a.position - b.position);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].position - sorted[i - 1].position;
        if (gap > maxGap) maxGap = gap;
    }
    result.largestGap = maxGap;

    // Check for repetition
    const textCounts = {};
    for (const c of ctas) {
        const t = c.text.toLowerCase().trim();
        textCounts[t] = (textCounts[t] || 0) + 1;
    }

    const entries = Object.entries(textCounts);
    const maxRep = Math.max(...entries.map(e => e[1]));
    const repText = entries.find(e => e[1] === maxRep);

    if (maxRep > 1 && repText) {
        result.hasRepetition = true;
        result.repetitionText = repText[0];
        result.repetitionCount = maxRep;
        
        // If many different CTAs with low repetition, it's confusion
        const uniqueCount = entries.length;
        if (uniqueCount >= 5 && maxRep <= 2) {
            result.isConfusingRepetition = true;
        }
    }

    return result;
}

// =============================================================================
// HELPER: GENERATE ITEMS FROM ANALYSIS
// =============================================================================

function generateItems(ctas, distribution, goal, sourceName) {
    const items = [];

    // Process each CTA
    for (const cta of ctas) {
        const score = scoreCTA(cta, goal);
        
        let status, headline, detail, was, now, note;

        if (score.totalScore >= 8) {
            status = 'STRONG';
            headline = `"${clip(cta.text, 40)}" scores ${score.totalScore}/10 — strong position and wording`;
            detail = `This ${cta.type} at position ${cta.position}% combines ${score.verbScore > 0 ? 'strong' : 'adequate'} verb choice with ${score.specificityScore > 0 ? 'specific' : 'generic'} phrasing. ${score.goalScore > 0 ? 'It aligns well with the stated goal.' : 'Consider making the goal more explicit.'}`;
            was = cta.text;
            now = cta.text;
            note = score.wordCount <= 4 ? 'Optimal word count for conversion.' : 'Consider shortening for mobile users.';
        } else if (score.totalScore >= 4) {
            status = 'WEAK';
            headline = `"${clip(cta.text, 40)}" could be stronger (score ${score.totalScore}/10)`;
            detail = `Located at ${cta.position}% as a ${cta.type}, this CTA lacks ${score.verbScore <= 0 ? 'strong verb power' : 'specificity'} and ${score.outcomeScore <= 0 ? 'outcome focus' : 'urgency'}. ${score.goalScore <= 0 ? 'Goal alignment is missing.' : ''}`;
            was = cta.text;
            now = goal ? `${strongVerbs[0]} ${goal} ${cta.text.includes('now') ? '' : 'Now'}` : cta.text + ' [revise]';
            note = `Adding ${score.specificityScore <= 0 ? 'specificity and ' : ''}urgency could improve CTR.`;
        } else {
            status = 'OFF_GOAL';
            headline = `"${clip(cta.text, 40)}" is off-goal (score ${score.totalScore}/10)`;
            detail = `This ${cta.type} at ${cta.position}% does not advance the primary goal${goal ? ` of "${goal}"` : ''}. ${score.goalScore <= 0 ? 'The wording focuses on a different action.' : 'Position or framing reduces its effectiveness.'}`;
            was = cta.text;
            now = goal ? `${strongVerbs[0]} ${goal}` : 'Realign with page objective';
            note = `Users may be confused about the primary action.`;
        }

        items.push({
            status,
            headline,
            detail,
            was,
            now,
            note,
            source: sourceName
        });
    }

    // Add distribution findings
    if (distribution.total === 0) {
        items.push({
            status: 'FAIL',
            headline: 'No calls-to-action detected in content',
            detail: `Analysis found zero CTAs in the provided content. This could indicate non-standard HTML formatting or content that lacks explicit calls-to-action. Review the source material manually.`,
            was: '',
            now: 'Add at least 2-3 CTAs distributed across the page',
            note: 'Pages without CTAs have near-zero conversion rates.',
            source: sourceName
        });
    } else {
        if (!distribution.firstIn25) {
            items.push({
                status: 'GAP',
                headline: 'No CTA in the critical first 25% of content',
                detail: 'The prime real estate above the fold (first 25% of scroll depth) contains zero calls-to-action. Users must scroll past initial brand messaging before finding a way to convert.',
                was: '',
                now: 'Place a primary CTA within the first 25% of content',
                note: 'First-visit conversions drop 40% when CTAs appear below the fold.',
                source: sourceName
            });
        }

        if (distribution.largestGap > 40) {
            items.push({
                status: 'GAP',
                headline: `${distribution.largestGap}% gap between CTAs creates dead zone`,
                detail: `The largest gap between consecutive calls-to-action spans ${distribution.largestGap}% of the page. Users scrolling through this section have no action to take, increasing bounce risk.`,
                was: '',
                now: `Insert a CTA midway through the ${distribution.largestGap}% gap`,
                note: 'Every 10% without a CTA increases bounce probability by 5-8%.',
                source: sourceName
            });
        }

        if (distribution.isConfusingRepetition) {
            items.push({
                status: 'MIX',
                headline: `${distribution.total} different CTAs create choice paralysis`,
                detail: `With ${distribution.total} unique calls-to-action and minimal repetition, users face decision fatigue. Research shows 3-4 consistent CTAs outperform 7+ varied ones by 25% in conversion.`,
                was: `${distribution.total} unique CTA texts`,
                now: 'Consolidate to 3 core CTAs with consistent messaging',
                note: 'Reduce cognitive load by standardizing primary action phrases.',
                source: sourceName
            });
        }

        if (distribution.hasRepetition && distribution.repetitionCount >= 2) {
            items.push({
                status: 'STRONG',
                headline: `"${clip(distribution.repetitionText, 30)}" repeated ${distribution.repetitionCount}x reinforces message`,
                detail: `The consistent repetition of "${clip(distribution.repetitionText, 40)}" across ${distribution.repetitionCount} positions creates brand recall and clear conversion path. Users see the same action language throughout their journey.`,
                was: distribution.repetitionText,
                now: distribution.repetitionText,
                note: '3-5 repetitions of the primary CTA is the industry best practice.',
                source: sourceName
            });
        }
    }

    return items;
}

// =============================================================================
// HELPER: RENDER
// =============================================================================

function renderFindings(items) {
    // Calculate column widths
    const statusWidth = Math.max(...Object.values(STATUS).map(s => s.label.length)) + 4; // glyph + 2 spaces + label
    const headlineWidth = 60;
    const wasWidth = 30;
    const nowWidth = 30;
    const noteWidth = 30;
    const sourceWidth = 25;

    // Header
    const header = bold(
        pad('Status', statusWidth) +
        pad('Headline', headlineWidth) +
        pad('Before', wasWidth) +
        pad('After', nowWidth) +
        pad(NOTE_LABEL, noteWidth) +
        pad('Source', sourceWidth)
    );
    out(header);
    out('-'.repeat(statusWidth + headlineWidth + wasWidth + nowWidth + noteWidth + sourceWidth));

    for (const item of items) {
        const s = STATUS[item.status];
        const colorFn = C[s.color];
        const statusStr = C.dim(s.glyph + ' ') + colorFn(pad(s.label, statusWidth - 2));
        const headlineStr = C.text(clip(item.headline, headlineWidth));
        const wasStr = pad(clip(item.was, wasWidth), wasWidth);
        const nowStr = pad(clip(item.now, nowWidth), nowWidth);
        const noteStr = pad(clip(item.note, noteWidth), noteWidth);
        const sourceStr = clip(item.source, sourceWidth);

        out(
            statusStr +
            C.text(headlineStr) +
            C.dim(wasStr) +
            C.text(nowStr) +
            noteStr +
            C.dim(sourceStr)
        );
    }
}

function renderSummary(items, htmlPath) {
    // Count by status
    const counts = {};
    for (const key of Object.keys(STATUS)) {
        counts[key] = items.filter(i => i.status === key).length;
    }

    out('\n' + bold('Summary:'));
    const total = items.length;
    out(`  Total ${ITEM_NOUN}s: ${total}`);

    const maxLabelLen = Math.max(...Object.values(STATUS).map(s => s.label.length));
    for (const [key, info] of Object.entries(STATUS)) {
        const count = counts[key] || 0;
        const label = pad(info.label, maxLabelLen);
        const colorFn = C[info.color];
        if (count > 0) {
            out(`  ${info.glyph} ${colorFn(label)} : ${count}`);
        }
    }

    if (htmlPath) {
        out(`  HTML Report: ${htmlPath}`);
    } else {
        out(C.dim('  (no HTML report generated)'));
    }

    const note = SUMMARY_NOTE(items);
    if (note) {
        out(`  ${C.text(note)}`);
    }
}

// =============================================================================
// HELPER: BUILD HTML
// =============================================================================

function buildHTML({ subject, body }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CTA Analysis: ${subject}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #333; line-height: 1.6; }
  h1 { border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #f5f5f5; font-weight: 600; }
  .status-STRONG { color: #2e7d32; }
  .status-WEAK { color: #f57f17; }
  .status-OFF_GOAL { color: #c62828; }
  .status-GAP { color: #00838f; }
  .status-MIX { color: #f57f17; }
  .status-FAIL { color: #b71c1c; }
  .glyph { font-family: monospace; display: inline-block; width: 1.5em; }
  .detail { font-size: 0.9em; color: #666; margin: 0.3em 0; }
  .note { font-size: 0.85em; color: #999; font-style: italic; margin: 0.2em 0; }
  .was, .now { font-family: monospace; font-size: 0.9em; background: #f9f9f9; padding: 2px 6px; border-radius: 3px; }
  .source { font-size: 0.8em; color: #888; word-break: break-all; }
  .summary { background: #f0f7f0; padding: 1em; border-radius: 8px; margin-top: 1em; }
</style>
</head>
<body>
<h1>CTA Analysis: ${subject}</h1>
<table>
<thead>
<tr><th>Status</th><th>Finding</th><th>Before</th><th>After</th><th>Impact</th><th>Source</th></tr>
</thead>
<tbody>
${body}
</tbody>
</table>
<p class="summary">Analysis complete. Review each finding for actionable improvements.</p>
</body>
</html>`;
}

// =============================================================================
// MAIN: RUN
// =============================================================================

async function run(input, sourceName, goal) {
    line('Fetching content...');
    const content = await fetchContent(input);
    endline();

    line('Analyzing CTAs...');
    const ctas = analyzeCTAs(content, goal);
    endline();

    line('Scoring CTAs...');
    // Scoring happens inside generateItems
    endline();

    line('Analyzing distribution...');
    const distribution = analyzeDistribution(ctas, content.length);
    endline();

    line('Generating findings...');
    const computedItems = generateItems(ctas, distribution, goal, sourceName);
    endline();

    // Try to get API alignment if key available
    if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) {
        try {
            line('Calling AI for alignment analysis...');
            const system = `You are a CTA analysis expert. Analyze the following CTAs for alignment with the goal "${goal || 'conversion'}" and provide your assessment.`;
            const prompt = `CTAs found:\n${JSON.stringify(ctas.map(c => ({ text: c.text, position: c.position, type: c.type })))}\n\nGoal: ${goal || 'general conversion'}\n\nProvide analysis as JSON with key "alignment" (string) and "ctas" array of objects with keys "text", "verdict" (strong|weak|off-goal), "rewrite", "why".`;

            const result = await ask(null, { system, prompt, maxTokens: 6000 });
            const data = parseJSON(result);
            
            // Merge AI findings into computed items
            if (data && data.ctas) {
                for (const aiCta of data.ctas) {
                    const match = computedItems.find(i => i.was && i.was.toLowerCase().includes(aiCta.text.toLowerCase()));
                    if (match && aiCta.verdict !== 'strong') {
                        match.status = aiCta.verdict.toUpperCase();
                        match.now = aiCta.rewrite || match.now;
                        match.note = aiCta.why || match.note;
                    }
                }
            }
            endline();
        } catch (e) {
            endline();
            out(C.dim(`AI alignment call failed: ${e.message}. Using computed metrics only.`));
        }
    } else {
        out(C.dim(NO_SEARCH_NOTE));
    }

    return computedItems;
}

// =============================================================================
// MAIN: RUN DEMO
// =============================================================================

async function runDemo(writeHTML) {
    line('Running demo...');
    endline();

    line('Loading demo data...');
    endline();

    line('Analyzing CTAs (simulated)...');
    endline();

    line('Generating findings...');
    const items = DEMO;
    endline();

    renderFindings(items);

    let htmlPath = null;
    if (writeHTML) {
        htmlPath = './cta-analyzer-demo.html';
        const htmlRows = items.map(item => {
            const s = STATUS[item.status];
            return `<tr><td class="status-${item.status}"><span class="glyph">${s.glyph}</span>${s.label}</td><td><strong>${item.headline}</strong><div class="detail">${item.detail}</div><div class="note">→ ${item.note}</div></td><td class="was">${item.was || '-'}</td><td class="now">${item.now || '-'}</td><td class="note">${item.note}</td><td class="source">${item.source}</td></tr>`;
        }).join('\n');
        const html = buildHTML({ subject: 'Demo Page', body: htmlRows });
        const fs = require('fs');
        fs.writeFileSync(htmlPath, html);
    }

    renderSummary(items, htmlPath);
}

// =============================================================================
// ENTRY POINT
// =============================================================================

async function main() {
    const args = process.argv.slice(2);
    const help = args.includes('--help');
    const demo = args.includes('--demo');

    if (help) {
        out(bold('CTA Analyzer'));
        out(`  ${PITCH}\n`);
        out(bold('Usage:'));
        out(`  node ${process.argv[1]} <input>`);
        out(`  node ${process.argv[1]} --demo`);
        out(`  node ${process.argv[1]} --help\n`);
        out(bold('Arguments:'));
        for (const [arg, desc] of USAGE) {
            out(`  ${pad(arg, 12)} ${desc}`);
        }
        return;
    }

    if (demo) {
        const writeHTML = args.includes('--html') || args.includes('--report');
        await runDemo(writeHTML);
        return;
    }

    // Get input
    let input = args[0];
    let sourceName = input || 'stdin';
    let goal = '';
    
    // Parse optional goal (word after --goal)
    const goalIndex = args.indexOf('--goal');
    if (goalIndex !== -1 && args[goalIndex + 1]) {
        goal = args[goalIndex + 1];
    }

    if (!input || input === '-') {
        // Read stdin
        const fs = require('fs');
        input = fs.readFileSync(0, 'utf-8');
        sourceName = 'stdin';
    }

    try {
        const items = await run(input, sourceName, goal);
        
        out('');
        renderFindings(items);

        // Optionally write HTML report
        let htmlPath = null;
        const writeHTML = args.includes('--html') || args.includes('--report');
        if (writeHTML) {
            const safeName = sourceName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20) || 'analysis';
            htmlPath = `./cta-analyzer-${safeName}.html`;
            const htmlRows = items.map(item => {
                const s = STATUS[item.status];
                return `<tr><td class="status-${item.status}"><span class="glyph">${s.glyph}</span>${s.label}</td><td><strong>${item.headline}</strong><div class="detail">${item.detail}</div><div class="note">→ ${item.note}</div></td><td class="was">${item.was || '-'}</td><td class="now">${item.now || '-'}</td><td class="note">${item.note}</td><td class="source">${item.source}</td></tr>`;
            }).join('\n');
            const html = buildHTML({ subject: sourceName, body: htmlRows });
            const fs = require('fs');
            fs.writeFileSync(htmlPath, html);
        }

        renderSummary(items, htmlPath);
    } catch (e) {
        console.error(C.red(`Error: ${e.message}`));
        process.exit(1);
    }
}

// Run
main().catch(e => {
    console.error(C.red(`Fatal error: ${e.message}`));
    process.exit(1);
});
