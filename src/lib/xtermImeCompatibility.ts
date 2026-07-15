import type { Terminal } from "@xterm/xterm";
import { logger } from "@/lib/logger";
import { isLinux, isMacOS } from "@/lib/platform";

interface Disposable {
  dispose(): void;
}

interface XtermCompositionHelperInternals {
  _isComposing?: unknown;
  _isSendingComposition?: unknown;
  isComposing?: unknown;
  _textareaChangeTimer?: unknown;
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
    event: "ime_compatibility_skipped",
    message: "Skipped IME compatibility patch",
    ids: sessionId ? { session_id: sessionId } : undefined,
    data: { reason },
  });
}

function inputEventMetadata(ev: InputEvent, hadKeydown229: boolean) {
  return {
    input_type: ev.inputType,
    input_length: ev.data?.length ?? 0,
    is_composing: ev.isComposing,
    had_keydown_229: hadKeydown229,
  };
}

export function installImeCompatibilityPatch(
  terminal: Terminal,
  enabled: boolean,
  sessionId?: string,
): Disposable {
  if (!enabled || (!isMacOS && !isLinux)) {
    return noopDisposable;
  }

  const core = (terminal as TerminalWithCoreInternals)._core;
  if (!core) {
    warnSkipped("missing_core", sessionId);
    return noopDisposable;
  }
  if (!core._compositionHelper) {
    warnSkipped("missing_composition_helper", sessionId);
    return noopDisposable;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Accessing xterm.js private compositionHelper
  const compositionHelper = core._compositionHelper as Record<string, any>;
  const originalCompositionStart = compositionHelper.compositionstart;
  if (typeof originalCompositionStart !== "function") {
    warnSkipped("missing_composition_start", sessionId);
    return noopDisposable;
  }

  // biome-ignore lint/suspicious/noExplicitAny: xterm compositionstart context and arguments
  const patchedCompositionStart = function (this: any, ...args: any[]) {
    if (this._textareaChangeTimer !== undefined) {
      window.clearTimeout(this._textareaChangeTimer);
      this._textareaChangeTimer = undefined;
    }
    return originalCompositionStart.apply(this, args);
  };
  compositionHelper.compositionstart = patchedCompositionStart;

  let originalInputEvent: XtermCoreInternals["_inputEvent"] | undefined;
  let patchedInputEvent: XtermCoreInternals["_inputEvent"] | undefined;
  let textarea: HTMLTextAreaElement | null | undefined;
  let latestKeydownWas229 = false;
  let keydownInstalled = false;

  const handleKeyDown = (event: KeyboardEvent) => {
    latestKeydownWas229 = event.keyCode === 229;
  };

  if (isMacOS) {
    if (
      typeof core._inputEvent === "function" &&
      typeof core._keyDownSeen === "boolean" &&
      (typeof core._compositionHelper._isComposing === "boolean" ||
        typeof core._compositionHelper.isComposing === "boolean") &&
      typeof core._compositionHelper._isSendingComposition === "boolean" &&
      core.textarea instanceof HTMLTextAreaElement
    ) {
      originalInputEvent = core._inputEvent;
      textarea = core.textarea;
      patchedInputEvent = function patchedInputEvent(this: XtermCoreInternals, ev: InputEvent) {
        const was229 = latestKeydownWas229;
        latestKeydownWas229 = false;

        const shouldPatch =
          ev.inputType === "insertText" &&
          !!ev.data &&
          PRINTABLE_ASCII.test(ev.data) &&
          !ev.isComposing &&
          !isCompositionActive(this._compositionHelper) &&
          was229 &&
          this._keyDownSeen === true;

        if (!shouldPatch) {
          return (originalInputEvent as (ev: InputEvent) => unknown).call(this, ev);
        }

        logger.debug({
          domain: "terminal.input",
          event: "ime_input_forced",
          message: "Forced native _inputEvent to process input",
          data: inputEventMetadata(ev, was229),
        });

        const originalKeyDownSeen = this._keyDownSeen;
        this._keyDownSeen = false;
        try {
          return (originalInputEvent as (ev: InputEvent) => unknown).call(this, ev);
        } finally {
          this._keyDownSeen = originalKeyDownSeen;
        }
      };

      textarea.addEventListener("keydown", handleKeyDown, true);
      keydownInstalled = true;
      core._inputEvent = patchedInputEvent;
    } else {
      warnSkipped("missing_mac_input_event_internals", sessionId);
    }
  }

  return {
    dispose() {
      if (keydownInstalled && textarea) {
        textarea.removeEventListener("keydown", handleKeyDown, true);
      }
      if (patchedInputEvent && core._inputEvent === patchedInputEvent) {
        core._inputEvent = originalInputEvent;
      }
      if (compositionHelper.compositionstart === patchedCompositionStart) {
        compositionHelper.compositionstart = originalCompositionStart;
      }
    },
  };
}
