import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { MdCloudSync } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface AutoUploadDialogData {
  sessionId: string;
  localPath: string;
  remotePath: string;
}

interface AutoUploadDialogProps {
  data: AutoUploadDialogData;
  onClose: () => void;
  onAlwaysUpload: (sessionId: string, localPath: string) => void;
}

export default function AutoUploadDialog({ data, onClose, onAlwaysUpload }: AutoUploadDialogProps) {
  const { t } = useTranslation();

  const handleUpload = (always: boolean) => {
    if (always) {
      onAlwaysUpload(data.sessionId, data.localPath);
    }
    invoke("upload_local_file", {
      sessionId: data.sessionId,
      localPath: data.localPath,
      remotePath: data.remotePath,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-96 sm:max-w-96">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-full"
              style={{ backgroundColor: "color-mix(in srgb, var(--df-primary) 15%, transparent)" }}
            >
              <MdCloudSync className="text-[1.125rem] text-primary" />
            </div>
            <DialogTitle className="text-sm font-semibold">
              {t("fileExplorer.fileModified")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs break-all leading-relaxed">
            {t("fileExplorer.uploadPrompt")}
            <br />
            <br />
            <span
              className="font-mono bg-black/20 px-2 py-1 rounded border inline-block w-full truncate"
              style={{ color: "var(--df-text)", borderColor: "var(--df-border)" }}
              title={data.remotePath}
            >
              {data.remotePath}
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-xs" onClick={onClose}>
            {t("dialog.cancel")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex-1"
            onClick={() => handleUpload(true)}
          >
            {t("fileExplorer.alwaysUpload")}
          </Button>
          <Button size="sm" className="text-xs flex-1" onClick={() => handleUpload(false)}>
            {t("fileExplorer.uploadOnce")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
