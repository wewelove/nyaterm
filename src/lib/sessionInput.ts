import { invoke } from "@tauri-apps/api/core";

const SESSION_INPUT_PREVIEW_EVENT = "dragonfly:session-input-preview";

export type SessionInputPreview =
  | { kind: "data"; data: string }
  | { kind: "replace"; value: string }
  | { kind: "replace-and-execute"; value: string }
  | { kind: "reset" };

interface SessionInputPreviewDetail {
  sessionId: string;
  preview: SessionInputPreview;
}

export interface SendSessionInputOptions {
  preview?: SessionInputPreview | null;
  registerSubmission?: string | null;
}

function inferPreview(data: string): SessionInputPreview {
  return { kind: "data", data };
}

export function emitSessionInputPreview(sessionId: string, preview: SessionInputPreview): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SessionInputPreviewDetail>(SESSION_INPUT_PREVIEW_EVENT, {
      detail: { sessionId, preview },
    }),
  );
}

export function listenSessionInputPreview(
  sessionId: string,
  handler: (preview: SessionInputPreview) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<SessionInputPreviewDetail>;
    if (customEvent.detail?.sessionId !== sessionId) {
      return;
    }
    handler(customEvent.detail.preview);
  };

  window.addEventListener(SESSION_INPUT_PREVIEW_EVENT, listener);
  return () => {
    window.removeEventListener(SESSION_INPUT_PREVIEW_EVENT, listener);
  };
}

export async function sendSessionInput(
  sessionId: string,
  data: string,
  options: SendSessionInputOptions = {},
): Promise<void> {
  const preview = options.preview === undefined ? inferPreview(data) : options.preview;
  if (preview) {
    emitSessionInputPreview(sessionId, preview);
  }

  await invoke("write_to_session", { sessionId, data });

  if (options.registerSubmission) {
    await invoke("register_command_submission", {
      sessionId,
      command: options.registerSubmission,
    });
  }
}
