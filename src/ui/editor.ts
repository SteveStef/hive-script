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
/** Whether a file is the queen's script; every other file (each role, shared.bee) is a worker script. */
const isQueen = (model: monaco.editor.ITextModel) => model.uri.path === '/queen.bee';
const fits = (only: 'worker' | 'queen' | undefined, model: monaco.editor.ITextModel) => !only || (only === 'queen') === isQueen(model);

monaco.languages.registerCompletionItemProvider(LANGUAGE, {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const { CompletionItemKind, CompletionItemInsertTextRule } = monaco.languages;
    return {
      suggestions: [
        ...API_DOCS.filter(d => fits(d.only, model)).map(d => ({
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
    const doc = word && API_DOCS.find(d => d.name === word.word && fits(d.only, model));
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
  /** Adds a file (a new role's script). */
  addFile(file: ScriptFile, code: string): void;
  /** Removes a file; if it was showing, the editor switches to forager.bee. */
  removeFile(file: ScriptFile): void;
  /** Switches the editor to a file. */
  show(file: ScriptFile): void;
  onShow(listener: (file: ScriptFile) => void): void;
  onChange(listener: (file: ScriptFile, code: string) => void): void;
  onRun(listener: () => void): void;
  setError(error: { file: ScriptFile; line: number; message: string } | null): void;
  /** Highlights the line being run in one file (null clears it). */
  setActiveLine(file: ScriptFile | null, line: number | null): void;
}

/** One Monaco model per script file, keyed by its name without ".bee". */
export function createEditor(host: HTMLElement, initial: Record<ScriptFile, string>): CodeEditor {
  const models = new Map<ScriptFile, monaco.editor.ITextModel>();
  const highlights = new Map<ScriptFile, string[]>();
  const showListeners: ((file: ScriptFile) => void)[] = [];
  const changeListeners: ((file: ScriptFile, code: string) => void)[] = [];
  let active: { file: ScriptFile | null; line: number | null } = { file: null, line: null };

  const addFile = (file: ScriptFile, code: string) => {
    const model = monaco.editor.createModel(code, LANGUAGE, monaco.Uri.parse(`file:///${file}.bee`));
    model.onDidChangeContent(() => changeListeners.forEach(l => l(file, model.getValue())));
    models.set(file, model);
    highlights.set(file, []);
  };
  for (const [file, code] of Object.entries(initial)) addFile(file, code);

  const editor = monaco.editor.create(host, {
    model: models.get('forager')!,
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

  const show = (file: ScriptFile) => {
    const model = models.get(file);
    if (!model || editor.getModel() === model) return;
    editor.setModel(model);
    showListeners.forEach(l => l(file));
  };

  return {
    getValue: file => models.get(file)?.getValue() ?? '',
    addFile,
    removeFile: file => {
      const model = models.get(file);
      if (!model) return;
      if (editor.getModel() === model) show('forager');
      if (active.file === file) active = { file: null, line: null };
      models.delete(file);
      highlights.delete(file);
      model.dispose();
    },
    show,
    onShow: listener => {
      showListeners.push(listener);
    },
    onChange: listener => {
      changeListeners.push(listener);
    },
    onRun: listener => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, listener);
    },
    setError: error => {
      for (const model of models.values()) monaco.editor.setModelMarkers(model, 'hive', []);
      const model = error && models.get(error.file);
      if (!error || !model) return;
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
      for (const [f, model] of models) {
        const on = f === file && line ? [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'active-line', linesDecorationsClassName: 'active-line-gutter' } }] : [];
        highlights.set(f, model.deltaDecorations(highlights.get(f)!, on));
      }
    },
  };
}
