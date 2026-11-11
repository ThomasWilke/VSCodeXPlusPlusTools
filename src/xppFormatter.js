'use strict';

/**
 * X++ source formatter.
 *
 * Design goals: never change program text other than whitespace, keep the
 * author's alignment inside statements (e.g. multi-line select statements),
 * and be idempotent (formatting twice yields the same result).
 *
 * Pipeline: tokenize -> logical lines -> (allman brace split) -> (spacing)
 *           -> re-indent from brace / switch / continuation structure.
 */

const KEYWORDS = new Set([
    'if', 'else', 'while', 'do', 'for', 'switch', 'case', 'default', 'break', 'continue', 'return',
    'try', 'catch', 'finally', 'throw', 'retry', 'breakpoint', 'using', 'changecompany', 'unchecked',
    'ttsbegin', 'ttscommit', 'ttsabort',
    'select', 'from', 'where', 'join', 'exists', 'notexists', 'outer', 'forupdate', 'firstonly',
    'firstonly10', 'firstonly100', 'firstonly1000', 'firstfast', 'nofetch', 'crosscompany', 'order',
    'group', 'by', 'asc', 'desc', 'index', 'hint', 'update_recordset', 'insert_recordset', 'delete_from',
    'setting', 'validtimestate', 'pessimisticlock', 'optimisticlock', 'repeatableread', 'forceliterals',
    'forceplaceholders', 'forceselectorder', 'forcenestedloop', 'generateonly', 'reverse', 'sum', 'count',
    'avg', 'minof', 'maxof', 'next', 'flush', 'in',
    'public', 'private', 'protected', 'internal', 'static', 'final', 'abstract', 'virtual', 'const',
    'readonly', 'display', 'edit', 'server', 'client', 'extends', 'implements', 'delegate', 'event',
    'hookable', 'wrappable', 'replaceable',
    'void', 'anytype', 'boolean', 'int', 'int64', 'real', 'str', 'date', 'utcdatetime', 'timeofday',
    'guid', 'container', 'var', 'class', 'interface', 'enum',
    'true', 'false', 'null', 'this', 'super', 'element',
    'new', 'is', 'as', 'mod', 'div', 'like', 'eventhandler', 'print', 'pause', 'window'
]);

const SPACE_BEFORE_PAREN = new Set(['if', 'while', 'for', 'switch', 'catch', 'using']);
const BINARY_OPS = new Set(['=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '|=', '&=', '^=', '&&', '||', '?']);
const MULTI_OPS = ['<<=', '>>=', '::', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '|=', '&=', '^=', '<<', '>>'];
const TERMINATORS = new Set([';', '{', '}', ':']);
const NUM_RE = /^(?:\d{1,2}\\\d{1,2}\\\d{4}|0[xX][0-9a-fA-F]+[uU]?|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[uU]?)/;

const isWs = c => c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === ' ';
const isIdentStart = c => /[\p{L}_]/u.test(c);
const isIdentPart = c => /[\p{L}\p{N}_]/u.test(c);
const isOp = (tok, text) => tok.type === 'op' && tok.text === text;
const lc = s => s.toLowerCase();

function tokenize(src) {
    const tokens = [];
    const n = src.length;
    let i = 0;
    let atLineStart = true;
    const push = (type, start, end) => tokens.push({ type, text: src.slice(start, end) });

    while (i < n) {
        const c = src[i];
        if (c === '\n') {
            push('nl', i, i + 1);
            i++;
            atLineStart = true;
            continue;
        }
        if (isWs(c)) {
            let j = i + 1;
            while (j < n && isWs(src[j])) j++;
            push('ws', i, j);
            i = j;
            continue;
        }
        const startOfLine = atLineStart;
        atLineStart = false;

        // comments
        if (c === '/' && src[i + 1] === '/') {
            let j = src.indexOf('\n', i);
            if (j < 0) j = n;
            push('comment', i, j);
            i = j;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            let j = src.indexOf('*/', i + 2);
            j = j < 0 ? n : j + 2;
            push('comment', i, j);
            i = j;
            continue;
        }
        // verbatim strings @"..." / @'...' (may span lines, doubled quote = escape)
        if (c === '@' && (src[i + 1] === '"' || src[i + 1] === "'")) {
            const q = src[i + 1];
            let j = i + 2;
            while (j < n) {
                if (src[j] === q) {
                    if (src[j + 1] === q) { j += 2; continue; }
                    j++;
                    break;
                }
                j++;
            }
            push('string', i, j);
            i = j;
            continue;
        }
        // regular strings (single line, backslash escapes)
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && src[j] !== c && src[j] !== '\n') {
                j += (src[j] === '\\' && src[j + 1] !== '\n') ? 2 : 1;
            }
            if (j < n && src[j] === c) j++;
            j = Math.min(j, n);
            push('string', i, j);
            i = j;
            continue;
        }
        // macros / preprocessor
        if (c === '#') {
            if (startOfLine) {
                let end = src.indexOf('\n', i);
                if (end < 0) end = n;
                const m = /^#(\w+)/.exec(src.slice(i, i + 64));
                const name = m ? lc(m[1]) : '';
                if ((name === 'localmacro' || name === 'globalmacro') && !/#endmacro\b/i.test(src.slice(i, end))) {
                    const re = /^[ \t]*#endmacro\b.*$/gim;
                    re.lastIndex = end;
                    const mm = re.exec(src);
                    if (mm) end = mm.index + mm[0].length;
                }
                push('preproc', i, end);
                i = end;
                continue;
            }
            let j = i + 1;
            while (j < n && (isIdentPart(src[j]) || src[j] === '.')) j++;
            push('ident', i, j);
            i = j;
            continue;
        }
        if (isIdentStart(c)) {
            let j = i + 1;
            while (j < n && isIdentPart(src[j])) j++;
            push('ident', i, j);
            i = j;
            continue;
        }
        if (c >= '0' && c <= '9') {
            const m = NUM_RE.exec(src.slice(i, i + 64));
            const len = m ? m[0].length : 1;
            push('number', i, i + len);
            i += len;
            continue;
        }
        const op = MULTI_OPS.find(o => src.startsWith(o, i));
        const len = op ? op.length : 1;
        push('op', i, i + len);
        i += len;
    }
    return tokens;
}

