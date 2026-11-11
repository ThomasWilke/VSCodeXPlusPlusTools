'use strict';

/**
 * Formatter for Dynamics 365 F&O AOT metadata XML (AxClass, AxTable, AxForm, ...).
 *
 *  1. X++ code in <Source><![CDATA[...]]> and <Declaration><![CDATA[...]]> is
 *     formatted with the X++ formatter, keeping its base indentation and the
 *     leading/trailing blank lines the D365 tooling writes.
 *  2. The XML element structure is re-indented line by line. Element content,
 *     attributes, comments and CDATA sections are never reflowed.
 */

const { formatXpp } = require('./xppFormatter');

const XPP_CDATA_RE = /(<(Source|Declaration)>[ \t]*<!\[CDATA\[)([\s\S]*?)(\]\]>)/g;

function widthOf(ws, tabSize) {
    let w = 0;
    for (const ch of ws) w = ch === '\t' ? w + tabSize - (w % tabSize) : w + 1;
    return w;
}

function formatEmbedded(code, xppOptions) {
    if (!code.includes('\n')) return code;
    const lines = code.split('\n');
    const first = lines.findIndex(l => l.trim() !== '');
    if (first < 0) return code;
    let last = lines.length - 1;
    while (lines[last].trim() === '') last--;

    const tabSize = xppOptions.tabSize || 4;
    const baseIndent = widthOf(/^[ \t]*/.exec(lines[first])[0], tabSize);
    const core = lines.slice(first, last + 1).join('\n');
    const formatted = formatXpp(core, { ...xppOptions, baseIndent, eol: '\n' });

    const head = lines.slice(0, first).map(() => '');
    const tail = lines.slice(last + 1).map((l, idx, arr) => (idx === arr.length - 1 ? l : ''));
    return [...head, formatted, ...tail].join('\n');
}

function reindentXml(src, opts) {
    const tabSize = opts.tabSize || 4;
    const unitStr = opts.insertSpaces ? ' '.repeat(tabSize) : '\t';
    const lines = src.split('\n');
    const out = [];
    let mode = 'text'; // text | tag | comment | cdata | pi | decl
    let quote = null;
    let closingTag = false;
    let depth = 0;

    for (const raw of lines) {
        let line = raw;
        if (mode === 'text') {
            const body = raw.replace(/^[ \t]+/, '');
            if (body.trim() === '') {
                out.push('');
                continue;
            }
            const d = body.startsWith('</') ? Math.max(0, depth - 1) : depth;
            line = unitStr.repeat(d) + body;
        }

        let i = 0;
        const s = line;
        while (i < s.length) {
            if (mode === 'text') {
                if (s.startsWith('<!--', i)) { mode = 'comment'; i += 4; }
                else if (s.startsWith('<![CDATA[', i)) { mode = 'cdata'; i += 9; }
                else if (s.startsWith('<?', i)) { mode = 'pi'; i += 2; }
                else if (s.startsWith('<!', i)) { mode = 'decl'; i += 2; }
                else if (s.startsWith('</', i)) { mode = 'tag'; closingTag = true; i += 2; }
                else if (s[i] === '<') { mode = 'tag'; closingTag = false; i += 1; }
                else i++;
                continue;
            }
            const closer = { comment: '-->', cdata: ']]>', pi: '?>', decl: '>' }[mode];
            if (closer) {
                const j = s.indexOf(closer, i);
                if (j < 0) { i = s.length; } else { mode = 'text'; i = j + closer.length; }
                continue;
            }
            // mode === 'tag'
            const c = s[i];
            if (quote) {
                if (c === quote) quote = null;
            } else if (c === '"' || c === "'") {
                quote = c;
            } else if (c === '>') {
                if (closingTag) depth = Math.max(0, depth - 1);
                else if (s[i - 1] !== '/') depth++;
                mode = 'text';
            }
            i++;
        }
        if (mode === 'text') line = line.replace(/[ \t]+$/, '');
        out.push(line);
    }
    return out.join('\n');
}

/**
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.tabSize=4]            XML structure indent size
 * @param {boolean} [opts.insertSpaces=false]  XML structure indents with spaces instead of tabs
 * @param {boolean} [opts.formatEmbeddedCode=true]
 * @param {boolean} [opts.formatStructure=true]
 * @param {object} [opts.xpp]                  options passed to formatXpp for embedded code
 * @param {string} [opts.eol]
 */
function formatAotXml(text, opts = {}) {
    const eol = opts.eol || (text.includes('\r\n') ? '\r\n' : '\n');
    let src = text.replace(/\r\n?/g, '\n');
    if (opts.formatEmbeddedCode !== false) {
        const xppOptions = { tabSize: 4, insertSpaces: true, ...(opts.xpp || {}) };
        src = src.replace(XPP_CDATA_RE, (m, open, tag, code, close) => open + formatEmbedded(code, xppOptions) + close);
    }
    if (opts.formatStructure !== false) src = reindentXml(src, opts);
    return src.split('\n').join(eol);
}

module.exports = { formatAotXml };
