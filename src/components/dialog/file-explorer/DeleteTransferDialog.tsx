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
import type { TransferItem } from "@/context/TransferContext";

interface DeleteTransferDialogProps {
  transfer: TransferItem | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteTransferDialog({
  transfer,
  onCancel,
  onConfirm,
}: DeleteTransferDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog
      open={!!transfer}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        size="sm"
        onKeyDown={(event) => {
          if (event.key === "Enter" && transfer) {
            event.preventDefault();
            onConfirm();
          }
        }}
      >
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>{t("fileTransfer.deleteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("fileTransfer.deleteConfirmDesc", { name: transfer?.fileName ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" autoFocus onClick={onConfirm}>
            {t("fileTransfer.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
