import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface OpenGroupConnectionsDialogProps {
  open: boolean;
  folderName?: string;
  count?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function OpenGroupConnectionsDialog({
  open,
  folderName,
  count,
  onConfirm,
  onCancel,
}: OpenGroupConnectionsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("savedConnections.openAllConnections")}</DialogTitle>
          <DialogDescription>
            {t("savedConnections.openAllConnectionsConfirm", {
              name: folderName,
              count: count ?? 0,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm}>{t("savedConnections.openAllConnections")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