/** Group tokens into logical lines: { indent, items: [{ tok, ws }] }. */
function toLines(tokens) {
    const lines = [];
    let cur = { indent: '', items: [] };
    let pendingWs = '';
    for (const t of tokens) {
        if (t.type === 'nl') {
            lines.push(cur);
            cur = { indent: '', items: [] };
            pendingWs = '';
        } else if (t.type === 'ws') {
            if (cur.items.length === 0) cur.indent += t.text;
            else pendingWs += t.text;
        } else {
            cur.items.push({ tok: t, ws: pendingWs });
            pendingWs = '';
        }
    }
    lines.push(cur);
    return lines;
}

/** Allman style: move a trailing '{' to its own line, split '} else' / '} catch' / '} finally'. */
function splitBraces(lines) {
    const out = [];
    for (let line of lines) {
        for (;;) {
            const it = line.items;
            if (it.length > 1 && isOp(it[0].tok, '}') && it[1].tok.type === 'ident' &&
                /^(else|catch|finally)$/i.test(it[1].tok.text)) {
                out.push({ indent: line.indent, items: [it[0]] });
                line = { indent: line.indent, items: [{ tok: it[1].tok, ws: '' }, ...it.slice(2)] };
                continue;
            }
            const last = it.length - 1;
            if (it.length > 1 && isOp(it[last].tok, '{')) {
                out.push({ indent: line.indent, items: it.slice(0, last) });
                line = { indent: line.indent, items: [{ tok: it[last].tok, ws: '' }] };
                continue;
            }
            break;
        }
        out.push(line);
    }
    return out;
}

/** Adjust the whitespace between tokens of one logical line. */
function normalizeSpacing(line) {
    const it = line.items;
    for (let k = 1; k < it.length; k++) {
        const p = it[k - 1].tok;
        const t = it[k].tok;
        let ws = it[k].ws;
        if (t.type === 'comment' || p.type === 'comment' || t.type === 'preproc') continue;
        // whitespace inside a multi-line verbatim string end is not ours to touch
        if (p.type === 'string' && p.text.includes('\n')) continue;

        if (isOp(p, '(')) ws = '';
        else if (isOp(t, ')')) ws = '';
        else if (isOp(t, ',') || isOp(t, ';')) ws = '';
        else if (isOp(p, ',') || isOp(p, ';')) ws = ws || ' ';
        else if (isOp(t, '(')) {
            if (p.type === 'ident' && SPACE_BEFORE_PAREN.has(lc(p.text))) ws = ' ';
            else if (p.type === 'ident' && !KEYWORDS.has(lc(p.text))) ws = '';
        } else if ((t.type === 'op' && BINARY_OPS.has(t.text)) || (p.type === 'op' && BINARY_OPS.has(p.text))) {
            ws = ws || ' ';
        }
        it[k].ws = ws;
    }
}

function widthOf(ws, tabSize) {
    let w = 0;
    for (const ch of ws) w = ch === '\t' ? w + tabSize - (w % tabSize) : w + 1;
    return w;
}

