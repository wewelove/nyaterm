import type { IBufferCell, IBufferLine, IBufferRange, Terminal } from "@xterm/xterm";
import type { TerminalInputState } from "@/lib/terminalInputTracker";

/** Read the current cursor line from the terminal buffer up to the cursor. */
export function readCurrentInputLine(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const y = buffer.baseY + buffer.cursorY;
  const line = buffer.getLine(y);
  if (!line) return "";
  const fullLine = line.translateToString(true, 0, buffer.cursorX);
  return fullLine;
}

export function readRecentOutput(terminal: Terminal, lineLimit: number) {
  const buffer = terminal.buffer.active;
  const total = buffer.length;
  const start = Math.max(0, total - lineLimit);
  const lines: string[] = [];
  for (let y = start; y < total; y += 1) {
    const line = buffer.getLine(y);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n").replace(/\s+$/u, "");
}

export function hasErrorKeyword(output: string) {
  return /\b(error|failed|permission denied|no space left on device|connection refused|segmentation fault|out of memory|cannot allocate memory|command not found|module not found|port already in use)\b/i.test(
    output,
  );
}

export function isMultiLineText(text: string): boolean {
  return /[\r\n]/u.test(text);
}

export function isShiftInsertPasteEvent(e: KeyboardEvent): boolean {
  return (
    e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    (e.code === "Insert" || e.key === "Insert")
  );
}

interface LogicalInputLineSnapshot {
  startY: number;
  endY: number;
  text: string;
  stringIndexToCellOffset: number[];
}

interface InputCellSpan {
  startStringIndex: number;
  startCellOffset: number;
  endCellOffset: number;
}

export interface InputSelectionRange {
  start: number;
  end: number;
}

interface InputClickPosition {
  x: number;
  y: number;
}

interface XTermCoreWithRenderDimensions {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: {
            height: number;
            width: number;
          };
        };
      };
    };
  };
}

function buildLineStringToCellMap(
  line: IBufferLine,
  stringLength: number,
  maxCols: number,
  scratchCell: IBufferCell,
): number[] {
  const map: number[] = [];
  let col = 0;
  let cellEndCol = 0;

  while (col < maxCols && map.length < stringLength) {
    const cell = line.getCell(col, scratchCell);
    if (!cell) break;

    const chars = cell.getChars();
    const width = cell.getWidth();
    const stride = width || 1;

    if (chars.length === 0) {
      map.push(col);
    } else {
      for (let i = 0; i < chars.length; i += 1) {
        map.push(col);
      }
    }

    cellEndCol = col + stride;
    col += stride;
  }

  map.push(cellEndCol);
  return map;
}

function readLogicalLineSnapshot(terminal: Terminal): LogicalInputLineSnapshot | null {
  const buffer = terminal.buffer.active;
  const cursorY = buffer.baseY + buffer.cursorY;
  let startY = cursorY;
  while (startY > 0 && buffer.getLine(startY)?.isWrapped) {
    startY -= 1;
  }

  let endY = cursorY;
  while (endY + 1 < buffer.length && buffer.getLine(endY + 1)?.isWrapped) {
    endY += 1;
  }

  const scratchCell = buffer.getNullCell();
  const parts: string[] = [];
  const stringIndexToCellOffset: number[] = [];
  let lastCellOffset = 0;

  for (let y = startY; y <= endY; y += 1) {
    const line = buffer.getLine(y);
    if (!line) return null;

    const rowOffset = (y - startY) * terminal.cols;
    const maxCols = Math.min(line.length, terminal.cols);
    const text = line.translateToString(false, 0, maxCols);
    const lineMap = buildLineStringToCellMap(line, text.length, maxCols, scratchCell);

    for (let i = 0; i < text.length; i += 1) {
      stringIndexToCellOffset.push(rowOffset + (lineMap[i] ?? i));
    }

    lastCellOffset = rowOffset + (lineMap[text.length] ?? text.length);
    parts.push(text);
  }

  stringIndexToCellOffset.push(lastCellOffset);
  return { startY, endY, text: parts.join(""), stringIndexToCellOffset };
}

function findTrackedInputCellSpan(
  snapshot: LogicalInputLineSnapshot,
  state: TerminalInputState,
  cursorCellOffset: number,
): InputCellSpan | null {
  const spans = findTrackedInputCellSpans(snapshot, state);
  return (
    spans.find((span) => {
      const cursorIndex = span.startStringIndex + state.cursor;
      const cursorCandidate = snapshot.stringIndexToCellOffset[cursorIndex];
      return cursorCandidate === cursorCellOffset;
    }) ?? null
  );
}

function findTrackedInputCellSpans(
  snapshot: LogicalInputLineSnapshot,
  state: TerminalInputState,
): InputCellSpan[] {
  if (!state.value) return [];

  const { text, stringIndexToCellOffset } = snapshot;
  let searchFrom = 0;
  let matchIndex = text.indexOf(state.value, searchFrom);
  const spans: InputCellSpan[] = [];

  while (matchIndex >= 0) {
    const endIndex = matchIndex + state.value.length;
    const startCellOffset = stringIndexToCellOffset[matchIndex];
    const endCellOffset = stringIndexToCellOffset[endIndex];

    if (startCellOffset !== undefined && endCellOffset !== undefined) {
      spans.push({
        startStringIndex: matchIndex,
        startCellOffset,
        endCellOffset,
      });
    }

    searchFrom = matchIndex + 1;
    matchIndex = text.indexOf(state.value, searchFrom);
  }

  return spans;
}

