export const DEFAULT_TERMINAL_FONT_SIZE = 16;
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 72;
export const TERMINAL_FONT_SIZE_STEP = 1;

export function clampTerminalFontSize(fontSize: number): number {
  return Math.max(MIN_TERMINAL_FONT_SIZE, Math.min(MAX_TERMINAL_FONT_SIZE, Math.round(fontSize)));
}

export function resolveTerminalFontSize(baseFontSize: number, fontSizeDelta = 0): number {
  return clampTerminalFontSize(baseFontSize + fontSizeDelta);
}

export function increaseTerminalFontSizeDelta(baseFontSize: number, fontSizeDelta = 0): number {
  return (
    resolveTerminalFontSize(baseFontSize, fontSizeDelta + TERMINAL_FONT_SIZE_STEP) - baseFontSize
  );
}

export function decreaseTerminalFontSizeDelta(baseFontSize: number, fontSizeDelta = 0): number {
  return (
    resolveTerminalFontSize(baseFontSize, fontSizeDelta - TERMINAL_FONT_SIZE_STEP) - baseFontSize
  );
}

export function resetTerminalFontSizeDelta(): number {
  return 0;
}

export function increaseTerminalFontSize(fontSize: number): number {
  return clampTerminalFontSize(fontSize + TERMINAL_FONT_SIZE_STEP);
}

export function decreaseTerminalFontSize(fontSize: number): number {
  return clampTerminalFontSize(fontSize - TERMINAL_FONT_SIZE_STEP);
}
