import type { SavedConnection } from "@/types/global";

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const fallback = String(error);
  return fallback === "[object Object]" ? "Unknown error" : fallback;
}

const EDIT_CONNECTION_RECOVERY_PATTERNS = [
  "authentication failed: invalid credentials",
  "authentication failed: key rejected",
  "authentication failed: none auth rejected",
  "authentication failed for jump host",
  "none auth failed",
  "no password for this connection",
  "no stored password",
  "no ssh key for this connection",
  "no key data stored",
  "no auth config for ssh connection",
  "unknown auth type:",
  "ssh key error:",
  "key auth failed:",
];

const NON_EDITOR_RECOVERY_PATTERNS = [
  "2fa authentication cancelled by user",
  "2fa authentication request dropped",
  "keyboard-interactive authentication failed",
  "keyboard-interactive respond failed",
];

export function shouldPromptConnectionEditOnFailure(
  connection: Pick<SavedConnection, "type"> | null | undefined,
  errorMessage: string,
): boolean {
  if (!connection || connection.type !== "ssh") {
    return false;
  }

  const normalized = errorMessage.toLowerCase();
  if (NON_EDITOR_RECOVERY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return false;
  }

  return EDIT_CONNECTION_RECOVERY_PATTERNS.some((pattern) => normalized.includes(pattern));
}
