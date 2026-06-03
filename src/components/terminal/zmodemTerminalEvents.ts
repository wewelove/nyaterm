import type { Terminal } from "@xterm/xterm";
import { invoke } from "@/lib/invoke";

export type ZmodemEventPayload =
  | { type: "detected"; direction: "download" | "upload" }
  | {
      type: "progress";
      fileName: string;
      bytesTransferred: number;
      totalSize: number;
      direction: "download" | "upload";
    }
  | { type: "complete"; direction: "download" | "upload"; fileCount: number }
  | { type: "failed"; reason: string };

export async function handleZmodemEvent(
  terminal: Terminal,
  sessionId: string,
  payload: ZmodemEventPayload,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");

  switch (payload.type) {
    case "detected": {
      if (payload.direction === "download") {
        terminal.write(`\r\n\x1b[36m[ZMODEM] ${t("zmodem.selectSaveDir")}\x1b[0m\r\n`);
        const dir = await openDialog({ directory: true, multiple: false });
        if (dir) {
          await invoke("zmodem_accept_download", {
            sessionId,
            saveDir: dir,
          });
        } else {
          await invoke("zmodem_cancel", { sessionId });
          terminal.write(`\r\n\x1b[33m[ZMODEM] ${t("zmodem.cancelled")}\x1b[0m\r\n`);
        }
      } else {
        terminal.write(`\r\n\x1b[36m[ZMODEM] ${t("zmodem.selectFiles")}\x1b[0m\r\n`);
        const files = await openDialog({ directory: false, multiple: true });
        if (files && files.length > 0) {
          const filePaths = Array.isArray(files) ? files.map(String) : [String(files)];
          await invoke("zmodem_accept_upload", {
            sessionId,
            filePaths,
          });
        } else {
          await invoke("zmodem_cancel", { sessionId });
          terminal.write(`\r\n\x1b[33m[ZMODEM] ${t("zmodem.cancelled")}\x1b[0m\r\n`);
        }
      }
      break;
    }
    case "progress": {
      const percent =
        payload.totalSize > 0
          ? Math.round((payload.bytesTransferred / payload.totalSize) * 100)
          : 0;
      const msg =
        payload.direction === "download"
          ? t("zmodem.downloading", { fileName: payload.fileName, percent })
          : t("zmodem.uploading", { fileName: payload.fileName, percent });
      terminal.write(`\r\x1b[36m[ZMODEM] ${msg}\x1b[K`);
      break;
    }
    case "complete": {
      terminal.write(
        `\r\n\x1b[32m[ZMODEM] ${t("zmodem.complete", { count: payload.fileCount })}\x1b[0m\r\n`,
      );
      break;
    }
    case "failed": {
      terminal.write(
        `\r\n\x1b[31m[ZMODEM] ${t("zmodem.failed", { reason: payload.reason })}\x1b[0m\r\n`,
      );
      break;
    }
  }
}
