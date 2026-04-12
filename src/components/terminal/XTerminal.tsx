import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ILinkHandler, Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { useActionLinks } from "@/hooks/useActionLinks";
import { useCommandHistory } from "@/hooks/useCommandHistory";
import { useKeywordHighlighter } from "@/hooks/useKeywordHighlighter";
import { useShellIntegration } from "@/hooks/useShellIntegration";
import { useTerminalSearch } from "@/hooks/useTerminalSearch";
import { useTerminalSettings } from "@/hooks/useTerminalSettings";
import { hexLuminance } from "@/lib/keywordHighlightPresets";
import ActionLinkMenu from "./ActionLinkMenu";
import ActionLinkTooltip from "./ActionLinkTooltip";
import CommandSuggestions from "./CommandSuggestions";
import TerminalContextMenu from "./TerminalContextMenu";
import TerminalSearchBar from "./TerminalSearchBar";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  sessionId: string;
  active: boolean;
  visible?: boolean;
  connectionId?: string;
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
}

/**
 * xterm.js terminal for a session. Handles OSC 133 shell integration (or fallback prompt
 * detection), fuzzy command history suggestions, and resize/fit. Key props: sessionId, active.
 */
export default function XTerminal({
  sessionId,
  active,
  visible = true,
  connectionId,
  onReconnected,
}: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { terminalTheme } = useTheme();
  const { t } = useTranslation();
  const { appSettings } = useApp();

  const currentLineRef = useRef("");
  const appSettingsRef = useRef(appSettings);
  const tRef = useRef(t);
  const doFindRef = useRef<(selection?: string) => void>(() => {});
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const disconnectedRef = useRef(false);
  const reconnectingRef = useRef(false);
  const connectionIdRef = useRef(connectionId);
  const onReconnectedRef = useRef(onReconnected);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    onReconnectedRef.current = onReconnected;
  }, [onReconnected]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    appSettingsRef.current = appSettings;
  }, [appSettings]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Search Addon state and handlers
  const {
    searchAddonRef,
    showSearchBar,
    setShowSearchBar,
    searchQuery,
    setSearchQuery,
    handleSearchNext,
    handleSearchPrev,
    handleCloseSearch,
  } = useTerminalSearch(terminalRef);

  // Shell integration state & reading commands
  const { shellIntegrationRef, readCommandFromBuffer, readBetweenMarkerAndCursor } =
    useShellIntegration(terminalRef, currentLineRef);

  // Command history & fuzzy search UI
  const {
    suggestions,
    selectedIndex,
    setSelectedIndex,
    showSuggestions,
    cursorPosition,
    suggestionsRef,
    selectedIndexRef,
    showSuggestionsRef,
    searchTimerRef,
    triggerSearch,
    dismissSuggestions,
    handleSelectSuggestion,
  } = useCommandHistory(
    sessionId,
    terminalRef,
    currentLineRef,
    shellIntegrationRef,
    readCommandFromBuffer,
  );

  // Create and setup terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      scrollback: appSettings.terminal.scrollback_lines,
      cursorBlink: appSettings.appearance.cursor_blink,
      cursorStyle: appSettings.appearance.cursor_style as "block" | "underline" | "bar",
      fontSize: appSettings.appearance.font_size,
      fontFamily: appSettings.appearance.font_family,
      wordSeparator: appSettings.interaction.word_separators,
      theme: { ...terminalTheme.colors.terminal },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const isMacPlatform = () =>
      typeof navigator !== "undefined" &&
      /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`);
    const modifierLabel = isMacPlatform() ? "Cmd" : "Ctrl";
    const allowedLinkProtocols = new Set(["http:", "https:", "mailto:"]);
    const linkPopupDelayMs = 350;
    let linkPopup: HTMLDivElement | null = null;
    let linkPopupTimer: number | null = null;

    const clearLinkPopupTimer = () => {
      if (linkPopupTimer !== null) {
        window.clearTimeout(linkPopupTimer);
        linkPopupTimer = null;
      }
    };

    const destroyLinkPopup = () => {
      linkPopup?.remove();
      linkPopup = null;
    };

    const removeLinkPopup = () => {
      clearLinkPopupTimer();
      destroyLinkPopup();
    };

    const positionLinkPopup = (popup: HTMLDivElement, clientX: number, clientY: number) => {
      const terminalEl = terminal.element;
      if (!terminalEl) return;

      const hostRect = terminalEl.getBoundingClientRect();
      const margin = 8;
      const offset = 16;

      let left = clientX - hostRect.left + offset;
      let top = clientY - hostRect.top + offset;

      if (left + popup.offsetWidth + margin > terminalEl.clientWidth) {
        left = terminalEl.clientWidth - popup.offsetWidth - margin;
      }

      if (top + popup.offsetHeight + margin > terminalEl.clientHeight) {
        top = clientY - hostRect.top - popup.offsetHeight - offset;
      }

      popup.style.left = `${Math.max(margin, left)}px`;
      popup.style.top = `${Math.max(margin, top)}px`;
    };

    const showLinkPopup = (text: string, clientX: number, clientY: number) => {
      const terminalEl = terminal.element;
      if (!terminalEl) return;

      destroyLinkPopup();

      const popup = document.createElement("div");
      popup.className = "xterm-link-popup xterm-hover";

      const urlLine = document.createElement("div");
      urlLine.className = "xterm-link-popup__url";
      urlLine.textContent = text;
      popup.appendChild(urlLine);

      const hintLine = document.createElement("div");
      hintLine.className = "xterm-link-popup__hint";
      hintLine.textContent = tRef.current("terminal.linkOpenHint", { modifier: modifierLabel });
      popup.appendChild(hintLine);

      terminalEl.appendChild(popup);
      positionLinkPopup(popup, clientX, clientY);
      linkPopup = popup;
    };

    const scheduleLinkPopup = (event: MouseEvent, text: string) => {
      clearLinkPopupTimer();
      destroyLinkPopup();

      const { clientX, clientY } = event;
      linkPopupTimer = window.setTimeout(() => {
        showLinkPopup(text, clientX, clientY);
        linkPopupTimer = null;
      }, linkPopupDelayMs);
    };

    const hasRequiredModifier = (event: MouseEvent) =>
      isMacPlatform() ? event.metaKey : event.ctrlKey;

    const isAllowedLinkUri = (uri: string) => {
      try {
        return allowedLinkProtocols.has(new URL(uri).protocol);
      } catch {
        return false;
      }
    };

    const handleLinkActivation = (event: MouseEvent, uri: string) => {
      if (!hasRequiredModifier(event)) return;
      if (!isAllowedLinkUri(uri)) return;

      removeLinkPopup();
      openUrl(uri).catch((err: unknown) => console.error("Failed to open link:", err));
    };

    const oscLinkHandler: ILinkHandler = {
      activate: handleLinkActivation,
      hover: (event, text) => scheduleLinkPopup(event, text),
      leave: () => removeLinkPopup(),
      allowNonHttpProtocols: true,
    };

    const webLinksAddon = new WebLinksAddon(handleLinkActivation, {
      hover: (event, text) => scheduleLinkPopup(event, text),
      leave: () => removeLinkPopup(),
    });
    const searchAddon = new SearchAddon();

    terminal.options.linkHandler = oscLinkHandler;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(containerRef.current);

    searchAddonRef.current = searchAddon;

    // Initial fit
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    sendInputRef.current = (data: string) => {
      invoke("write_to_session", { sessionId, data }).catch(() => {});
    };
    const pasteText = (text: string) => {
      if (text) terminal.paste(text);
    };

    let lastSelection = "";

    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && shift) {
        switch (e.code) {
          case "KeyC": {
            e.preventDefault();
            const sel = terminal.getSelection();
            if (sel) navigator.clipboard.writeText(sel).catch(() => {});
            return false;
          }
          case "KeyV":
            e.preventDefault();
            navigator.clipboard
              .readText()
              .then((text) => {
                pasteText(text);
              })
              .catch(() => {});
            return false;
          case "KeyF":
            e.preventDefault();
            doFindRef.current();
            return false;
          case "KeyK":
            e.preventDefault();
            terminal.clear();
            return false;
          case "KeyX": {
            e.preventDefault();
            const sel = terminal.getSelection() || lastSelection;
            pasteText(sel);
            return false;
          }
          case "KeyA":
            e.preventDefault();
            terminal.selectAll();
            return false;
          case "KeyN":
          case "KeyW":
          case "KeyE":
          case "KeyB":
          case "KeyL":
          case "Tab":
            return false;
        }
      }

      if (ctrl && !shift) {
        switch (e.code) {
          case "Tab":
          case "Digit1":
          case "Digit2":
          case "Digit3":
          case "Digit4":
          case "Digit5":
          case "Digit6":
          case "Digit7":
          case "Digit8":
          case "Digit9":
          case "Digit0":
          case "Equal":
          case "Minus":
          case "Backquote":
          case "Comma":
            return false;
        }
      }
      return true;
    });

    const oscDisposable = terminal.parser.registerOscHandler(133, (data) => {
      const si = shellIntegrationRef.current;

      if (data.startsWith("A")) {
        si.enabled = true;
        si.promptStartMarker?.dispose();
        si.promptStartMarker = terminal.registerMarker(0);
        return false;
      }

      if (data.startsWith("B")) {
        si.enabled = true;
        si.commandStartMarker?.dispose();
        si.commandStartMarker = terminal.registerMarker(0);
        si.commandStartX = terminal.buffer.active.cursorX;
        return false;
      }

      if (data.startsWith("C")) {
        si.enabled = true;
        if (si.commandStartMarker) {
          const command = readBetweenMarkerAndCursor(
            terminal,
            si.commandStartMarker,
            si.commandStartX,
          ).trim();
          if (command) {
            invoke("add_command_history", { sessionId, command }).catch(() => {});
          }
        }
        currentLineRef.current = "";
        dismissSuggestions();
        return false;
      }

      if (data.startsWith("D")) {
        si.enabled = true;
        return false;
      }

      return false;
    });

    const writeParsedDisposable = terminal.onWriteParsed(() => {
      const si = shellIntegrationRef.current;
      if (si.enabled) return;

      if (si.fallbackNeedsDetection) {
        si.fallbackPromptEndX = terminal.buffer.active.cursorX;
      }
    });

    let outputUnlisten: UnlistenFn | null = null;
    let closedUnlisten: UnlistenFn | null = null;
    let focusUnlisten: UnlistenFn | null = null;

    const setupListeners = async () => {
      outputUnlisten = await listen<string>(`terminal-output-${sessionId}`, (event) => {
        terminal.write(event.payload);

        if (event.payload.includes("\n")) {
          const si = shellIntegrationRef.current;
          currentLineRef.current = "";
          if (!si.enabled) {
            si.fallbackNeedsDetection = true;
          }
          dismissSuggestions();
        }
      });

      closedUnlisten = await listen<void>(`session-closed-${sessionId}`, () => {
        disconnectedRef.current = true;
        terminal.write(`\r\n\x1b[31m[${tRef.current("terminal.sessionDisconnected")}]\x1b[0m\r\n`);
        if (connectionIdRef.current) {
          terminal.write(`\x1b[33m[${tRef.current("terminal.pressEnterToReconnect")}]\x1b[0m\r\n`);
        }
      });

      focusUnlisten = await listen<void>(`focus-terminal-${sessionId}`, () => {
        terminal.focus();
      });

      try {
        await invoke("attach_session", { sessionId });
      } catch {
        // The session may already be gone during mount/unmount races.
      }
    };
    void setupListeners();

    const dataDisposable = terminal.onData((data) => {
      if (disconnectedRef.current) {
        if (data === "\r" && connectionIdRef.current && !reconnectingRef.current) {
          reconnectingRef.current = true;
          terminal.write(`\r\n\x1b[36m[${tRef.current("terminal.reconnecting")}]\x1b[0m\r\n`);
          invoke<string>("create_ssh_session", { connectionId: connectionIdRef.current })
            .then((newSessionId) => {
              disconnectedRef.current = false;
              reconnectingRef.current = false;
              onReconnectedRef.current?.(sessionIdRef.current, newSessionId);
            })
            .catch((err) => {
              reconnectingRef.current = false;
              terminal.write(
                `\r\n\x1b[31m[${tRef.current("terminal.reconnectFailed")}: ${err}]\x1b[0m\r\n`,
              );
              terminal.write(
                `\x1b[33m[${tRef.current("terminal.pressEnterToReconnect")}]\x1b[0m\r\n`,
              );
            });
        }
        return;
      }

      if (showSuggestionsRef.current && suggestionsRef.current.length > 0) {
        if (data === "\t" && selectedIndexRef.current >= 0) {
          const selected = suggestionsRef.current[selectedIndexRef.current];
          if (selected) {
            const actualCmd = readCommandFromBuffer();
            const eraseChars = "\x7f".repeat(actualCmd.length);
            invoke("write_to_session", {
              sessionId,
              data: eraseChars + selected.command,
            }).catch(() => {});
            currentLineRef.current = selected.command;
            dismissSuggestions();
          }
          return;
        }

        if (data === "\x1b[A") {
          const cur = selectedIndexRef.current;
          const newIdx = cur === -1 ? suggestionsRef.current.length - 1 : cur === 0 ? -1 : cur - 1;
          selectedIndexRef.current = newIdx;
          setSelectedIndex(newIdx);
          return;
        }

        if (data === "\x1b[B") {
          const cur = selectedIndexRef.current;
          const newIdx = cur === -1 ? 0 : cur === suggestionsRef.current.length - 1 ? -1 : cur + 1;
          selectedIndexRef.current = newIdx;
          setSelectedIndex(newIdx);
          return;
        }

        if (data === "\x1b") {
          dismissSuggestions();
          return;
        }

        if (data === "\r" && selectedIndexRef.current >= 0) {
          const selected = suggestionsRef.current[selectedIndexRef.current];
          if (selected) {
            const actualCmd = readCommandFromBuffer();
            const eraseChars = "\x7f".repeat(actualCmd.length);
            invoke("write_to_session", {
              sessionId,
              data: `${eraseChars + selected.command}\r`,
            }).catch(() => {});
            if (!shellIntegrationRef.current.enabled) {
              invoke("add_command_history", {
                sessionId,
                command: selected.command,
              }).catch(() => {});
            }
            currentLineRef.current = "";
            shellIntegrationRef.current.fallbackNeedsDetection = true;
            dismissSuggestions();
          }
          return;
        }
      }

      const si = shellIntegrationRef.current;

      if (data === "\r") {
        if (!si.enabled) {
          const bufCmd = readCommandFromBuffer().trim();
          const cmd = bufCmd || currentLineRef.current.trim();
          if (cmd) {
            invoke("add_command_history", { sessionId, command: cmd });
          }
        }
        currentLineRef.current = "";
        si.fallbackNeedsDetection = true;
        dismissSuggestions();
      } else if (data === "\u007f" || data === "\b") {
        currentLineRef.current = currentLineRef.current.slice(0, -1);
        triggerSearch();
      } else if (data === "\t") {
        triggerSearch();
      } else if (!/[\x00-\x1f\x7f]/.test(data)) {
        if (!si.enabled && si.fallbackNeedsDetection) {
          si.fallbackPromptEndX = terminal.buffer.active.cursorX;
          si.fallbackNeedsDetection = false;
        }
        currentLineRef.current += data;
        triggerSearch();
      } else if (data.startsWith("\x1b")) {
        if (!si.enabled && si.fallbackNeedsDetection) {
          si.fallbackPromptEndX = terminal.buffer.active.cursorX;
          si.fallbackNeedsDetection = false;
        }
        currentLineRef.current = "";
        dismissSuggestions();
      } else {
        currentLineRef.current = "";
        si.fallbackNeedsDetection = true;
        dismissSuggestions();
      }

      invoke("write_to_session", { sessionId, data }).catch(() => {});
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      invoke("resize_session", { sessionId, cols, rows }).catch(() => {});
    });
    const scrollDisposable = terminal.onScroll(() => {
      removeLinkPopup();
    });

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    observer.observe(containerRef.current);

    const selectionDisposable = terminal.onSelectionChange(() => {
      const text = terminal.getSelection();
      if (text) {
        lastSelection = text;
      }
      if (appSettingsRef.current?.interaction?.copy_on_select) {
        if (text) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }
    });

    const handleMiddleMouseDown = (e: MouseEvent) => {
      removeLinkPopup();
      if (e.button === 1) e.preventDefault(); // Prevent auto-scroll mechanism
    };

    const handleMiddleClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const sel = terminal.getSelection();
      if (sel) {
        navigator.clipboard.writeText(sel).catch(() => {});
        terminal.clearSelection();
      } else {
        navigator.clipboard
          .readText()
          .then((text) => {
            pasteText(text);
          })
          .catch(() => {});
      }
    };

    containerRef.current.addEventListener("mousedown", handleMiddleMouseDown);
    containerRef.current.addEventListener("mouseup", handleMiddleClick);
    const containerEl = containerRef.current;

    return () => {
      containerEl.removeEventListener("mousedown", handleMiddleMouseDown);
      containerEl.removeEventListener("mouseup", handleMiddleClick);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

      const si = shellIntegrationRef.current;
      si.promptStartMarker?.dispose();
      si.commandStartMarker?.dispose();
      si.promptStartMarker = null;
      si.commandStartMarker = null;

      oscDisposable.dispose();
      writeParsedDisposable.dispose();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      scrollDisposable.dispose();
      selectionDisposable.dispose();
      removeLinkPopup();

      observer.disconnect();
      if (outputUnlisten) outputUnlisten();
      if (closedUnlisten) closedUnlisten();
      if (focusUnlisten) focusUnlisten();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Appearance, theme, and interaction settings sync.
  // Declared AFTER the terminal creation effect so effects from these hooks
  // run after terminalRef.current is already set on initial mount.
  useTerminalSettings(terminalRef, fitAddonRef, terminalTheme, appSettings);

  // isDark is derived from the terminal theme background so built-in rule colors
  // switch automatically when the user changes themes.
  const isDark = hexLuminance(terminalTheme.colors.terminal.background) < 0.5;
  useKeywordHighlighter(terminalRef, appSettings, sessionId, isDark);

  const { tooltipState, menuState, closeMenu } = useActionLinks(
    terminalRef,
    appSettings,
    sessionId,
    sendInputRef,
  );

  // Re-fit and focus when tab becomes active
  useEffect(() => {
    if (active && visible && fitAddonRef.current && terminalRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.refresh(0, Math.max(0, terminalRef.current.rows - 1));
        terminalRef.current?.focus();
      });
    }
  }, [active, visible]);

  useEffect(() => {
    const handleRefresh = () => {
      if (!visible || !fitAddonRef.current || !terminalRef.current) return;

      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.refresh(0, Math.max(0, terminalRef.current.rows - 1));
        if (active) {
          terminalRef.current?.focus();
        }
      });
    };

    window.addEventListener("dragonfly:refresh-terminals", handleRefresh);
    return () => {
      window.removeEventListener("dragonfly:refresh-terminals", handleRefresh);
    };
  }, [active, visible]);

  const doFind = useCallback(
    (selection?: string) => {
      if (selection) {
        setSearchQuery(selection);
        setTimeout(() => searchAddonRef.current?.findNext(selection), 50);
      }
      setShowSearchBar(true);
      terminalRef.current?.focus();
    },
    [setShowSearchBar, setSearchQuery, searchAddonRef],
  );

  useEffect(() => {
    doFindRef.current = doFind;
  }, [doFind]);

  return (
    <div className="h-full w-full relative" style={{ display: visible ? "block" : "none" }}>
      <TerminalContextMenu terminalRef={terminalRef} onFind={doFind}>
        <div ref={containerRef} className="h-full w-full" />
      </TerminalContextMenu>

      <TerminalSearchBar
        show={showSearchBar}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onNext={handleSearchNext}
        onPrev={handleSearchPrev}
        onClose={handleCloseSearch}
      />

      <CommandSuggestions
        suggestions={suggestions}
        visible={showSuggestions}
        selectedIndex={selectedIndex}
        cursorPosition={cursorPosition}
        onSelect={handleSelectSuggestion}
        onDismiss={dismissSuggestions}
      />

      <ActionLinkTooltip state={tooltipState} />
      <ActionLinkMenu state={menuState} onClose={closeMenu} />
    </div>
  );
}
