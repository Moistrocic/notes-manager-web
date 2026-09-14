import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

/**
 * Token colours.
 *
 * The prose part follows the app's palette; the code part follows VS Code's
 * Dark+ theme, so a fenced block looks like the editor people already read code
 * in. Both are one list because CodeMirror picks the first matching rule.
 */
const darkHighlight = HighlightStyle.define([
  // markdown prose
  { tag: t.heading1, color: '#c4b5fd', fontWeight: '700', fontSize: '1.25em' },
  { tag: t.heading2, color: '#a5b4fc', fontWeight: '700', fontSize: '1.12em' },
  { tag: t.heading3, color: '#93c5fd', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], color: '#7dd3fc', fontWeight: '650' },
  { tag: t.strong, color: '#fcd34d', fontWeight: '700' },
  { tag: t.emphasis, color: '#f9a8d4', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#94a3b8' },
  { tag: t.link, color: '#67e8f9', textDecoration: 'underline' },
  { tag: t.url, color: '#5eead4' },
  { tag: t.monospace, color: '#86efac', background: 'rgba(134,239,172,0.08)', borderRadius: '4px' },
  { tag: t.quote, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.list, color: '#c4b5fd' },
  { tag: t.contentSeparator, color: '#64748b' },
  { tag: t.processingInstruction, color: '#7c8aa8' },

  // code, VS Code Dark+
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: '#c586c0' },
  { tag: [t.definitionKeyword, t.modifier, t.self], color: '#569cd6' },
  { tag: [t.string, t.special(t.string), t.character], color: '#ce9178' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#b5cea8' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6a9955', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#dcdcaa' },
  { tag: [t.className, t.typeName, t.namespace], color: '#4ec9b0' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#9cdcfe' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: '#9cdcfe' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#d4d4d4' },
  { tag: [t.tagName], color: '#569cd6' },
  { tag: [t.attributeValue], color: '#ce9178' },
  { tag: [t.regexp], color: '#d16969' },
  { tag: [t.escape], color: '#d7ba7d' },
  { tag: [t.meta], color: '#c586c0' },
  { tag: [t.invalid], color: '#f44747' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: '#4fc1ff' },
  { tag: [t.heading], color: '#569cd6', fontWeight: '700' },
  { tag: [t.strikethrough, t.deleted], color: '#f44747' },
  { tag: [t.inserted], color: '#b5cea8' },
]);

/** The same, following VS Code's Light+ theme. */
const lightHighlight = HighlightStyle.define([
  // markdown prose
  { tag: t.heading1, color: '#5b21b6', fontWeight: '700', fontSize: '1.25em' },
  { tag: t.heading2, color: '#4338ca', fontWeight: '700', fontSize: '1.12em' },
  { tag: t.heading3, color: '#1d4ed8', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], color: '#0369a1', fontWeight: '650' },
  { tag: t.strong, color: '#b45309', fontWeight: '700' },
  { tag: t.emphasis, color: '#be185d', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#64748b' },
  { tag: t.link, color: '#0e7490', textDecoration: 'underline' },
  { tag: t.url, color: '#0f766e' },
  { tag: t.monospace, color: '#15803d', background: 'rgba(21,128,61,0.08)', borderRadius: '4px' },
  { tag: t.quote, color: '#64748b', fontStyle: 'italic' },
  { tag: t.list, color: '#5b21b6' },
  { tag: t.contentSeparator, color: '#94a3b8' },
  { tag: t.processingInstruction, color: '#94a3b8' },

  // code, VS Code Light+
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: '#af00db' },
  { tag: [t.definitionKeyword, t.modifier, t.self], color: '#0000ff' },
  { tag: [t.string, t.special(t.string), t.character], color: '#a31515' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#098658' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#008000', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#795e26' },
  { tag: [t.className, t.typeName, t.namespace], color: '#267f99' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#001080' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: '#001080' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#3b3b3b' },
  { tag: [t.tagName], color: '#800000' },
  { tag: [t.attributeValue], color: '#a31515' },
  { tag: [t.regexp], color: '#811f3f' },
  { tag: [t.escape], color: '#ee0000' },
  { tag: [t.meta], color: '#af00db' },
  { tag: [t.invalid], color: '#cd3131' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: '#0070c1' },
  { tag: [t.heading], color: '#0000ff', fontWeight: '700' },
  { tag: [t.deleted], color: '#cd3131' },
  { tag: [t.inserted], color: '#098658' },
]);

const transparentTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', height: '100%', fontSize: '14.5px' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '20px 8px 45vh 4px' },
  '.cm-line': { padding: '0 4px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', paddingRight: '6px', paddingLeft: '10px' },
  '.cm-foldGutter span': { color: 'var(--faint)' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-panels': { backgroundColor: 'var(--elevated)', color: 'var(--text)', border: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 55%, transparent)' },
});

