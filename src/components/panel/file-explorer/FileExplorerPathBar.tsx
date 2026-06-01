import { type RefObject, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface FileExplorerPathBarProps {
  isEditingPath: boolean;
  pathInputText: string;
  pathInputRef: RefObject<HTMLInputElement | null>;
  displayPath: string;
  currentPath: string;
  homeDir: string;
  directoryHistory: string[];
  onPathInputTextChange: (value: string) => void;
  onEditingPathChange: (editing: boolean) => void;
  onLoadDirectory: (path: string) => void;
  onSelectHistoryPath: (path: string) => void;
}

// Roughly five rows are visible before the list starts scrolling.
const HISTORY_ROW_HEIGHT = 24;
const HISTORY_VISIBLE_ROWS = 5;

export function FileExplorerPathBar({
  isEditingPath,
  pathInputText,
  pathInputRef,
  displayPath,
  currentPath,
  homeDir,
  directoryHistory,
  onPathInputTextChange,
  onEditingPathChange,
  onLoadDirectory,
  onSelectHistoryPath,
}: FileExplorerPathBarProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the editor/history popup when clicking outside the path bar. This is
  // more robust than relying on input blur, which would fire while dragging the
  // history scrollbar.
  useEffect(() => {
    if (!isEditingPath) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onEditingPathChange(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isEditingPath, onEditingPathChange]);

  const formatHistoryPath = (path: string) => {
    if (!homeDir) return path;
    if (path === homeDir) return "~";
    if (path.startsWith(`${homeDir}/`)) return `~${path.slice(homeDir.length)}`;
    return path;
  };

  const showHistory = isEditingPath && directoryHistory.length > 0;
  const normalizedCurrentPath = currentPath || homeDir;

  return (
    <div
      ref={containerRef}
      className="relative px-2 py-1 border-b flex items-center"
      style={{ borderColor: "var(--df-border)", minHeight: "26px" }}
    >
      {isEditingPath ? (
        <input
          ref={pathInputRef}
          className="w-full text-[0.625rem] font-mono bg-transparent outline-none m-0 p-0"
          style={{ color: "var(--df-text)" }}
          value={pathInputText}
          onChange={(event) => onPathInputTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              let path = pathInputText.trim();
              if (path) {
                if (path.startsWith("~/") && homeDir) {
                  path = homeDir + path.substring(1);
                } else if (path === "~" && homeDir) {
                  path = homeDir;
                }
                onLoadDirectory(path);
              }
              onEditingPathChange(false);
            } else if (event.key === "Escape") {
              onEditingPathChange(false);
            }
          }}
        />
      ) : (
        <div
          className="text-[0.625rem] font-mono truncate cursor-text transition-colors flex-1"
          style={{ color: "var(--df-text-dimmed)" }}
          onMouseEnter={(event) => (event.currentTarget.style.color = "var(--df-text)")}
          onMouseLeave={(event) => (event.currentTarget.style.color = "var(--df-text-dimmed)")}
          onClick={() => {
            onPathInputTextChange(currentPath || homeDir);
            onEditingPathChange(true);
          }}
          title={t("fileExplorer.editPath")}
        >
          {displayPath}
        </div>
      )}

      {showHistory && (
        <div
          className="terminal-scroll absolute inset-x-0 top-full z-30 mt-px overflow-y-auto rounded-b-md border shadow-lg"
          style={{
            backgroundColor: "var(--df-bg-panel)",
            borderColor: "var(--df-border)",
            maxHeight: `${HISTORY_ROW_HEIGHT * HISTORY_VISIBLE_ROWS}px`,
          }}
          aria-label={t("fileExplorer.directoryHistory")}
        >
          {directoryHistory.map((path) => {
            const isCurrent = path === normalizedCurrentPath;
            return (
              <button
                key={path}
                type="button"
                className="flex w-full items-center truncate px-2 text-left text-[0.625rem] font-mono transition-colors"
                style={{
                  height: `${HISTORY_ROW_HEIGHT}px`,
                  color: isCurrent ? "var(--df-primary)" : "var(--df-text)",
                }}
                title={path}
                // Prevent the input from blurring before the click is handled.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "var(--df-bg-hover)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = "transparent";
                }}
                onClick={() => {
                  onEditingPathChange(false);
                  onSelectHistoryPath(path);
                }}
              >
                <span className="truncate">{formatHistoryPath(path)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
