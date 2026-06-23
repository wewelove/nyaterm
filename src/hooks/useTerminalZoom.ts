import { useCallback, useEffect, useRef } from "react";
import { resolveShortcutKeys } from "@/hooks/useShortcutMap";
import { matchesKeyEvent } from "@/lib/shortcutRegistry";
import {
  decreaseTerminalFontSizeDelta,
  increaseTerminalFontSizeDelta,
  resetTerminalFontSizeDelta,
} from "@/lib/terminalFontSize";
import type { AppSettings } from "@/types/global";

type UpdateAppSettings = (
  updates: Partial<AppSettings> | ((prev: AppSettings) => Partial<AppSettings>),
) => void;

const CTRL_WHEEL_ZOOM_THROTTLE_MS = 50;

export function useTerminalZoom(
  updateAppSettings: UpdateAppSettings,
  keybindings: Record<string, string> = {},
) {
  const lastCtrlWheelZoomAtRef = useRef(0);

  const handleZoomIn = useCallback(() => {
    updateAppSettings((prev) => ({
      terminal: {
        ...prev.terminal,
        font_size_delta: increaseTerminalFontSizeDelta(
          prev.appearance.font_size,
          prev.terminal.font_size_delta,
        ),
      },
    }));
  }, [updateAppSettings]);

  const handleZoomOut = useCallback(() => {
    updateAppSettings((prev) => ({
      terminal: {
        ...prev.terminal,
        font_size_delta: decreaseTerminalFontSizeDelta(
          prev.appearance.font_size,
          prev.terminal.font_size_delta,
        ),
      },
    }));
  }, [updateAppSettings]);

  const handleResetZoom = useCallback(() => {
    updateAppSettings((prev) => ({
      terminal: { ...prev.terminal, font_size_delta: resetTerminalFontSizeDelta() },
    }));
  }, [updateAppSettings]);

  useEffect(() => {
    const handleKeyboardZoom = (event: KeyboardEvent) => {
      if (matchesKeyEvent(resolveShortcutKeys("view.zoomIn", keybindings), event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleZoomIn();
        return;
      }

      if (matchesKeyEvent(resolveShortcutKeys("view.zoomOut", keybindings), event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleZoomOut();
        return;
      }

      if (matchesKeyEvent(resolveShortcutKeys("view.resetZoom", keybindings), event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleResetZoom();
      }
    };

    window.addEventListener("keydown", handleKeyboardZoom, true);
    return () => {
      window.removeEventListener("keydown", handleKeyboardZoom, true);
    };
  }, [handleResetZoom, handleZoomIn, handleZoomOut, keybindings]);

  useEffect(() => {
    const handleCtrlWheelZoom = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.deltaY === 0) return;

      event.preventDefault();
      const now = Date.now();
      if (now - lastCtrlWheelZoomAtRef.current < CTRL_WHEEL_ZOOM_THROTTLE_MS) return;
      lastCtrlWheelZoomAtRef.current = now;

      if (event.deltaY < 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    };

    window.addEventListener("wheel", handleCtrlWheelZoom, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", handleCtrlWheelZoom, true);
    };
  }, [handleZoomIn, handleZoomOut]);

  return {
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
  };
}
