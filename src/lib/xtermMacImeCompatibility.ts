import type { Terminal } from "@xterm/xterm";
import { logger } from "@/lib/logger";
import { isMacOS } from "@/lib/platform";

interface Disposable {
  dispose(): void;
}

interface XtermCompositionHelperInternals {
  _isComposing?: unknown;
  _isSendingComposition?: unknown;
  isComposing?: unknown;
}

interface XtermCoreInternals {
  _inputEvent?: unknown;
  _keyDownSeen?: unknown;
  _compositionHelper?: XtermCompositionHelperInternals;
  textarea?: HTMLTextAreaElement | null;
}

interface TerminalWithCoreInternals extends Terminal {
  _core?: XtermCoreInternals;
}

const PRINTABLE_ASCII = /^[\x20-\x7E]$/;

const noopDisposable: Disposable = {
  dispose() {},
};

function isCompositionActive(helper: XtermCompositionHelperInternals | undefined): boolean {
  if (!helper) return false;

  return (
    helper._isComposing === true ||
    helper._isSendingComposition === true ||
    helper.isComposing === true
  );
}

function warnSkipped(reason: string, sessionId?: string): void {
  logger.warn({
    domain: "terminal.input",
    event: "mac_ime_compatibility_skipped",
    message: "Skipped macOS IME compatibility patch",
    ids: sessionId ? { session_id: sessionId } : undefined,
    data: { reason },
  });
}

export function installMacImeCompatibilityPatch(
  terminal: Terminal,
  enabled: boolean,
  sessionId?: string,
): Disposable {
  if (!enabled || !isMacOS) {
    return noopDisposable;
  }

  const core = (terminal as TerminalWithCoreInternals)._core;
  if (!core) {
    warnSkipped("missing_core", sessionId);
    return noopDisposable;
  }
  if (typeof core._inputEvent !== "function") {
    warnSkipped("missing_input_event", sessionId);
    return noopDisposable;
  }
  if (typeof core._keyDownSeen !== "boolean") {
    warnSkipped("missing_key_down_seen", sessionId);
    return noopDisposable;
  }
  if (!core._compositionHelper) {
    warnSkipped("missing_composition_helper", sessionId);
    return noopDisposable;
  }
  if (
    typeof core._compositionHelper._isComposing !== "boolean" &&
    typeof core._compositionHelper.isComposing !== "boolean"
  ) {
    warnSkipped("missing_is_composing", sessionId);
    return noopDisposable;
  }
  if (typeof core._compositionHelper._isSendingComposition !== "boolean") {
    warnSkipped("missing_is_sending_composition", sessionId);
    return noopDisposable;
  }
  if (!(core.textarea instanceof HTMLTextAreaElement)) {
    warnSkipped("missing_textarea", sessionId);
    return noopDisposable;
  }

  const originalInputEvent = core._inputEvent;
  const textarea = core.textarea;
  let latestKeydownWas229 = false;

  const handleKeyDown = (event: KeyboardEvent) => {
    latestKeydownWas229 = event.keyCode === 229;
  };

  const patchedInputEvent = function patchedInputEvent(this: XtermCoreInternals, ev: InputEvent) {
    const shouldPatch =
      ev.inputType === "insertText" &&
      !!ev.data &&
      PRINTABLE_ASCII.test(ev.data) &&
      !ev.isComposing &&
      !isCompositionActive(this._compositionHelper) &&
      latestKeydownWas229 &&
      this._keyDownSeen === true;

    if (!shouldPatch) {
      return originalInputEvent.call(this, ev);
    }

    const originalKeyDownSeen = this._keyDownSeen;
    this._keyDownSeen = false;
    try {
      return originalInputEvent.call(this, ev);
    } finally {
      this._keyDownSeen = originalKeyDownSeen;
    }
  };

  textarea.addEventListener("keydown", handleKeyDown, true);
  core._inputEvent = patchedInputEvent;

  return {
    dispose() {
      textarea.removeEventListener("keydown", handleKeyDown, true);
      if (core._inputEvent === patchedInputEvent) {
        core._inputEvent = originalInputEvent;
      }
    },
  };
}
