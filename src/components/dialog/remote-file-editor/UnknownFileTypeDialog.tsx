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
import { Button } from "@/components/ui/button";
import type { FileEntry } from "@/types/global";

interface UnknownFileTypeDialogProps {
  entry: FileEntry;
  onClose: () => void;
  onOpenExternal: () => void;
  onOpenInternal: () => void;
}

export default function UnknownFileTypeDialog({
  entry,
  onClose,
  onOpenExternal,
  onOpenInternal,
}: UnknownFileTypeDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("fileExplorer.unknownFileTypeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("fileExplorer.unknownFileTypeDesc", { name: entry.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="outline" onClick={onOpenInternal}>
            {t("fileExplorer.unknownFileTypeOpenInternal")}
          </Button>
          <AlertDialogAction onClick={onOpenExternal}>
            {t("fileExplorer.unknownFileTypeOpenExternal")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
