import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass as sassLanguage } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { csharp, dart } from "@codemirror/legacy-modes/mode/clike";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { fSharp } from "@codemirror/legacy-modes/mode/mllike";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { closeSearchPanel, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { listen } from "@tauri-apps/api/event";
import { join, tempDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdClose,
  MdDescription,
  MdDoneAll,
  MdKeyboardArrowDown,
  MdOpenInNew,
  MdRefresh,
  MdSave,
} from "react-icons/md";
import { toast } from "sonner";
import ReloadDirtyDialog from "@/components/dialog/remote-file-editor/ReloadDirtyDialog";
import RemoteFileConflictDialog from "@/components/dialog/remote-file-editor/RemoteFileConflictDialog";
import UnsavedChangesDialog from "@/components/dialog/remote-file-editor/UnsavedChangesDialog";
import ChildWindowHeader from "@/components/layout/ChildWindowHeader";
import { languageFromFilename, type RemoteTextFile } from "@/components/panel/file-explorer/model";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/context/AppContext";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { cn, formatSize, parseJsonSearchParam } from "@/lib/utils";

const MAX_EDITOR_FILE_BYTES = 5 * 1024 * 1024;

const editorHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.meta],
    color: "var(--df-text-muted)",
    fontStyle: "italic",
  },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
    ],
    color: "var(--df-primary)",
  },
  {
    tag: [tags.operator, tags.definitionOperator, tags.punctuation, tags.separator],
    color: "var(--df-text-dimmed)",
  },
  {
    tag: [tags.string, tags.docString, tags.character, tags.attributeValue],
    color: "var(--df-success)",
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom],
    color: "var(--df-warning)",
  },
  {
    tag: [tags.regexp, tags.escape, tags.url],
    color: "var(--df-accent)",
  },
  {
    tag: [tags.className, tags.typeName, tags.namespace, tags.tagName],
    color: "color-mix(in srgb, var(--df-link) 72%, var(--df-success))",
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
      tags.definition(tags.propertyName),
    ],
    color: "var(--df-link)",
  },
  {
    tag: [tags.propertyName, tags.attributeName, tags.labelName],
    color: "color-mix(in srgb, var(--df-link) 78%, var(--df-text))",
  },
  {
    tag: [tags.constant(tags.variableName), tags.standard(tags.variableName), tags.macroName],
    color: "color-mix(in srgb, var(--df-warning) 85%, var(--df-text))",
  },
  {
    tag: [tags.deleted, tags.invalid],
    color: "var(--df-danger)",
  },
  {
    tag: [tags.inserted, tags.changed],
    color: "var(--df-success)",
  },
  {
    tag: tags.heading,
    color: "var(--df-primary)",
    fontWeight: "600",
  },
  {
    tag: [tags.emphasis],
    fontStyle: "italic",
  },
  {
    tag: [tags.strong],
    fontWeight: "600",
  },
]);

interface RemoteFileEditorData {
  sessionId: string;
  remotePath: string;
  name: string;
  size: number;
  mtime: number;
}

interface RemoteFileEditorOpenPayload {
  targetLabel?: string;
  data: RemoteFileEditorData;
}

interface EditorTab extends RemoteFileEditorData {
  id: string;
  content: string;
  baseSize: number;
  baseMtime: number;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string;
  lastSavedAt: number | null;
  language: string;
}

interface WriteRemoteFileTextResult {
  status: "saved" | "conflict";
  mtime?: number;
  size?: number;
}

interface CursorPosition {
  line: number;
  column: number;
}

