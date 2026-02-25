import { getName, getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
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
import pkg from "../../../package.json";
import DragonflyLogo from "../DragonflyLogo";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const { t } = useTranslation();
  const [appName, setAppName] = useState("Dragonfly");
  const [appVersion, setAppVersion] = useState("0.1.0");

  useEffect(() => {
    if (open) {
      getName().then(setAppName).catch(console.error);
      getVersion().then(setAppVersion).catch(console.error);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[320px] sm:max-w-[320px] flex flex-col items-center p-6 gap-4">
        <DialogHeader className="items-center">
          <DragonflyLogo className="w-24 h-24 object-contain" />
          <DialogTitle className="text-lg">{appName}</DialogTitle>
          <DialogDescription className="text-xs">v{appVersion}</DialogDescription>
        </DialogHeader>

        <p className="text-xs text-center px-4 leading-relaxed text-muted-foreground">
          {t("about.description")}
        </p>

        <div className="flex gap-3 w-full pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => openUrl(pkg.homepage)}
          >
            {t("about.website")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => openUrl(pkg.bugs.url)}
          >
            {t("about.issues")}
          </Button>
        </div>

        <DialogFooter className="w-full">
          <Button size="sm" className="w-full text-xs" onClick={onClose}>
            {t("about.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
