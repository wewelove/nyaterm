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
import type { QuickCommandCategory } from "@/types/global";

interface DeleteQuickCommandCategoryDialogProps {
  category: QuickCommandCategory | null;
  commandCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteQuickCommandCategoryDialog({
  category,
  commandCount,
  onCancel,
  onConfirm,
}: DeleteQuickCommandCategoryDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog
      open={!!category}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("quickCommands.deleteCategory")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("quickCommands.deleteCategoryConfirm", {
              count: commandCount,
              name: category?.name,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