function cellOffsetToStringIndex(stringIndexToCellOffset: number[], cellOffset: number): number {
  for (let i = 0; i < stringIndexToCellOffset.length; i += 1) {
    if ((stringIndexToCellOffset[i] ?? 0) >= cellOffset) {
      return i;
    }
  }
  return stringIndexToCellOffset.length - 1;
}

function selectionPositionToCellOffset(
  selection: IBufferRange,
  snapshot: LogicalInputLineSnapshot,
  cols: number,
): { start: number; end: number } | null {
  if (
    selection.start.y < snapshot.startY ||
    selection.start.y > snapshot.endY ||
    selection.end.y < snapshot.startY ||
    selection.end.y > snapshot.endY
  ) {
    return null;
  }

  const start = (selection.start.y - snapshot.startY) * cols + selection.start.x;
  const end = (selection.end.y - snapshot.startY) * cols + selection.end.x;
  if (end <= start) return null;
  return { start, end };
}

export function getSelectedInputRange(
  terminal: Terminal,
  state: TerminalInputState,
): InputSelectionRange | null {
  if (terminal.buffer.active.type === "alternate") return null;
  if (state.desynced || state.multiline || state.lineRewriteRequired) return null;

  const selection = terminal.getSelectionPosition();
  if (!selection) return null;

  const snapshot = readLogicalLineSnapshot(terminal);
  if (!snapshot) return null;

  const buffer = terminal.buffer.active;
  const cursorCellOffset =
    (buffer.baseY + buffer.cursorY - snapshot.startY) * terminal.cols + buffer.cursorX;
  const inputSpan = findTrackedInputCellSpan(snapshot, state, cursorCellOffset);
  if (!inputSpan) return null;

  const selectedCells = selectionPositionToCellOffset(selection, snapshot, terminal.cols);
  if (!selectedCells) return null;
  if (
    selectedCells.start < inputSpan.startCellOffset ||
    selectedCells.end > inputSpan.endCellOffset
  ) {
    return null;
  }

  const startStringIndex = cellOffsetToStringIndex(
    snapshot.stringIndexToCellOffset,
    selectedCells.start,
  );
  const endStringIndex = cellOffsetToStringIndex(
    snapshot.stringIndexToCellOffset,
    selectedCells.end,
  );
  const start = startStringIndex - inputSpan.startStringIndex;
  const end = endStringIndex - inputSpan.startStringIndex;

  if (start < 0 || end > state.value.length || end <= start) {
    return null;
  }

  return { start, end };
}

export function getMouseBufferPosition(
  terminal: Terminal,
  event: MouseEvent,
): InputClickPosition | null {
  const screenEl = terminal.element?.querySelector(".xterm-screen") as HTMLElement | null;
  const core = (terminal as Terminal & XTermCoreWithRenderDimensions)._core;
  const cellWidth = core?._renderService?.dimensions?.css?.cell?.width ?? 0;
  const cellHeight = core?._renderService?.dimensions?.css?.cell?.height ?? 0;
  if (!screenEl || cellWidth <= 0 || cellHeight <= 0) return null;

  const rect = screenEl.getBoundingClientRect();
  const viewportX = Math.floor((event.clientX - rect.left) / cellWidth);
  const viewportY = Math.floor((event.clientY - rect.top) / cellHeight);
  if (viewportX < 0 || viewportY < 0 || viewportY >= terminal.rows) return null;

  return {
    x: Math.min(terminal.cols, viewportX),
    y: terminal.buffer.active.viewportY + viewportY,
  };
}

export function getInputIndexAtBufferPosition(
  terminal: Terminal,
  state: TerminalInputState,
  position: InputClickPosition,
): number | null {
  if (terminal.buffer.active.type === "alternate") return null;
  if (state.desynced || state.multiline || state.lineRewriteRequired) return null;

  const snapshot = readLogicalLineSnapshot(terminal);
  if (!snapshot) return null;
  if (position.y < snapshot.startY || position.y > snapshot.endY) return null;

  const buffer = terminal.buffer.active;
  const cursorCellOffset =
    (buffer.baseY + buffer.cursorY - snapshot.startY) * terminal.cols + buffer.cursorX;
  const clickedCellOffset = (position.y - snapshot.startY) * terminal.cols + position.x;
  const inputSpan =
    findTrackedInputCellSpan(snapshot, state, cursorCellOffset) ??
    findTrackedInputCellSpans(snapshot, state).find((span) => {
      if (clickedCellOffset < span.startCellOffset) return false;
      if (clickedCellOffset <= span.endCellOffset) return true;
      const inputEndY = snapshot.startY + Math.floor(span.endCellOffset / terminal.cols);
      return position.y === inputEndY;
    }) ??
    null;
  if (!inputSpan) return null;

  if (clickedCellOffset < inputSpan.startCellOffset) {
    return null;
  }

  if (clickedCellOffset > inputSpan.endCellOffset) {
    const inputEndY = snapshot.startY + Math.floor(inputSpan.endCellOffset / terminal.cols);
    return position.y === inputEndY ? state.value.length : null;
  }

  const stringIndex = cellOffsetToStringIndex(snapshot.stringIndexToCellOffset, clickedCellOffset);
  const inputIndex = stringIndex - inputSpan.startStringIndex;
  if (inputIndex < 0 || inputIndex > state.value.length) return null;
  return inputIndex;
}
