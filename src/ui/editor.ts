import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/edcore.main'; // editor features (find, suggest, hover) without bundled languages
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { KEYWORDS } from '../lang/lexer';
import { API_DOCS } from '../sim/apiDocs';
import type { ScriptFile } from '../sim/world';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const LANGUAGE = 'beescript';

monaco.languages.register({ id: LANGUAGE });
monaco.languages.setMonarchTokensProvider(LANGUAGE, {
  keywords: [...KEYWORDS],
  api: API_DOCS.map(d => d.name),
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, 'string'],
      [/\d+(\.\d+)?/, 'number'],
      [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@api': 'api', '@default': 'identifier' } }],
    ],
  },
} as monaco.languages.IMonarchLanguage);
monaco.languages.setLanguageConfiguration(LANGUAGE, {
  comments: { lineComment: '#' },
  brackets: [['(', ')'], ['[', ']']],
  autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' }],
  // indent after a line ending in ":" (if, while, def...)
  onEnterRules: [{ beforeText: /:\s*(#.*)?$/, action: { indentAction: monaco.languages.IndentAction.Indent } }],
});
const fileOf = (model: monaco.editor.ITextModel): ScriptFile => (model.uri.path === '/queen.bee' ? 'queen' : 'forager');

monaco.languages.registerCompletionItemProvider(LANGUAGE, {
  provideCompletionItems(model, position) {
    const file = fileOf(model);
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const { CompletionItemKind, CompletionItemInsertTextRule } = monaco.languages;
    return {
      suggestions: [
        ...API_DOCS.filter(d => !d.only || d.only === file).map(d => ({
          label: d.name,
          kind: d.constant ? CompletionItemKind.Constant : CompletionItemKind.Function,
          detail: d.signature,
          documentation: d.doc,
          insertText: d.insert,
          insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
        ...[...KEYWORDS].map(k => ({ label: k, kind: CompletionItemKind.Keyword, insertText: k, range })),
      ],
    };
  },
});
monaco.languages.registerHoverProvider(LANGUAGE, {
  provideHover(model, position) {
    const word = model.getWordAtPosition(position);
    const file = fileOf(model);
    const doc = word && API_DOCS.find(d => d.name === word.word && (!d.only || d.only === file));
    return doc ? { contents: [{ value: '`' + doc.signature + '`' }, { value: doc.doc }] } : null;
  },
});
monaco.editor.defineTheme('hive', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'F2B632' },
    { token: 'api', foreground: '9BD37E' },
    { token: 'string', foreground: 'E8A57A' },
    { token: 'number', foreground: 'E8A57A' },
    { token: 'comment', foreground: '8A836C', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#1C1810',
    'editor.lineHighlightBackground': '#262015',
    'editorLineNumber.foreground': '#6E6650',
    'editorLineNumber.activeForeground': '#CDB98A',
    'editorCursor.foreground': '#F2B632',
    'editor.selectionBackground': '#5A4A2A',
  },
});

export interface CodeEditor {
  getValue(file: ScriptFile): string;
  /** Switches the editor to a file. */
  show(file: ScriptFile): void;
  onShow(listener: (file: ScriptFile) => void): void;
  onChange(listener: (file: ScriptFile, code: string) => void): void;
  onRun(listener: () => void): void;
  setError(error: { file: ScriptFile; line: number; message: string } | null): void;
  /** Highlights the line being run in one file (null clears it). */
  setActiveLine(file: ScriptFile | null, line: number | null): void;
}

const FILES: ScriptFile[] = ['forager', 'queen'];

export function createEditor(host: HTMLElement, initial: Record<ScriptFile, string>): CodeEditor {
  const models = {} as Record<ScriptFile, monaco.editor.ITextModel>;
  for (const f of FILES) models[f] = monaco.editor.createModel(initial[f], LANGUAGE, monaco.Uri.parse(`file:///${f}.bee`));
  const editor = monaco.editor.create(host, {
    model: models.forager,
    theme: 'hive',
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    fontSize: 14,
    lineHeight: 22,
    tabSize: 4,
    insertSpaces: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 10 },
  });
  const showListeners: ((file: ScriptFile) => void)[] = [];
  const highlights = { forager: [] as string[], queen: [] as string[] };
  let active: { file: ScriptFile | null; line: number | null } = { file: null, line: null };

  const show = (file: ScriptFile) => {
    if (editor.getModel() === models[file]) return;
    editor.setModel(models[file]);
    showListeners.forEach(l => l(file));
  };

  return {
    getValue: file => models[file].getValue(),
    show,
    onShow: listener => {
      showListeners.push(listener);
    },
    onChange: listener => {
      for (const f of FILES) models[f].onDidChangeContent(() => listener(f, models[f].getValue()));
    },
    onRun: listener => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, listener);
    },
    setError: error => {
      for (const f of FILES) monaco.editor.setModelMarkers(models[f], 'hive', []);
      if (!error) return;
      const model = models[error.file];
      const line = Math.min(Math.max(error.line, 1), model.getLineCount());
      monaco.editor.setModelMarkers(model, 'hive', [{
        startLineNumber: line,
        endLineNumber: line,
        startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
        endColumn: model.getLineMaxColumn(line),
        message: error.message,
        severity: monaco.MarkerSeverity.Error,
      }]);
      show(error.file);
      editor.revealLineInCenterIfOutsideViewport(line);
    },
    setActiveLine: (file, line) => {
      if (file === active.file && line === active.line) return;
      active = { file, line };
      for (const f of FILES) {
        const on = f === file && line ? [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'active-line', linesDecorationsClassName: 'active-line-gutter' } }] : [];
        highlights[f] = models[f].deltaDecorations(highlights[f], on);
      }
    },
  };
}
