import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdContentCopy, MdCheck } from "react-icons/md";
import { useApp } from "@/context/AppContext";
import type { TranslateResult } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TranslationDialogProps {
  open: boolean;
  onClose: () => void;
  text: string;
  provider: string;
}

export default function TranslationDialog({
  open,
  onClose,
  text,
  provider,
}: TranslationDialogProps) {
  const { t } = useTranslation();
  const { appSettings } = useApp();

  const [result, setResult] = useState<TranslateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const doTranslate = useCallback(async () => {
    if (!text || !provider) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await invoke<TranslateResult>("translate_text", {
        provider,
        text,
        targetLanguage: appSettings.translation.target_language,
      });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [text, provider, appSettings.translation.target_language]);

  useEffect(() => {
    if (open && text && provider) {
      doTranslate();
    }
    if (!open) {
      setResult(null);
      setError(null);
      setCopied(false);
    }
  }, [open, text, provider, doTranslate]);

  const handleCopy = useCallback(() => {
    if (result?.translated) {
      navigator.clipboard.writeText(result.translated);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const providerLabel = t(`translation.${provider}`, provider);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("translation.title")}
            <span className="text-xs font-normal text-muted-foreground px-2 py-0.5 bg-muted rounded">
              {providerLabel}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("translation.sourceText")}
            </label>
            <div className="rounded-md border bg-muted/50 p-3 text-sm max-h-[120px] overflow-y-auto whitespace-pre-wrap break-all">
              {text}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("translation.translatedText")}
              </label>
              {result?.detected_language && (
                <span className="text-xs text-muted-foreground">
                  {t("translation.detectedLang", { lang: result.detected_language })}
                </span>
              )}
            </div>
            <div className="rounded-md border bg-muted/50 p-3 text-sm min-h-[60px] max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t("translation.loading")}
                </div>
              )}
              {error && (
                <div className="text-destructive text-sm">
                  {t("translation.error")}: {error}
                </div>
              )}
              {result?.translated && result.translated}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!result?.translated}
          >
            {copied ? (
              <MdCheck className="text-[0.875rem] mr-1" />
            ) : (
              <MdContentCopy className="text-[0.875rem] mr-1" />
            )}
            {copied ? t("translation.copied") : t("translation.copy")}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("translation.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
