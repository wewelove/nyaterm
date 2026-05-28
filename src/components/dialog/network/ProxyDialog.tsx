import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, ActionFooter } from "@/components/ui/action-footer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProxyConfig } from "@/types/global";

interface ProxyForm {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

const DEFAULT_FORM: ProxyForm = {
  id: "",
  name: "",
  protocol: "socks5",
  host: "127.0.0.1",
  port: 1080,
  username: "",
  password: "",
};

function toForm(proxy: ProxyConfig | null): ProxyForm {
  if (!proxy) return { ...DEFAULT_FORM };
  return {
    id: proxy.id,
    name: proxy.name,
    protocol: proxy.protocol,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username ?? "",
    password: "",
  };
}

export function ProxyDialog({
  open,
  proxy,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  proxy: ProxyConfig | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (proxy: ProxyConfig) => Promise<void>;
}) {
  const { t } = useTranslation();
  const editing = !!proxy;
  const [form, setForm] = useState<ProxyForm>(DEFAULT_FORM);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(toForm(proxy));
    setError("");
  }, [open, proxy]);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError(t("network.proxyNameRequired"));
      return;
    }
    if (!form.host.trim()) {
      setError(t("network.proxyHostRequired"));
      return;
    }
    if (!form.port || form.port < 1 || form.port > 65535) {
      setError(t("network.proxyPortRequired"));
      return;
    }

    setError("");
    await onSave({
      id: form.id,
      name: form.name.trim(),
      protocol: form.protocol,
      host: form.host.trim(),
      port: form.port,
      username: form.username.trim() || undefined,
      password: form.password || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? t("network.editProxy") : t("network.newProxy")}</DialogTitle>
          <DialogDescription>{t("network.proxyDialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">{t("network.proxyName")}</Label>
            <Input
              className="h-9 text-sm"
              placeholder={t("network.proxyNamePlaceholder")}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label className="text-sm">{t("settings.proxyProtocol")}</Label>
              <Select
                value={form.protocol}
                onValueChange={(value) => setForm((prev) => ({ ...prev, protocol: value }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-sm">{t("settings.proxyHost")}</Label>
              <Input
                className="h-9 text-sm"
                placeholder="127.0.0.1"
                value={form.host}
                onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">{t("settings.proxyPort")}</Label>
            <NumberInput
              className="h-9 text-sm [&_button]:h-9 [&_button]:w-9 [&_input]:h-9 [&_input]:text-sm"
              min={1}
              max={65535}
              value={form.port}
              onChange={(value) => setForm((prev) => ({ ...prev, port: value || 0 }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm">{t("network.proxyUsername")}</Label>
              <Input
                className="h-9 text-sm"
                placeholder={t("network.proxyUsernamePlaceholder")}
                value={form.username}
                autoComplete="off"
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">{t("network.proxyPassword")}</Label>
              <Input
                className="h-9 text-sm"
                type="password"
                placeholder={
                  editing ? t("network.proxyPasswordKeep") : t("network.proxyPasswordPlaceholder")
                }
                value={form.password}
                autoComplete="off"
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <ActionFooter className="-mx-6 -mb-6 mt-2 rounded-b-lg">
          <ActionButton variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </ActionButton>
          <ActionButton onClick={handleSubmit} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </ActionButton>
        </ActionFooter>
      </DialogContent>
    </Dialog>
  );
}
