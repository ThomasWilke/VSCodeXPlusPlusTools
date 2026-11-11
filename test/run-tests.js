'use strict';
// Run with plain Node, or with VS Code's runtime:
//   $env:ELECTRON_RUN_AS_NODE=1; & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" test/run-tests.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { formatXpp } = require('../src/xppFormatter');
const { formatAotXml } = require('../src/xmlFormatter');

const root = path.join(__dirname, '..');
let failures = 0;
const verbose = process.argv.includes('--show');

function test(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n${err.message}\n`);
    }
}
const noWs = s => s.replace(/\s+/g, '');

// ---------------------------------------------------------------- formatter
test('formats braces, switch, continuation lines', () => {
    const input = [
        'class   MyClass extends RunBase {',
        'int x;',
        'public void run() {',
        'if(x==1){',
        'info("one");',
        '} else {',
        'switch(x){',
        'case 1:',
        "info('a');",
        'break;',
        'default:',
        'break;',
        '}',
        '}',
        'while select forupdate custTable',
        '    where custTable.AccountNum == "x"',
        '       && custTable.Blocked == CustVendorBlocked::No',
        '{',
        'custTable.delete();',
        '}',
        '}',
        '}',
        ''
    ].join('\n');
    const expected = [
        'class   MyClass extends RunBase',
        '{',
        '    int x;',
        '    public void run()',
        '    {',
        '        if (x == 1)',
        '        {',
        '            info("one");',
        '        }',
        '        else',
        '        {',
        '            switch (x)',
        '            {',
        '                case 1:',
        "                    info('a');",
        '                    break;',
        '                default:',
        '                    break;',
        '            }',
        '        }',
        '        while select forupdate custTable',
        '            where custTable.AccountNum == "x"',
        '               && custTable.Blocked == CustVendorBlocked::No',
        '        {',
        '            custTable.delete();',
        '        }',
        '    }',
        '}',
        ''
    ].join('\n');
    assert.strictEqual(formatXpp(input), expected);
});

test('preserve brace style keeps K&R braces', () => {
    const input = 'void f() {\nif (a) {\nb();\n} else {\nc();\n}\n}\n';
    const expected = 'void f() {\n    if (a) {\n        b();\n    } else {\n        c();\n    }\n}\n';
    assert.strictEqual(formatXpp(input, { braceStyle: 'preserve' }), expected);
});

test('unbraced if/else bodies are indented', () => {
    const input = 'if (a)\nb();\nelse\nc();\nd();\n';
    const expected = 'if (a)\n    b();\nelse\n    c();\nd();\n';
    assert.strictEqual(formatXpp(input), expected);
});

test('strings, comments and macros are untouched', () => {
    const input = [
        'void f()',
        '{',
        '#localmacro.Sel',
        '   select %1 where %1.x==1  ',
        '#endmacro',
        'str s = @"a{',
        '  b}";',
        'str t = "if(x==1){";   // keep(  ) this',
        '}'
    ].join('\n');
    const out = formatXpp(input);
    assert.ok(out.includes('#localmacro.Sel\n   select %1 where %1.x==1  \n#endmacro'), out);
    assert.ok(out.includes('@"a{\n  b}"'), out);
    assert.ok(out.includes('"if(x==1){";   // keep(  ) this'), out);
});

test('tabs option and CRLF are honoured', () => {
    const out = formatXpp('void f()\r\n{\r\nx = 1;\r\n}\r\n', { insertSpaces: false });
    assert.strictEqual(out, 'void f()\r\n{\r\n\tx = 1;\r\n}\r\n');
});

test('attributes do not cause continuation indent', () => {
    const out = formatXpp('[ExtensionOf(classStr(A))]\nfinal class B_Extension\n{\n}\n');
    assert.strictEqual(out, '[ExtensionOf(classStr(A))]\nfinal class B_Extension\n{\n}\n');
});

// ---------------------------------------------------------------- samples
for (const file of ['samples/MyClass.xpp', 'samples/AxClass/MyBatchJob.xml']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const fmt = file.endsWith('.xml') ? t => formatAotXml(t, { insertSpaces: false }) : t => formatXpp(t);
    const once = fmt(text);
    test(`${file}: only whitespace changes`, () => assert.strictEqual(noWs(once), noWs(text)));
    test(`${file}: idempotent`, () => assert.strictEqual(fmt(once), once));
    if (verbose) console.log(`\n----- ${file} -----\n${once}\n`);
}

// ---------------------------------------------------------------- grammars
function collectRegexes(node, out, where) {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
        if ((k === 'match' || k === 'begin' || k === 'end') && typeof v === 'string') out.push({ re: v, where: `${where}.${k}` });
        else collectRegexes(v, out, `${where}.${k}`);
    }
}
for (const g of ['syntaxes/xpp.tmLanguage.json', 'syntaxes/xpp-xml.tmLanguage.json']) {
    test(`${g}: valid JSON and regexes compile`, () => {
        const grammar = JSON.parse(fs.readFileSync(path.join(root, g), 'utf8'));
        const res = [];
        collectRegexes(grammar, res, '');
        for (const { re, where } of res) {
            let src = re.replace(/\\G/g, '');
            let flags = 'u';
            if (src.startsWith('(?i)')) { src = src.slice(4); flags += 'i'; }
            try { new RegExp(src, flags.replace('u', '')); } catch (e) { throw new Error(`${where}: ${e.message}`); }
        }
    });
}

test('package.json grammar/language paths exist', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const files = [pkg.main, ...pkg.contributes.grammars.map(g => g.path), ...pkg.contributes.languages.map(l => l.configuration)];
    for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
});

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exitCode = failures ? 1 : 0;
