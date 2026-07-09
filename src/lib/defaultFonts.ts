import { isMacOS, isWindows } from "./platform";

export const DEFAULT_TERMINAL_FONT_FAMILY =
  '"JetBrains Mono", "Cascadia Mono", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export function getDefaultUiFontFamily() {
  if (isMacOS) {
    return 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif';
  }

  if (isWindows) {
    return 'system-ui, "Segoe UI", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif';
  }

  return 'system-ui, "Noto Sans SC", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif';
}
