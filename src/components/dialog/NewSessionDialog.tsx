import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdAdd, MdExpandMore, MdFolderOpen, MdTerminal } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Group, SavedConnection } from "../../types";

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onConnect: (sessionId: string, name: string, type: "SSH" | "Local") => void;
  onSaved: () => void;
  initialData?: SavedConnection;
}

/** Modal for new/edit SSH connection or local terminal. Save, connect, or cancel. */
export default function NewSessionDialog({
  open,
  onClose,
  onConnect,
  onSaved,
  initialData,
}: NewSessionDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [description, setDescription] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [authType, setAuthType] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [keyFilePath, setKeyFilePath] = useState("");
  const [keyFileName, setKeyFileName] = useState("");
  const [hasKeyData, setHasKeyData] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const groupRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) {
        setShowGroupDropdown(false);
        setNewGroupName("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load groups when dialog opens
  useEffect(() => {
    if (open) {
      invoke<Group[]>("get_groups")
        .then(setGroups)
        .catch(() => {});
    }
  }, [open]);

  const resetForm = useCallback(() => {
    setName("");
    setGroup("");
    setDescription("");
    setHost("");
    setPort(22);
    setUsername("root");
    setAuthType("password");
    setPassword("");
    setKeyFilePath("");
    setKeyFileName("");
    setHasKeyData(false);
    setPassphrase("");
    setError("");
    setConnecting(false);
    setSaveSuccess(false);
  }, []);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setName(initialData.name);
        setGroup(initialData.group || "");
        setDescription(initialData.description || "");
        setHost(initialData.host);
        setPort(initialData.port);
        setUsername(initialData.username);
        setAuthType(initialData.auth_type as "password" | "key");
        setPassword(initialData.password || "");
        setKeyFilePath("");
        setKeyFileName("");
        setHasKeyData(initialData.has_key_data || false);
        setPassphrase(initialData.passphrase || "");
      } else {
        resetForm();
      }
    }
  }, [open, initialData, resetForm]);

  const handleClose = () => {
    if (connecting) return;
    resetForm();
    onClose();
  };

  const handleSave = async () => {
    if (!host) {
      setError(t("dialog.hostRequired"));
      return;
    }

    setError("");
    setSaveSuccess(false);
    setConnecting(true);

    try {
      if (group && !groups.find((g) => g.name === group)) {
        await invoke("save_group", {
          group: { id: "", name: group, sort_order: groups.length },
        });
      }

      const connection: SavedConnection = {
        id: initialData?.id || "",
        name: name || `${host}:${port}`,
        group: group || undefined,
        description: description || undefined,
        host,
        port,
        username,
        auth_type: authType,
        password: authType === "password" ? password : undefined,
        key_file_path: authType === "key" && keyFilePath ? keyFilePath : undefined,
        passphrase: authType === "key" ? passphrase || undefined : undefined,
      };

      await invoke("save_connection", { connection });
      resetForm();
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectLocal = async () => {
    setConnecting(true);
    setError("");

    try {
      const sessionId = await invoke<string>("create_local_session");
      resetForm();
      onConnect(sessionId, t("dialog.localTerminal"), "Local");
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent aria-describedby={undefined} className="w-[480px] sm:max-w-[480px] p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="text-sm">
            {initialData ? t("dialog.editConnection") : t("dialog.newConnection")}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {!initialData && (
            <Button
              variant="outline"
              className="w-full flex items-center gap-3 p-3 h-auto text-left justify-start"
              onClick={handleConnectLocal}
              disabled={connecting}
            >
              <MdTerminal className="text-xl text-cyan-400" />
              <div>
                <div className="text-xs font-medium">{t("dialog.localTerminal")}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t("dialog.openLocalShell")}
                </div>
              </div>
            </Button>
          )}

          {!initialData && (
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="flex-1 border-t" />
              <span>{t("dialog.sshConnection")}</span>
              <div className="flex-1 border-t" />
            </div>
          )}

          {/* Name + Group */}
          <div className="flex gap-3">
            <div className="flex-1">
              <Label className="text-[11px] text-muted-foreground">
                {t("dialog.connectionName")}
              </Label>
              <Input
                className="mt-1 text-xs h-8"
                placeholder={t("dialog.serverPlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="w-52 relative" ref={groupRef}>
              <Label className="text-[11px] text-muted-foreground">{t("dialog.group")}</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full mt-1 h-8 justify-between text-xs font-normal"
                onClick={() => setShowGroupDropdown(!showGroupDropdown)}
              >
                <span className={group ? "" : "text-muted-foreground"}>
                  {group || t("dialog.none")}
                </span>
                <MdExpandMore className="text-xs text-muted-foreground" />
              </Button>
              {showGroupDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 border rounded-md shadow-xl z-10 overflow-hidden bg-popover">
                  <div
                    className={`px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent ${!group ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
                    onClick={() => {
                      setGroup("");
                      setShowGroupDropdown(false);
                    }}
                  >
                    {t("dialog.none")}
                  </div>
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      className={`px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent ${group === g.name ? "bg-primary/15 text-primary" : ""}`}
                      onClick={() => {
                        setGroup(g.name);
                        setShowGroupDropdown(false);
                      }}
                    >
                      {g.name}
                    </div>
                  ))}
                  <div className="p-1.5 border-t">
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="flex-1 min-w-0 h-7 text-xs"
                        placeholder={t("dialog.newGroupPlaceholder")}
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newGroupName.trim()) {
                            setGroup(newGroupName.trim());
                            setNewGroupName("");
                            setShowGroupDropdown(false);
                          }
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={!newGroupName.trim()}
                        onClick={() => {
                          if (newGroupName.trim()) {
                            setGroup(newGroupName.trim());
                            setNewGroupName("");
                            setShowGroupDropdown(false);
                          }
                        }}
                      >
                        <MdAdd className="text-sm" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Host + Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <Label className="text-[11px] text-muted-foreground">{t("dialog.host")}</Label>
              <Input
                className="mt-1 text-xs h-8"
                placeholder="192.168.1.100"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <div className="w-20">
              <Label className="text-[11px] text-muted-foreground">{t("dialog.port")}</Label>
              <Input
                type="number"
                className="mt-1 text-xs h-8"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <Label className="text-[11px] text-muted-foreground">{t("dialog.username")}</Label>
            <Input
              className="mt-1 text-xs h-8"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {/* Auth Type */}
          <div>
            <Label className="text-[11px] text-muted-foreground">
              {t("dialog.authentication")}
            </Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant={authType === "password" ? "default" : "outline"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setAuthType("password")}
              >
                {t("dialog.password")}
              </Button>
              <Button
                variant={authType === "key" ? "default" : "outline"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setAuthType("key")}
              >
                {t("dialog.privateKey")}
              </Button>
            </div>
          </div>

          {/* Password or Key File */}
          {authType === "password" ? (
            <div>
              <Label className="text-[11px] text-muted-foreground">{t("dialog.password")}</Label>
              <Input
                type="password"
                className="mt-1 text-xs h-8"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div>
                <Label className="text-[11px] text-muted-foreground">
                  {t("dialog.privateKey")}
                </Label>
                <div className="flex items-center w-full rounded-md border overflow-hidden mt-1 bg-transparent">
                  <div
                    className={`flex-1 px-3 py-2 text-xs truncate ${keyFileName || hasKeyData ? "text-foreground" : "text-muted-foreground opacity-50"}`}
                  >
                    {keyFileName ||
                      (hasKeyData ? t("dialog.keyFileLoaded") : t("dialog.selectKeyFile"))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-none border-l h-auto py-2"
                    onClick={async () => {
                      const selected = await openFileDialog({
                        multiple: false,
                        title: t("dialog.selectKeyFileTitle"),
                      });
                      if (selected) {
                        setKeyFilePath(selected);
                        const parts = selected.replace(/\\/g, "/").split("/");
                        setKeyFileName(parts[parts.length - 1]);
                        setHasKeyData(false);
                      }
                    }}
                  >
                    <MdFolderOpen className="text-sm" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">
                  {t("dialog.passphrase")}
                </Label>
                <Input
                  type="password"
                  className="mt-1 text-xs h-8"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Description */}
          <div>
            <Label className="text-[11px] text-muted-foreground">{t("dialog.description")}</Label>
            <Textarea
              rows={2}
              placeholder={t("dialog.descriptionPlaceholder")}
              className="mt-1 text-xs resize-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Messages */}
          {error && (
            <div className="p-2 bg-destructive/10 border border-destructive/30 rounded text-xs text-red-400">
              {error}
            </div>
          )}
          {saveSuccess && (
            <div className="p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400">
              {t("dialog.connectionSaved")}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 py-3 border-t">
          <Button variant="ghost" size="sm" className="text-xs" onClick={handleClose}>
            {t("dialog.cancel")}
          </Button>
          <Button size="sm" className="text-xs" onClick={handleSave} disabled={connecting || !host}>
            {connecting ? t("dialog.saving") : t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