function languageExtension(language: string) {
  switch (language) {
    case "batch":
    case "shell":
      return StreamLanguage.define(shell);
    case "c":
    case "cpp":
      return cpp();
    case "cmake":
      return StreamLanguage.define(cmake);
    case "csharp":
      return StreamLanguage.define(csharp);
    case "css":
    case "less":
      return css();
    case "dart":
      return StreamLanguage.define(dart);
    case "diff":
      return StreamLanguage.define(diff);
    case "dockerfile":
      return StreamLanguage.define(dockerFile);
    case "fsharp":
      return StreamLanguage.define(fSharp);
    case "go":
      return go();
    case "graphql":
      return javascript({ jsx: true, typescript: true });
    case "html":
      return html();
    case "ini":
    case "makefile":
    case "properties":
      return StreamLanguage.define(properties);
    case "java":
    case "kotlin":
      return java();
    case "javascript":
      return javascript({ jsx: true });
    case "json":
    case "json5":
    case "jsonc":
      return json();
    case "lua":
      return StreamLanguage.define(lua);
    case "markdown":
      return markdown();
    case "nginx":
      return StreamLanguage.define(nginx);
    case "perl":
      return StreamLanguage.define(perl);
    case "php":
      return php();
    case "powershell":
      return StreamLanguage.define(powerShell);
    case "protobuf":
      return StreamLanguage.define(protobuf);
    case "python":
      return python();
    case "r":
      return StreamLanguage.define(r);
    case "ruby":
      return StreamLanguage.define(ruby);
    case "rust":
      return rust();
    case "sass":
      return sassLanguage({ indented: true });
    case "scss":
      return sassLanguage();
    case "sql":
      return sql();
    case "svelte":
    case "vue":
      return html();
    case "swift":
      return StreamLanguage.define(swift);
    case "toml":
      return StreamLanguage.define(toml);
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "vb":
      return StreamLanguage.define(vb);
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    default:
      return [];
  }
}

function tabId(data: Pick<RemoteFileEditorData, "sessionId" | "remotePath">) {
  return `${data.sessionId}\n${data.remotePath}`;
}

function getParentDirectoryName(path: string) {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === "/") return "/";
  const parent = normalized.slice(0, normalized.lastIndexOf("/"));
  if (!parent || parent === "/") return "/";
  return parent.slice(parent.lastIndexOf("/") + 1) || "/";
}

function getTabBaseLabel(tab: EditorTab) {
  return tab.name || tab.remotePath.split("/").pop() || tab.remotePath;
}

function getDisplayLanguage(language: string) {
  return language === "plaintext" ? "Plain Text" : language.toLocaleUpperCase();
}

function getCursorPosition(state: EditorState): CursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

