'use strict';

const vscode = require('vscode');
const { formatXpp } = require('./src/xppFormatter');
const { formatAotXml } = require('./src/xmlFormatter');

function xppSettings(cfg) {
    return {
        braceStyle: cfg.get('format.braceStyle', 'allman'),
        normalizeSpacing: cfg.get('format.normalizeSpacing', true),
        maxBlankLines: cfg.get('format.maxBlankLines', 2),
        indentCaseLabels: cfg.get('format.indentCaseLabels', true)
    };
}

function eolOf(document) {
    return document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

/** Replace only the changed middle part so cursor and folding survive. */
function minimalEdits(document, original, formatted) {
    if (original === formatted) return [];
    const max = Math.min(original.length, formatted.length);
    let start = 0;
    while (start < max && original.charCodeAt(start) === formatted.charCodeAt(start)) start++;
    let endO = original.length;
    let endF = formatted.length;
    while (endO > start && endF > start && original.charCodeAt(endO - 1) === formatted.charCodeAt(endF - 1)) {
        endO--;
        endF--;
    }
    const range = new vscode.Range(document.positionAt(start), document.positionAt(endO));
    return [vscode.TextEdit.replace(range, formatted.slice(start, endF))];
}

function safeFormat(document, fn) {
    const original = document.getText();
    try {
        return minimalEdits(document, original, fn(original));
    } catch (err) {
        vscode.window.showErrorMessage(`X++ formatter failed: ${err && err.message ? err.message : err}`);
        return [];
    }
}

function activate(context) {
    const xppProvider = {
        provideDocumentFormattingEdits(document, options) {
            const cfg = vscode.workspace.getConfiguration('xpp', document.uri);
            if (!cfg.get('format.enable', true)) return [];
            return safeFormat(document, text => formatXpp(text, {
                ...xppSettings(cfg),
                tabSize: options.tabSize,
                insertSpaces: options.insertSpaces,
                eol: eolOf(document)
            }));
        }
    };

    const xmlProvider = {
        provideDocumentFormattingEdits(document, options) {
            const cfg = vscode.workspace.getConfiguration('xpp', document.uri);
            const embedded = cfg.get('format.enable', true) && cfg.get('xml.formatEmbeddedCode', true);
            return safeFormat(document, text => formatAotXml(text, {
                tabSize: options.tabSize,
                insertSpaces: options.insertSpaces,
                formatEmbeddedCode: embedded,
                formatStructure: cfg.get('xml.formatStructure', true),
                eol: eolOf(document),
                xpp: {
                    ...xppSettings(cfg),
                    tabSize: cfg.get('xml.embeddedIndentSize', 4),
                    insertSpaces: true
                }
            }));
        }
    };

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider({ language: 'xpp' }, xppProvider),
        vscode.languages.registerDocumentFormattingEditProvider({ language: 'xpp-xml' }, xmlProvider)
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