export interface EditorApi {
  /** Wraps the current selection with `prefix`/`suffix`. */
  wrap: (prefix: string, suffix?: string, placeholder?: string) => void;
  /** Toggles a line prefix (headings, quotes, lists) on the selected lines. */
  linePrefix: (prefix: string) => void;
  /** Inserts text at the cursor. */
  insert: (text: string) => void;
  /** Scrolls to (and places the cursor on) a 1-based line number. */
  revealLine: (line: number) => void;
  focus: () => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  dark: boolean;
  placeholderText?: string;
  apiRef?: { current: EditorApi | null };
  /** Read-only mode for accounts without write permission. */
  readOnly?: boolean;
}

export function CodeEditor({ value, onChange, onSave, dark, placeholderText, apiRef, readOnly }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const themeCompartment = useRef(new Compartment());
  const highlightCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const readOnlyRef = useRef(Boolean(readOnly));
  readOnlyRef.current = Boolean(readOnly);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        // `codeLanguages` gives fenced blocks the grammar of their language, so
        // ```ts``` is highlighted like TypeScript instead of plain text. The
        // grammars are imported lazily, so only the ones in use are loaded.
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        themeCompartment.current.of(transparentTheme),
        readOnlyCompartment.current.of(
          readOnlyRef.current ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
        highlightCompartment.current.of(
          syntaxHighlighting(dark ? darkHighlight : lightHighlight, { fallback: true }),
        ),
        placeholderText ? placeholder(placeholderText) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the editor in sync when the document is replaced from the outside.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: highlightCompartment.current.reconfigure(
        syntaxHighlighting(dark ? darkHighlight : lightHighlight, { fallback: true }),
      ),
    });
  }, [dark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const extension: Extension = readOnly
      ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
      : [];
    view.dispatch({ effects: readOnlyCompartment.current.reconfigure(extension) });
  }, [readOnly]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      wrap(prefix, suffix = prefix, placeholderText2 = '') {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to) || placeholderText2;
        view.dispatch({
          changes: { from, to, insert: `${prefix}${selected}${suffix}` },
          selection: { anchor: from + prefix.length, head: from + prefix.length + selected.length },
        });
        view.focus();
      },
      linePrefix(prefix) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const startLine = view.state.doc.lineAt(from);
        const endLine = view.state.doc.lineAt(to);
        const changes: { from: number; to: number; insert: string }[] = [];
        for (let n = startLine.number; n <= endLine.number; n += 1) {
          const line = view.state.doc.line(n);
          const existing = line.text.match(/^(#{1,6}\s|>\s?|[-*+]\s|\d+\.\s)/)?.[0] ?? '';
          if (existing === prefix) {
            changes.push({ from: line.from, to: line.from + existing.length, insert: '' });
          } else if (existing) {
            changes.push({ from: line.from, to: line.from + existing.length, insert: prefix });
          } else {
            changes.push({ from: line.from, to: line.from, insert: prefix });
          }
        }
        view.dispatch({ changes });
        view.focus();
      },
      insert(text) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
        view.focus();
      },
      revealLine(line) {
        const view = viewRef.current;
        if (!view) return;
        const total = view.state.doc.lines;
        const target = Math.min(Math.max(line, 1), total);
        const info = view.state.doc.line(target);
        view.dispatch({
          selection: { anchor: info.from },
          effects: EditorView.scrollIntoView(info.from, { y: 'start', yMargin: 24 }),
        });
        view.focus();
      },
      focus() {
        viewRef.current?.focus();
      },
    };
  }, [apiRef]);

  return <div ref={hostRef} className="h-full w-full" />;
}
