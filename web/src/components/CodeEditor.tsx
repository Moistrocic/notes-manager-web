import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo as redoCommand,
  selectAll as selectAllCommand,
  undo as undoCommand,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting, type TagStyle } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import {
  Bold,
  ClipboardPaste,
  Code2,
  Copy,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Scissors,
  Strikethrough,
  TextSelect,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CODE_FONT_SIZE, codeTagStyles } from '../lib/code-theme';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';

/**
 * Token colours.
 *
 * The prose part follows the app's palette. The code part is not defined here:
 * it comes from lib/code-theme.ts, which the preview pane renders from as well,
 * so a fenced block cannot look different depending on which pane you read it
 * in. CodeMirror picks the first matching rule, so prose is listed first.
 */
const darkProse: TagStyle[] = [
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
  { tag: t.heading, color: '#569cd6', fontWeight: '700' },
];

const lightProse: TagStyle[] = [
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
  { tag: t.heading, color: '#0000ff', fontWeight: '700' },
];

const darkHighlight = HighlightStyle.define([...darkProse, ...codeTagStyles(true)]);
const lightHighlight = HighlightStyle.define([...lightProse, ...codeTagStyles(false)]);

const transparentTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', height: '100%', fontSize: CODE_FONT_SIZE },
  // The bottom margin is room to type in, not room to scroll through: it keeps
  // the last line off the edge of the pane. Deliberately modest, and in one
  // place - the scroll sync reads it back and leaves it out of the progress, so
  // a page of it only made the two panes look like they disagreed about where
  // the note ends.
  '.cm-content': { caretColor: 'var(--accent)', padding: '20px 8px 12vh 4px' },
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
  /**
   * The element CodeMirror itself scrolls, for a pane that wants to follow
   * this one's progress. Null before the view exists.
   */
  scrollElement: () => HTMLElement | null;
  /* --- what the right-click menu drives ---------------------------------- */
  undo: () => void;
  redo: () => void;
  cut: () => Promise<void>;
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  selectAll: () => void;
}

/**
 * What copy and cut should take.
 *
 * A selection, or - when there is none - the line the caret sits on, which is
 * what the native commands do and what every other editor does. The newline is
 * included so cutting a whole line does not leave an empty one behind.
 */
function clipboardRange(view: EditorView): { from: number; to: number; text: string } {
  const { from, to } = view.state.selection.main;
  if (from !== to) return { from, to, text: view.state.sliceDoc(from, to) };
  const line = view.state.doc.lineAt(from);
  const end = line.to < view.state.doc.length ? line.to + 1 : line.to;
  return { from: line.from, to: end, text: view.state.sliceDoc(line.from, end) };
}

/**
 * The clipboard API, if this environment has one.
 *
 * Optional chaining rather than a plain read: jsdom does not implement
 * `navigator.clipboard` at all, and a browser only offers it in a secure
 * context - a menu item must not throw over either.
 */
function clipboardApi(): Clipboard | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.clipboard;
}

/**
 * A last resort that predates the clipboard API.
 *
 * `execCommand` is deprecated and absent from jsdom, so the function checks
 * for it and swallows whatever it throws. In a browser it fires a `copy` event
 * that CodeMirror itself answers with the editor's selection, which is why the
 * view is focused first: the menu click took the focus away.
 */
function legacyClipboardCommand(command: 'copy' | 'cut' | 'paste'): boolean {
  try {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
    return document.execCommand(command);
  } catch {
    return false;
  }
}

/** Puts text on the clipboard, reporting whether it made it there. */
async function writeClipboard(view: EditorView, text: string): Promise<boolean> {
  const clipboard = clipboardApi();
  const writeText = clipboard?.writeText?.bind(clipboard);
  if (writeText) {
    try {
      await writeText(text);
      return true;
    } catch {
      /* the browser refused (permission, no user gesture): try the old way */
    }
  }
  view.focus();
  return legacyClipboardCommand('copy');
}

