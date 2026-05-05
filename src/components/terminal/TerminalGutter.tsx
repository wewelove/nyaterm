import type { Terminal } from "@xterm/xterm";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface TerminalGutterProps {
  terminalRef: RefObject<Terminal | null>;
  showLineNumbers: boolean;
  showTimestamps: boolean;
  lineTimestamps: Map<number, number>;
  sessionId?: string;
  suspended?: boolean;
}

interface GutterLine {
  key: number;
  lineNumber: string;
  timestamp: string;
}

interface GutterLayout {
  lines: GutterLine[];
  rowHeight: number;
  topPadding: number;
  fontFamily: string;
  fontSize: number;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

export default function TerminalGutter({
  terminalRef,
  showLineNumbers,
  showTimestamps,
  lineTimestamps,
  sessionId,
  suspended = false,
}: TerminalGutterProps) {
  const rafRef = useRef(0);
  const viewportYRef = useRef(0);

  const [layout, setLayout] = useState<GutterLayout>({
    lines: [],
    rowHeight: 18,
    topPadding: 0,
    fontFamily: "inherit",
    fontSize: 12,
  });

  const computeLines = useCallback(() => {
    if (suspended) return;
    const terminal = terminalRef.current;
    if (!terminal || !terminal.element) return;

    const el = terminal.element;
    const buf = terminal.buffer.active;
    const viewport = el.querySelector(".xterm-viewport") as HTMLElement | null;

    const screen = el.querySelector(".xterm-screen") as HTMLElement | null;
    const screenHeight = viewport?.clientHeight ?? screen?.clientHeight ?? el.clientHeight;
    const topPadding = screen?.offsetTop ?? 0;

    const rowHeight = terminal.rows > 0 ? screenHeight / terminal.rows : 18;
    const viewportY = Math.max(0, Math.min(buf.baseY, viewportYRef.current || buf.viewportY));
    const rows = terminal.rows;
    const cursorAbsoluteY = buf.baseY + buf.cursorY;

    const resolveTimestamp = (bufferLine: number): number | undefined => {
      let y = bufferLine;

      while (y >= 0) {
        const ts = lineTimestamps.get(y);
        if (ts) return ts;

        const line = buf.getLine(y);
        if (!line?.isWrapped) break;
        y -= 1;
      }

      return undefined;
    };

    const nextLines: GutterLine[] = [];

    for (let i = 0; i < rows; i += 1) {
      const bufferLine = viewportY + i;
      const line = buf.getLine(bufferLine);
      const isWrapped = line?.isWrapped ?? false;
      const hasRenderedRow = bufferLine <= cursorAbsoluteY;
      const ts = resolveTimestamp(bufferLine);

      nextLines.push({
        key: bufferLine,
        timestamp: showTimestamps && hasRenderedRow && !isWrapped && ts ? formatTimestamp(ts) : "",
        lineNumber: showLineNumbers && hasRenderedRow && !isWrapped ? String(bufferLine + 1) : "",
      });
    }

    setLayout({
      lines: nextLines,
      rowHeight,
      topPadding,
      fontFamily: String(terminal.options.fontFamily ?? "inherit"),
      fontSize: Number(terminal.options.fontSize ?? 12),
    });
  }, [suspended, terminalRef, lineTimestamps, showLineNumbers, showTimestamps]);

  const scheduleUpdate = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      computeLines();
    });
  }, [computeLines]);

  useEffect(() => {
    if (suspended) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    let disposed = false;
    let handleExternalRefresh: ((event: Event) => void) | null = null;
    let disposables: Array<{ dispose: () => void }> = [];

    const attach = () => {
      if (disposed) return;

      const terminal = terminalRef.current;
      if (!terminal) {
        rafRef.current = requestAnimationFrame(attach);
        return;
      }

      viewportYRef.current = terminal.buffer.active.viewportY;
      scheduleUpdate();

      disposables = [
        terminal.onRender(() => {
          viewportYRef.current = terminal.buffer.active.viewportY;
          scheduleUpdate();
        }),
        terminal.onWriteParsed(() => {
          viewportYRef.current = terminal.buffer.active.viewportY;
          scheduleUpdate();
        }),
        terminal.onScroll((viewportY) => {
          viewportYRef.current = viewportY;
          scheduleUpdate();
        }),
        terminal.onResize(() => {
          viewportYRef.current = terminal.buffer.active.viewportY;
          scheduleUpdate();
        }),
      ];

      handleExternalRefresh = (event: Event) => {
        const customEvent = event as CustomEvent<{ sessionId?: string }>;
        if (
          !sessionId ||
          !customEvent.detail?.sessionId ||
          customEvent.detail.sessionId === sessionId
        ) {
          scheduleUpdate();
        }
      };

      window.addEventListener("nyaterm:refresh-gutter", handleExternalRefresh);
    };

    attach();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      disposables.forEach((d) => {
        d.dispose();
      });
      if (handleExternalRefresh) {
        window.removeEventListener("nyaterm:refresh-gutter", handleExternalRefresh);
      }
    };
  }, [suspended, terminalRef, scheduleUpdate, sessionId]);

  useEffect(() => {
    if (suspended) return;
    scheduleUpdate();
  }, [showLineNumbers, showTimestamps, scheduleUpdate, suspended]);

  if (suspended || (!showLineNumbers && !showTimestamps)) {
    return null;
  }

  const maxVisibleLineNumber = layout.lines.reduce((max, line) => {
    const value = Number(line.lineNumber);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 1);
  const lineNumWidth = showLineNumbers
    ? Math.max(40, String(maxVisibleLineNumber).length * 8 + 12)
    : 0;
  const tsWidth = showTimestamps ? 88 : 0;
  const gutterWidth = tsWidth + lineNumWidth;

  return (
    <div
      className="shrink-0 select-none overflow-hidden border-r"
      style={{
        width: gutterWidth,
        paddingTop: layout.topPadding,
        borderColor: "var(--df-border)",
        backgroundColor: "var(--df-bg-terminal)",
        fontFamily: layout.fontFamily,
        fontSize: layout.fontSize,
      }}
    >
      {layout.lines.map((line) => (
        <div
          key={line.key}
          className="flex items-center whitespace-nowrap pr-1.5 text-right tabular-nums"
          style={{
            height: layout.rowHeight,
            lineHeight: `${layout.rowHeight}px`,
            fontSize: "0.75em",
          }}
        >
          {showTimestamps && (
            <span
              className="inline-block truncate pr-2 text-right"
              style={{
                width: tsWidth,
                color: "var(--df-text-muted)",
                opacity: 0.85,
              }}
            >
              {line.timestamp}
            </span>
          )}

          {showLineNumbers && (
            <span
              className="inline-block truncate pr-1 text-right"
              style={{
                width: lineNumWidth,
                color: "var(--df-text-dimmed)",
                opacity: 0.7,
              }}
            >
              {line.lineNumber}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