function formatRemoteMtime(mtime?: number) {
  if (!mtime) return "";
  const timestamp = mtime < 10_000_000_000 ? mtime * 1000 : mtime;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function createTab(data: RemoteFileEditorData): EditorTab {
  return {
    ...data,
    id: tabId(data),
    content: "",
    baseSize: data.size,
    baseMtime: data.mtime,
    loading: true,
    saving: false,
    dirty: false,
    error: "",
    lastSavedAt: null,
    language: languageFromFilename(data.name || data.remotePath),
  };
}

export default function RemoteFileEditorPage() {
  const { t } = useTranslation();
  const { appSettings } = useApp();
  const initialData = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return parseJsonSearchParam<RemoteFileEditorData>(params.get("data"));
  }, []);
  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const forceCloseRef = useRef(false);
  const suppressEditorUpdateRef = useRef(false);
  const editorStatesRef = useRef<Record<string, EditorState>>({});
  const tabsRef = useRef<EditorTab[]>(initialData ? [createTab(initialData)] : []);
  const activeTabIdRef = useRef(initialData ? tabId(initialData) : "");
  const [tabs, setTabs] = useState<EditorTab[]>(tabsRef.current);
  const [activeTabId, setActiveTabId] = useState(activeTabIdRef.current);
  const [conflictTabId, setConflictTabId] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [reloadConfirmTabId, setReloadConfirmTabId] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ line: 1, column: 1 });

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs],
  );
  const dirtyTabs = useMemo(() => tabs.filter((tab) => tab.dirty), [tabs]);
  const savingTabs = useMemo(() => tabs.filter((tab) => tab.saving), [tabs]);
  const duplicateTabNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      const label = getTabBaseLabel(tab);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);

  const updateTabs = useCallback((updater: (tabs: EditorTab[]) => EditorTab[]) => {
    const next = updater(tabsRef.current);
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const updateTab = useCallback(
    (id: string, updater: (tab: EditorTab) => EditorTab) => {
      updateTabs((current) => current.map((tab) => (tab.id === id ? updater(tab) : tab)));
    },
    [updateTabs],
  );

  const createEditorState = useCallback(
    (content: string, language: string) =>
      EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          foldGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          autocompletion(),
          closeBrackets(),
          syntaxHighlighting(editorHighlightStyle),
          bracketMatching(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          search({ top: true }),
          languageExtension(language),
          rectangularSelection(),
          crosshairCursor(),
          scrollPastEnd(),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...foldKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            const id = activeTabIdRef.current;
            if (!id) return;
            editorStatesRef.current[id] = update.state;
            if (update.docChanged || update.selectionSet) {
              setCursorPosition(getCursorPosition(update.state));
            }
            if (!update.docChanged || suppressEditorUpdateRef.current) return;
            const next = update.state.doc.toString();
            updateTab(id, (tab) => ({ ...tab, content: next, dirty: true }));
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              fontSize: "13px",
            },
            "&.cm-focused": {
              outline: "none",
            },
            ".cm-content": {
              minHeight: "100%",
              caretColor: "var(--foreground)",
              cursor: "text",
              userSelect: "text",
            },
            ".cm-line": {
              cursor: "text",
            },
            ".cm-cursor, .cm-dropCursor": {
              borderLeftColor: "var(--foreground)",
            },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              backgroundColor: "color-mix(in srgb, var(--primary) 28%, transparent)",
            },
            ".cm-scroller": {
              fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
              overflow: "auto",
            },
            ".cm-gutters": {
              backgroundColor: "color-mix(in srgb, var(--muted) 18%, transparent)",
              color: "var(--muted-foreground)",
              borderRightColor: "color-mix(in srgb, var(--border) 70%, transparent)",
            },
            ".cm-foldGutter": {
              width: "1.1rem",
            },
            ".cm-foldGutter span": {
              cursor: "pointer",
              color: "var(--muted-foreground)",
              opacity: "0.45",
              transition: "opacity 120ms ease, color 120ms ease",
            },
            ".cm-foldGutter:hover span": {
              opacity: "0.8",
            },
            ".cm-activeLine": {
              backgroundColor: "color-mix(in srgb, var(--muted) 22%, transparent)",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "color-mix(in srgb, var(--muted) 32%, transparent)",
            },
            ".cm-tooltip": {
              borderColor: "var(--border)",
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
              fontSize: "12px",
              boxShadow: "0 10px 30px rgb(0 0 0 / 0.22)",
            },
            ".cm-tooltip-autocomplete ul li[aria-selected]": {
              backgroundColor: "color-mix(in srgb, var(--primary) 18%, transparent)",
              color: "var(--foreground)",
            },
            ".cm-search": {
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
              borderBottomColor: "var(--border)",
              gap: "0.375rem",
              padding: "0.375rem",
            },
            ".cm-search input": {
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: "0.25rem",
              padding: "0.125rem 0.375rem",
            },
            ".cm-search button": {
              backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: "0.25rem",
              padding: "0.125rem 0.375rem",
            },
          }),
        ],
      }),
    [updateTab],
  );

  const setEditorState = useCallback((state: EditorState) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      suppressEditorUpdateRef.current = true;
      view.setState(state);
    } finally {
      suppressEditorUpdateRef.current = false;
    }
    setCursorPosition(getCursorPosition(state));
    window.requestAnimationFrame(() => view.focus());
  }, []);

  const rememberCurrentEditorState = useCallback(() => {
    const id = activeTabIdRef.current;
    const view = viewRef.current;
    if (!id || !view) return;
    editorStatesRef.current[id] = view.state;
  }, []);

  const activateTab = useCallback(
    (id: string) => {
      rememberCurrentEditorState();
      activeTabIdRef.current = id;
      setActiveTabId(id);
    },
    [rememberCurrentEditorState],
  );

  const loadFile = useCallback(
    async (id: string, fallbackTab?: EditorTab) => {
      const tab = tabsRef.current.find((item) => item.id === id) ?? fallbackTab;
      if (!tab) return;

      updateTab(id, (current) => ({ ...current, loading: true, error: "" }));
      try {
        const result = await invoke<RemoteTextFile>("read_remote_file_text", {
          sessionId: tab.sessionId,
          path: tab.remotePath,
          maxBytes: MAX_EDITOR_FILE_BYTES,
        });
        updateTab(id, (current) => ({
          ...current,
          content: result.content,
          baseSize: result.size,
          baseMtime: result.mtime ?? current.mtime ?? 0,
          size: result.size,
          mtime: result.mtime ?? current.mtime ?? 0,
          loading: false,
          dirty: false,
          error: "",
          lastSavedAt: null,
        }));
        const nextState = createEditorState(result.content, tab.language);
        editorStatesRef.current[id] = nextState;
        if (activeTabIdRef.current === id) {
          setEditorState(nextState);
        }
      } catch (err) {
        updateTab(id, (current) => ({
          ...current,
          loading: false,
          error: getErrorMessage(err) || t("fileEditor.loadFailed"),
        }));
      }
    },
    [createEditorState, setEditorState, t, updateTab],
  );

  const addOrFocusTab = useCallback(
    (data: RemoteFileEditorData) => {
      const id = tabId(data);
      const exists = tabsRef.current.some((tab) => tab.id === id);
      if (!exists) {
        const nextTab = createTab(data);
        updateTabs((current) => [...current, nextTab]);
        void loadFile(id, nextTab);
      }
      activateTab(id);
    },
    [activateTab, loadFile, updateTabs],
  );

  useEffect(() => {
    if (!initialData) return;
    void loadFile(tabId(initialData));
  }, [initialData, loadFile]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    listen<RemoteFileEditorOpenPayload>("remote-file-editor-open", (event) => {
      if (event.payload.targetLabel && event.payload.targetLabel !== currentWindow.label) return;
      addOrFocusTab(event.payload.data);
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [addOrFocusTab]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const title = activeTab
      ? `${activeTab.dirty ? "* " : ""}${activeTab.name || activeTab.remotePath}`
      : t("fileEditor.title");
    currentWindow.setTitle(title).catch(() => {});
  }, [activeTab, t]);

  useEffect(() => {
    const parent = editorParentRef.current;
    if (!parent) return;

    const initialTab = activeTabIdRef.current
      ? tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
      : null;
    const initialState =
      (initialTab && editorStatesRef.current[initialTab.id]) ??
      createEditorState(initialTab?.content ?? "", initialTab?.language ?? "plaintext");
    if (initialTab) {
      editorStatesRef.current[initialTab.id] = initialState;
    }

    const view = new EditorView({
      parent,
      state: initialState,
    });
    viewRef.current = view;
    window.requestAnimationFrame(() => view.focus());

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [createEditorState]);

  useEffect(() => {
    if (!activeTabId) return;
    const currentTab = tabsRef.current.find((tab) => tab.id === activeTabId);
    if (!currentTab) return;
    activeTabIdRef.current = currentTab.id;
    const state =
      editorStatesRef.current[currentTab.id] ??
      createEditorState(currentTab.content, currentTab.language);
    editorStatesRef.current[currentTab.id] = state;
    setEditorState(state);
  }, [activeTabId, createEditorState, setEditorState]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    currentWindow
      .onCloseRequested((event) => {
        if (forceCloseRef.current || dirtyTabs.length === 0) return;
        event.preventDefault();
        setPendingCloseTabId(null);
        setCloseConfirmOpen(true);
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [dirtyTabs.length]);

  const closeWindow = useCallback(() => {
    forceCloseRef.current = true;
    getCurrentWindow()
      .close()
      .catch(() => {});
  }, []);

  const requestReloadTab = useCallback(
    (tab: EditorTab) => {
      if (tab.dirty) {
        setReloadConfirmTabId(tab.id);
        return;
      }
      void loadFile(tab.id);
    },
    [loadFile],
  );

  const saveFile = useCallback(
    async (id: string, force = false) => {
      const tab = tabsRef.current.find((item) => item.id === id);
      if (!tab || tab.saving) return false;
      updateTab(id, (current) => ({ ...current, saving: true, error: "" }));
      try {
        const result = await invoke<WriteRemoteFileTextResult>("write_remote_file_text", {
          sessionId: tab.sessionId,
          path: tab.remotePath,
          content: tab.content,
          expectedMtime: tab.baseMtime,
          expectedSize: tab.baseSize,
          force,
        });
        if (result.status === "conflict") {
          setConflictTabId(id);
          return false;
        }
        updateTab(id, (current) => ({
          ...current,
          baseMtime: result.mtime ?? current.baseMtime,
          baseSize: result.size ?? new Blob([current.content]).size,
          mtime: result.mtime ?? current.mtime,
          size: result.size ?? current.size,
          dirty: false,
          saving: false,
          lastSavedAt: Date.now(),
        }));
        toast.success(t("fileEditor.saved"));
        return true;
      } catch (err) {
        updateTab(id, (current) => ({
          ...current,
          saving: false,
          error: getErrorMessage(err) || t("fileEditor.saveFailed"),
        }));
        return false;
      } finally {
        updateTab(id, (current) => ({ ...current, saving: false }));
      }
    },
    [t, updateTab],
  );

  const saveAllDirty = useCallback(async () => {
    const ids = tabsRef.current.filter((tab) => tab.dirty).map((tab) => tab.id);
    for (const id of ids) {
      const saved = await saveFile(id, false);
      if (!saved) return false;
    }
    return true;
  }, [saveFile]);

  const openExternal = useCallback(
    (tab: EditorTab) => {
      const run = async () => {
        const root = await tempDir();
        const safeName = await invoke<string>("sanitize_download_file_name", { name: tab.name });
        const localPath = await join(
          root,
          "nyaterm",
          tab.sessionId,
          Date.now().toString(),
          safeName,
        );
        await invoke("download_remote_file", {
          sessionId: tab.sessionId,
          remotePath: tab.remotePath,
          localPath,
        });
        await invoke("start_file_watch", {
          sessionId: tab.sessionId,
          localPath,
          remotePath: tab.remotePath,
        });
        await openPath(localPath, appSettings.transfer.default_editor || undefined);
      };
      run().catch((err) => {
        toast.error(getErrorMessage(err) || t("fileEditor.openExternalFailed"));
      });
    },
    [appSettings.transfer.default_editor, t],
  );

  const closeTab = useCallback(
    (id: string, force = false) => {
      const tab = tabsRef.current.find((item) => item.id === id);
      if (!tab) return;
      if (tab.dirty && !force) {
        setPendingCloseTabId(id);
        setCloseConfirmOpen(true);
        return;
      }

      const currentTabs = tabsRef.current;
      if (currentTabs.length <= 1) {
        closeWindow();
        return;
      }

      const index = currentTabs.findIndex((item) => item.id === id);
      const nextTabs = currentTabs.filter((item) => item.id !== id);
      updateTabs(() => nextTabs);
      if (activeTabIdRef.current === id) {
        const nextActive = nextTabs[Math.min(index, nextTabs.length - 1)];
        activeTabIdRef.current = nextActive.id;
        setActiveTabId(nextActive.id);
      }
    },
    [closeWindow, updateTabs],
  );

  const handleDiscard = useCallback(() => {
    if (pendingCloseTabId) {
      closeTab(pendingCloseTabId, true);
      setPendingCloseTabId(null);
      setCloseConfirmOpen(false);
      return;
    }
    closeWindow();
  }, [closeTab, closeWindow, pendingCloseTabId]);

  const handleSaveAndClose = useCallback(async () => {
    if (pendingCloseTabId) {
      const saved = await saveFile(pendingCloseTabId, false);
      if (!saved) return;
      closeTab(pendingCloseTabId, true);
      setPendingCloseTabId(null);
      setCloseConfirmOpen(false);
      return;
    }

    const saved = await saveAllDirty();
    if (!saved) return;
    setCloseConfirmOpen(false);
    closeWindow();
  }, [closeTab, closeWindow, pendingCloseTabId, saveAllDirty, saveFile]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) {
          void saveAllDirty();
        } else if (activeTabIdRef.current) {
          void saveFile(activeTabIdRef.current, false);
        }
      }
      if (event.key === "Escape") {
        const view = viewRef.current;
        if (view) closeSearchPanel(view);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveAllDirty, saveFile]);

  if (!initialData) return null;

  const statusText = activeTab?.saving
    ? t("common.saving")
    : activeTab?.dirty
      ? t("fileEditor.unsaved")
      : activeTab?.lastSavedAt
        ? t("fileEditor.saved")
        : t("fileEditor.ready");
  const pendingCloseHasSaving = pendingCloseTabId
    ? Boolean(tabs.find((tab) => tab.id === pendingCloseTabId)?.saving)
    : savingTabs.length > 0;
  const activeMtimeText = formatRemoteMtime(activeTab?.mtime);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <ChildWindowHeader
        title={`${dirtyTabs.length > 0 ? "* " : ""}${activeTab?.name || t("fileEditor.title")}`}
        icon={<MdDescription className="text-base" />}
        windowControls
        onClose={() => {
          if (dirtyTabs.length > 0) setCloseConfirmOpen(true);
          else closeWindow();
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 overflow-hidden border-b bg-muted/15">
          <div role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-hidden">
            {tabs.map((tab) => {
              const baseLabel = getTabBaseLabel(tab);
              const hasDuplicateName = (duplicateTabNames.get(baseLabel) ?? 0) > 1;
              const tabLabel = hasDuplicateName
                ? `${baseLabel} · ${getParentDirectoryName(tab.remotePath)}`
                : baseLabel;
              const isActive = tab.id === activeTabId;

              return (
                <div
                  role="tab"
                  tabIndex={0}
                  aria-selected={isActive}
                  key={tab.id}
                  className={cn(
                    "group flex h-full min-w-[96px] max-w-[240px] shrink-0 cursor-default items-center gap-2 border-r px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                    isActive
                      ? "border-t border-t-primary/50 border-r-border border-b border-b-background bg-background text-foreground"
                      : "border-r-border/70 border-b border-b-border bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                  )}
                  title={tab.remotePath}
                  onClick={() => activateTab(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    activateTab(tab.id);
                  }}
                >
                  {tab.dirty && <span className="sr-only">{t("fileEditor.unsaved")}</span>}
                  {tab.dirty && (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono">{tabLabel}</span>
                  <button
                    type="button"
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground",
                      isActive ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                    )}
                    aria-label={t("common.close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <MdClose className="text-sm" />
                  </button>
                </div>
              );
            })}
          </div>

          {tabs.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-full w-9 shrink-0 items-center justify-center border-l bg-muted/10 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                  aria-label={t("terminal.openTabs")}
                >
                  <MdKeyboardArrowDown className="text-lg" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {tabs.map((tab) => {
                  const baseLabel = getTabBaseLabel(tab);
                  const hasDuplicateName = (duplicateTabNames.get(baseLabel) ?? 0) > 1;
                  const tabLabel = hasDuplicateName
                    ? `${baseLabel} · ${getParentDirectoryName(tab.remotePath)}`
                    : baseLabel;
                  const isActive = tab.id === activeTabId;

                  return (
                    <DropdownMenuItem
                      key={tab.id}
                      className={cn("items-start gap-2 py-2", isActive && "bg-accent/60")}
                      onClick={() => activateTab(tab.id)}
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          tab.dirty ? "bg-primary" : "bg-transparent",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs text-foreground">
                          {tabLabel}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {tab.remotePath}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex min-h-0 shrink-0 flex-col gap-2 border-b bg-muted/10 px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="min-w-0 truncate font-mono text-xs text-muted-foreground"
            title={activeTab?.remotePath}
          >
            {activeTab?.remotePath}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={!activeTab || activeTab.loading}
              onClick={() => activeTab && requestReloadTab(activeTab)}
            >
              <MdRefresh className="text-sm" />
              {t("fileEditor.reload")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!activeTab || activeTab.loading}
                    onClick={() => activeTab && openExternal(activeTab)}
                  >
                    <MdOpenInNew className="text-sm" />
                    {t("fileEditor.openExternal")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("fileEditor.openExternalTooltip")}</TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={!activeTab || activeTab.saving || activeTab.loading}
              onClick={() => activeTab && void saveFile(activeTab.id, false)}
            >
              <MdSave className="text-sm" />
              {activeTab?.saving ? t("common.saving") : t("common.save")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={dirtyTabs.length === 0 || savingTabs.length > 0}
              onClick={() => void saveAllDirty()}
            >
              <MdDoneAll className="text-sm" />
              {t("fileEditor.saveAll")}
            </Button>
          </div>
        </div>

        {activeTab?.error && (
          <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {activeTab.error}
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          {activeTab?.loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground pointer-events-none">
              {t("common.loading")}
            </div>
          )}
          <div ref={editorParentRef} className="h-full min-h-0" />
        </div>

        <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t bg-muted/15 px-3 font-mono text-[11px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className="shrink-0">
              {getDisplayLanguage(activeTab?.language ?? "plaintext")}
            </span>
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <span className="shrink-0">
              {t("fileEditor.lineColumn", {
                line: cursorPosition.line,
                column: cursorPosition.column,
              })}
            </span>
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <span className="shrink-0">{statusText}</span>
            {dirtyTabs.length > 1 ? (
              <>
                <span aria-hidden="true" className="shrink-0">
                  ·
                </span>
                <span className="truncate">
                  {t("fileEditor.unsavedFilesDesc", { count: dirtyTabs.length })}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span>{formatSize(activeTab?.size ?? 0)}</span>
            <span aria-hidden="true">·</span>
            <span>{t("fileEditor.encodingUtf8")}</span>
            <span aria-hidden="true">·</span>
            <span>{t("fileEditor.lineEndingLf")}</span>
            {activeMtimeText ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("fileEditor.modifiedAt", { time: activeMtimeText })}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <RemoteFileConflictDialog
        open={!!conflictTabId}
        onOpenChange={(open) => {
          if (!open) setConflictTabId(null);
        }}
        onReload={() => {
          const id = conflictTabId;
          setConflictTabId(null);
          if (id) void loadFile(id);
        }}
        onForceSave={() => {
          const id = conflictTabId;
          setConflictTabId(null);
          if (id) void saveFile(id, true);
        }}
      />

      <ReloadDirtyDialog
        open={!!reloadConfirmTabId}
        onOpenChange={(open) => {
          if (!open) setReloadConfirmTabId(null);
        }}
        onConfirm={() => {
          const id = reloadConfirmTabId;
          setReloadConfirmTabId(null);
          if (id) void loadFile(id);
        }}
      />

      <UnsavedChangesDialog
        open={closeConfirmOpen}
        dirtyCount={dirtyTabs.length}
        hasPendingTab={!!pendingCloseTabId}
        saving={pendingCloseHasSaving}
        onOpenChange={setCloseConfirmOpen}
        onSaveAndClose={handleSaveAndClose}
        onDiscard={handleDiscard}
      />
    </div>
  );
}