/** The clipboard's text, or null when it cannot be read here. */
async function readClipboardText(): Promise<string | null> {
  const clipboard = clipboardApi();
  const readText = clipboard?.readText?.bind(clipboard);
  if (!readText) return null;
  try {
    const text = await readText();
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/**
 * What the right-click menu offers inside a note.
 *
 * Assembled at the moment of the click: the entries carry live state (write
 * permission) and must run against the view that is on screen, not against one
 * captured when the menu component first rendered. Formatting writes to the
 * document, so it is grouped with cut and paste - off for a read-only account,
 * while copy and select-all stay available, that being what such an account can
 * still do.
 */
function editorMenuItems(api: EditorApi, readOnly: boolean): ContextMenuItem[] {
  const format = (id: string, label: string, icon: ReactNode, run: () => void): ContextMenuItem => ({
    id,
    label,
    icon,
    disabled: readOnly,
    run,
  });
  return [
    { id: 'undo', label: '撤销', icon: <Undo2 />, shortcut: 'Ctrl+Z', run: api.undo },
    { id: 'redo', label: '重做', icon: <Redo2 />, shortcut: 'Ctrl+Shift+Z', run: api.redo },
    { id: 'cut', label: '剪切', icon: <Scissors />, shortcut: 'Ctrl+X', disabled: readOnly, separatorBefore: true, run: api.cut },
    { id: 'copy', label: '复制', icon: <Copy />, shortcut: 'Ctrl+C', run: api.copy },
    { id: 'paste', label: '粘贴', icon: <ClipboardPaste />, shortcut: 'Ctrl+V', disabled: readOnly, run: api.paste },
    { id: 'select-all', label: '全选', icon: <TextSelect />, shortcut: 'Ctrl+A', separatorBefore: true, run: api.selectAll },
    { ...format('bold', '加粗', <Bold />, () => api.wrap('**', '**', '粗体')), separatorBefore: true },
    format('italic', '斜体', <Italic />, () => api.wrap('*', '*', '斜体')),
    format('strikethrough', '删除线', <Strikethrough />, () => api.wrap('~~', '~~', '删除线')),
    format('inline-code', '行内代码', <Code2 />, () => api.wrap('`', '`', 'code')),
    format('heading-1', '一级标题', <Heading1 />, () => api.linePrefix('# ')),
    format('heading-2', '二级标题', <Heading2 />, () => api.linePrefix('## ')),
    format('quote', '引用', <Quote />, () => api.linePrefix('> ')),
    format('bullet-list', '无序列表', <List />, () => api.linePrefix('- ')),
    format('ordered-list', '有序列表', <ListOrdered />, () => api.linePrefix('1. ')),
    format('link', '插入链接', <Link2 />, () => api.wrap('[', '](https://)', '链接文字')),
  ];
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  /**
   * Losing the editor. This is the commit point for the body: typing only
   * patches the store, so nothing is written while the user is still going.
   */
  onBlur?: () => void;
  dark: boolean;
  placeholderText?: string;
  apiRef?: { current: EditorApi | null };
  /** Read-only mode for accounts without write permission. */
  readOnly?: boolean;
}

export function CodeEditor({ value, onChange, onSave, onBlur, dark, placeholderText, apiRef, readOnly }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onBlurRef = useRef(onBlur);
  const themeCompartment = useRef(new Compartment());
  const highlightCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const readOnlyRef = useRef(Boolean(readOnly));
  readOnlyRef.current = Boolean(readOnly);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onBlurRef.current = onBlur;

  // One editor, one right-click menu. The hook lives here because every entry
  // it builds a command for is a command on this view.
  const { menu, openMenu, closeMenu } = useContextMenu();

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
        // Reading a ref rather than the prop keeps the extension list stable
        // across renders: the view is built once, and the handler has to call
        // whatever callback the latest render passed in.
        EditorView.domEventHandlers({
          blur: () => {
            onBlurRef.current?.();
            return false;
          },
        }),
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

  /**
   * The commands the editor answers to, bound to the live view.
   *
   * Built once: every method looks the view up through `viewRef` on call, so
   * the object stays valid while the view is created and destroyed beneath it.
   */
  const api = useMemo<EditorApi>(
    () => ({
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
      scrollElement() {
        // The scroller rather than the wrapper: what the other pane has to
        // match is the thing that actually moves.
        return viewRef.current?.scrollDOM ?? null;
      },
      undo() {
        const view = viewRef.current;
        if (!view) return;
        // A no-op with an empty history, and it refuses to run in a read-only
        // editor - both are the command's own rules, not ours to re-invent.
        undoCommand(view);
        view.focus();
      },
      redo() {
        const view = viewRef.current;
        if (!view) return;
        redoCommand(view);
        view.focus();
      },
      selectAll() {
        const view = viewRef.current;
        if (!view) return;
        selectAllCommand(view);
        view.focus();
      },
      async copy() {
        const view = viewRef.current;
        if (!view) return;
        const range = clipboardRange(view);
        if (!range.text) return;
        await writeClipboard(view, range.text);
        view.focus();
      },
      async cut() {
        const view = viewRef.current;
        if (!view || view.state.readOnly) return;
        const range = clipboardRange(view);
        if (!range.text) return;
        // Clipboard first. A cut that could not copy would eat the text.
        if (!(await writeClipboard(view, range.text))) return;
        view.dispatch({
          changes: { from: range.from, to: range.to, insert: '' },
          selection: { anchor: range.from },
          userEvent: 'delete.cut',
        });
        view.focus();
      },
      async paste() {
        const view = viewRef.current;
        if (!view || view.state.readOnly) return;
        const text = await readClipboardText();
        if (text !== null) {
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            userEvent: 'input.paste',
          });
          view.focus();
          return;
        }
        // Nothing readable: the DOM command is the only other door, and it
        // quietly does nothing (jsdom has no `execCommand` at all) rather than
        // throwing inside a menu item.
        view.focus();
        legacyClipboardCommand('paste');
      },
    }),
    [],
  );

  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = api;
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, api]);

  return (
    // Right-clicking inside the note is the editor's own business, so the
    // native menu is replaced here. The preview pane and the rest of the page
    // keep theirs: this wrapper is the editor and nothing else.
    <div
      className="h-full w-full"
      onContextMenu={(event) => {
        event.preventDefault();
        if (!viewRef.current) return;
        openMenu(event, editorMenuItems(api, readOnlyRef.current));
      }}
    >
      <div ref={hostRef} className="h-full w-full" />
      <ContextMenu state={menu} onClose={closeMenu} />
    </div>
  );
}