/**
 * Format X++ source text.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.tabSize=4]
 * @param {boolean} [options.insertSpaces=true]
 * @param {'allman'|'preserve'} [options.braceStyle='allman']
 * @param {boolean} [options.normalizeSpacing=true]
 * @param {number} [options.maxBlankLines=2]
 * @param {boolean} [options.indentCaseLabels=true]
 * @param {number} [options.baseIndent=0]  column of the outermost code level
 * @param {string} [options.eol]           line ending of the result (default: detected)
 */
function formatXpp(text, options = {}) {
    const tabSize = options.tabSize || 4;
    const insertSpaces = options.insertSpaces !== false;
    const unit = tabSize;
    const maxBlank = options.maxBlankLines === undefined ? 2 : Math.max(0, options.maxBlankLines);
    const indentCase = options.indentCaseLabels !== false;
    const baseCol = options.baseIndent || 0;
    const eol = options.eol || (text.includes('\r\n') ? '\r\n' : '\n');
    const src = text.replace(/\r\n?/g, '\n');

    let lines = toLines(tokenize(src));
    if ((options.braceStyle || 'allman') === 'allman') lines = splitBraces(lines);
    if (options.normalizeSpacing !== false) lines.forEach(normalizeSpacing);

    const makeIndent = col => insertSpaces
        ? ' '.repeat(col)
        : '\t'.repeat(Math.floor(col / tabSize)) + ' '.repeat(col % tabSize);

    const shiftBlock = (textBlock, delta) => {
        if (delta === 0) return textBlock;
        return textBlock.split('\n').map((l, idx) => {
            if (idx === 0) return l;
            const m = /^[ \t]*/.exec(l)[0];
            const rest = l.slice(m.length);
            if (rest === '') return '';
            return makeIndent(Math.max(0, widthOf(m, tabSize) + delta)) + rest;
        }).join('\n');
    };

    const out = [];
    const stack = []; // { openerCol, innerCol, caseCol, isSwitch }
    let anchorCol = baseCol;
    let anchorOrig = 0;
    let lastSig = null;
    let prevAttr = false;
    let pendingSwitch = false;
    let blankRun = 0;

    for (const line of lines) {
        const it = line.items;
        if (it.length === 0) {
            blankRun++;
            if (blankRun <= maxBlank) out.push('');
            continue;
        }
        blankRun = 0;

        const first = it[0].tok;
        const top = stack[stack.length - 1];
        const origWidth = widthOf(line.indent, tabSize);
        const codeItems = it.filter(x => x.tok.type !== 'comment' && x.tok.type !== 'preproc');

        const isContinuation = lastSig !== null && !prevAttr && !TERMINATORS.has(lastSig) &&
            !isOp(first, '{') && !isOp(first, '}');

        let col;
        if (isOp(first, '}')) {
            col = top ? top.openerCol : baseCol;
        } else if (top && top.isSwitch && first.type === 'ident' && /^(case|default)$/i.test(first.text)) {
            col = top.caseCol;
        } else if (isContinuation) {
            col = anchorCol + Math.max(unit, origWidth - anchorOrig);
        } else {
            col = top ? top.innerCol : baseCol;
        }
        if (!isContinuation) {
            anchorCol = col;
            anchorOrig = origWidth;
        }

        // structural effects of this line
        for (const x of it) {
            const t = x.tok;
            if (t.type === 'ident' && lc(t.text) === 'switch') {
                pendingSwitch = true;
            } else if (isOp(t, '{')) {
                const base = anchorCol;
                if (pendingSwitch) {
                    stack.push({
                        openerCol: base,
                        isSwitch: true,
                        caseCol: base + (indentCase ? unit : 0),
                        innerCol: base + (indentCase ? 2 * unit : unit)
                    });
                } else {
                    stack.push({ openerCol: base, isSwitch: false, innerCol: base + unit });
                }
                pendingSwitch = false;
            } else if (isOp(t, '}')) {
                stack.pop();
            } else if (isOp(t, ';')) {
                pendingSwitch = false;
            }
        }

        if (codeItems.length > 0) {
            const lastTok = codeItems[codeItems.length - 1].tok;
            lastSig = lastTok.type === 'op' ? lastTok.text : '\u0000';
            prevAttr = isOp(first, '[') && isOp(lastTok, ']');
        }

        let s = makeIndent(col);
        it.forEach((x, k) => {
            let piece = x.tok.text;
            if (k === 0 && x.tok.type === 'comment' && piece.includes('\n')) {
                piece = shiftBlock(piece, col - origWidth);
            }
            s += (k === 0 ? '' : x.ws) + piece;
        });
        out.push(s);
    }

    while (out.length && out[out.length - 1] === '') out.pop();
    if (src.endsWith('\n')) out.push('');
    return out.join('\n').split('\n').join(eol);
}

module.exports = { formatXpp, tokenize };
