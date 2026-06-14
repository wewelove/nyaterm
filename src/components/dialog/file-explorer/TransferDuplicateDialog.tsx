import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import {
  getActiveTransferDuplicatePrompt,
  resolveTransferDuplicatePrompt,
  setBackendTransferDuplicatePrompt,
  subscribeTransferDuplicatePrompt,
  type TransferDuplicateChoice,
  type TransferDuplicateRequest,
} from "@/lib/transferDuplicatePrompt";

export function TransferDuplicateDialog() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<TransferDuplicateRequest | null>(() =>
    getActiveTransferDuplicatePrompt(),
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => subscribeTransferDuplicatePrompt(setRequest), []);

  const handleChoice = async (choice: TransferDuplicateChoice) => {
    if (!request || submitting) return;
    setSubmitting(true);

    try {
      if (request.respondViaBackend) {
        await invoke("respond_transfer_duplicate", {
          requestId: request.requestId,
          action: choice,
        });
      } else {
        resolveTransferDuplicatePrompt(choice);
        setSubmitting(false);
        return;
      }
    } catch (error) {
      logger.error({
        domain: "transfer.lifecycle",
        event: "duplicate.response_failed",
        message: "Failed to send duplicate resolution to backend",
        ids: { request_id: request.requestId },
        error,
      });
      if (request.respondViaBackend) {
        await invoke("respond_transfer_duplicate", {
          requestId: request.requestId,
          action: "skip",
        }).catch(() => {});
      } else {
        resolveTransferDuplicatePrompt("skip");
      }
    }

    setSubmitting(false);
    if (request.respondViaBackend) {
      setBackendTransferDuplicatePrompt(null);
    }
  };

  const kindLabel = request?.isDirectory
    ? t("fileTransfer.duplicateKindFolder")
    : t("fileTransfer.duplicateKindFile");

  return (
    <AlertDialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open && request && !submitting) {
          void handleChoice("skip");
        }
      }}
    >
      <AlertDialogContent
        size="sm"
        className="w-[min(22rem,calc(100vw-2rem))] sm:max-w-md"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !submitting && request) {
            event.preventDefault();
            void handleChoice("overwrite");
          }
        }}
      >
        <AlertDialogHeader className="min-w-0 text-left">
          <AlertDialogTitle className="text-sm">
            {t("fileTransfer.duplicateTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs leading-relaxed">
            {t("fileTransfer.duplicateDescription", {
              kind: kindLabel,
              name: request?.fileName ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {request?.remotePath && (
          <div
            className="rounded-md border px-2 py-1.5 font-mono text-[0.6875rem] break-all"
            style={{ borderColor: "var(--df-border)", color: "var(--df-text-dimmed)" }}
          >
            {request.remotePath}
          </div>
        )}

        <AlertDialogFooter className="gap-3">
          <AlertDialogCancel
            className="text-xs"
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              void handleChoice("skip");
            }}
          >
            {t("fileTransfer.duplicateSkip")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="text-xs"
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              void handleChoice("overwrite");
            }}
          >
            {t("fileTransfer.duplicateOverwrite")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
