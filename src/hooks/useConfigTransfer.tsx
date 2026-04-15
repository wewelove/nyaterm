import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { useApp } from "@/context/AppContext";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import { openSettings } from "@/lib/windowManager";

export function useConfigTransfer() {
  const { t } = useTranslation();
  const { appSettings } = useApp();
  const [showPasswordAlert, setShowPasswordAlert] = useState(false);

  const hasMasterPassword = !!appSettings.security.master_password;

  const ensureMasterPassword = () => {
    if (hasMasterPassword) return true;
    setShowPasswordAlert(true);
    return false;
  };

  const handleExport = async () => {
    if (!ensureMasterPassword()) return;

    const path = await saveFileDialog({
      filters: [{ name: "Dragonfly Backup", extensions: ["dgfy"] }],
    });

    if (!path) return;

    try {
      await invoke("export_config", { outputPath: path });
      toast.success(t("settings.exportSuccess"));
    } catch (error) {
      logger.error("Export config failed", error);
      toast.error(`${t("settings.exportFailed")}: ${error}`);
    }
  };

  const handleImport = async () => {
    if (!ensureMasterPassword()) return;

    const path = await openFileDialog({
      multiple: false,
      filters: [{ name: "Dragonfly Backup", extensions: ["dgfy"] }],
    });

    if (!path) return;

    try {
      await invoke("import_config", { filePath: path });
      toast.success(t("settings.importSuccess"));
    } catch (error) {
      logger.error("Import config failed", error);
      toast.error(`${t("settings.importFailed")}: ${error}`);
    }
  };

  const passwordAlert = (
    <AlertDialog open={showPasswordAlert} onOpenChange={setShowPasswordAlert}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settings.masterPasswordRequired")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings.masterPasswordRequiredDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setShowPasswordAlert(false);
              openSettings("security");
            }}
          >
            {t("settings.security")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    handleExport,
    handleImport,
    passwordAlert,
  };
}
