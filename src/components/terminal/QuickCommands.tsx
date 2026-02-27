import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdAdd,
  MdBolt,
  MdDelete,
  MdEdit,
  MdKeyboardReturn,
  MdPushPin,
  MdSearch,
  MdTerminal,
} from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { QuickCommand } from "../../types";
import EditQuickCommandDialog from "../dialog/EditQuickCommandDialog";
import VariablePromptDialog, {
  parseCommandVariables,
  type VariableDef,
} from "../dialog/VariablePromptDialog";
import { QUICK_ICONS } from "../icons";

interface QuickCommandsProps {
  onSend: (command: string, execute?: boolean) => void;
}

const COLOR_DOT: Record<string, string> = {
  default: "bg-muted-foreground",
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  yellow: "bg-yellow-500",
  purple: "bg-purple-500",
};

function QuickCommands({ onSend }: QuickCommandsProps) {
  const { t } = useTranslation();
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const loaded = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // UI State
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCmd, setEditingCmd] = useState<QuickCommand | null>(null);

  // Variable Prompt State
  const [promptCmd, setPromptCmd] = useState<QuickCommand | null>(null);
  const [promptVars, setPromptVars] = useState<VariableDef[]>([]);
  const [partiallyResolvedCmd, setPartiallyResolvedCmd] = useState("");

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);

  // Load from backend on mount
  useEffect(() => {
    invoke<QuickCommand[]>("get_quick_commands")
      .then((cmds) => {
        setCommands(cmds);
        loaded.current = true;
      })
      .catch(() => {
        loaded.current = true;
      });
  }, []);

  // Debounced save to backend on change
  useEffect(() => {
    if (!loaded.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      invoke("save_quick_commands", { commands }).catch(() => { });
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [commands]);

  const saveCommands = useCallback((cmds: QuickCommand[]) => {
    invoke("save_quick_commands", { commands: cmds }).catch(() => { });
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      setCommands((prev) => {
        const news = prev.filter((c) => c.id !== id);
        saveCommands(news);
        return news;
      });
    },
    [saveCommands],
  );

  const handleEditSave = useCallback(
    (cmd: QuickCommand) => {
      setCommands((prev) => {
        const exists = prev.some((c) => c.id === cmd.id);
        let news;
        if (exists) {
          news = prev.map((c) => (c.id === cmd.id ? cmd : c));
        } else {
          news = [...prev, cmd];
        }
        saveCommands(news);
        return news;
      });
      setIsEditDialogOpen(false);
    },
    [saveCommands],
  );

  const handleCommandClick = useCallback(
    (cmd: QuickCommand) => {
      const vars = parseCommandVariables(cmd.command);

      // 1. Resolve system variables immediately
      let resolvedCmd = cmd.command;
      const systemVars = vars.filter((v) => v.isSystem);
      systemVars.forEach((v) => {
        let val = "";
        if (v.name === "DATE") val = new Date().toISOString().split("T")[0];
        else if (v.name === "TIME") val = new Date().toTimeString().split(" ")[0];
        else if (v.name === "TIMESTAMP") val = Date.now().toString();
        else if (v.name === "CURRENT_USER") val = "user";
        else if (v.name === "CONNECTION_IP") val = "127.0.0.1";
        resolvedCmd = resolvedCmd.split(v.raw).join(val);
      });

      const userVars = vars.filter((v) => !v.isSystem);

      if (userVars.length > 0) {
        // Need user input
        setPromptCmd(cmd);
        setPromptVars(userVars);
        setPartiallyResolvedCmd(resolvedCmd);
      } else {
        // All resolved or no variables
        onSend(resolvedCmd, cmd.execution_mode !== "append");
      }
    },
    [onSend],
  );

  const handlePromptSubmit = useCallback(
    (resolvedCommand: string) => {
      if (promptCmd) {
        onSend(resolvedCommand, promptCmd.execution_mode !== "append");
        setPromptCmd(null);
        setPartiallyResolvedCmd("");
      }
    },
    [promptCmd, onSend],
  );

  // Derived state for categories and filtering
  const categories = useMemo(() => {
    const cats = new Set<string>();
    commands.forEach((c) => c.category && cats.add(c.category));
    return Array.from(cats).sort();
  }, [commands]);

  const filteredCommands = useMemo(() => {
    let filtered = commands;

    // Category filter
    if (selectedCategory === "uncategorized") {
      filtered = filtered.filter((c) => !c.category);
    } else if (selectedCategory !== "all") {
      filtered = filtered.filter((c) => c.category === selectedCategory);
    }

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.command.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q)),
      );
    }

    // Sort: Pinned first
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0; // maintain original order within pinned/unpinned
    });

    return filtered;
  }, [commands, search, selectedCategory]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--df-bg-panel)" }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-2 py-1 border-b shrink-0"
        style={{ borderColor: "var(--df-border)" }}
      >
        <MdBolt className="text-[15px] shrink-0" style={{ color: "var(--df-text-dimmed)" }} />

        {/* Search */}
        <div className="relative shrink-0 flex-1 sm:flex-none">
          <Input
            className="w-full sm:w-32 focus-visible:w-full placeholder:text-xs sm:focus-visible:w-64 bg-transparent h-6 pl-6 pr-2 py-0 border-input transition-all duration-300 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            placeholder={t("quickCommands.search") || "Search cmd..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <MdSearch className="text-[11px] absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>

        <div className="flex-1 hidden sm:block" />

        {/* Categories */}
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="h-6 text-[11px] w-auto border min-w-[100px] max-w-[150px] shadow-none py-0 px-2 rounded bg-transparent focus:ring-0">
            <SelectValue placeholder={t("quickCommands.allCategories") || "All Categories"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[11px]">
              {t("quickCommands.allCategories") || "All Categories"}
            </SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c} className="text-[11px]">
                {c}
              </SelectItem>
            ))}
            <SelectItem value="uncategorized" className="text-[11px]">
              {t("quickCommands.uncategorized") || "Uncategorized"}
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Add Button */}
        <Button
          variant="ghost"
          size="icon-xs"
          className="bg-muted/50 hover:bg-muted text-foreground transition-colors"
          title={t("quickCommands.addCommand") || "Add Quick Command"}
          onClick={() => {
            setEditingCmd(null);
            setIsEditDialogOpen(true);
          }}
        >
          <MdAdd className="text-[14px]" />
        </Button>
      </div>

      {/* Commands List */}
      <TooltipProvider delayDuration={500}>
        <div className="flex-1 overflow-y-auto overflow-x-hidden terminal-scroll p-1.5">
          <div className="flex flex-wrap gap-1.5 content-start">
            {filteredCommands.length === 0 ? (
              <div className="flex flex-col items-center justify-center w-full mt-10 p-4 border border-dashed rounded-lg text-muted-foreground opacity-70">
                <MdTerminal className="text-2xl mb-2" />
                <span className="text-xs">
                  {t("quickCommands.noCommandsFound") || "No commands found"}
                </span>
              </div>
            ) : (
              filteredCommands.map((cmd) => {
                const dotColor = COLOR_DOT[cmd.color_tag || "default"] || COLOR_DOT.default;

                return (
                  <ContextMenu key={cmd.id} onOpenChange={setIsContextMenuOpen}>
                    <Tooltip open={isContextMenuOpen ? false : undefined}>
                      <ContextMenuTrigger asChild>
                        <TooltipTrigger asChild>
                          <button
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer transition-colors border bg-muted/20 hover:bg-muted/50 shrink-0 max-w-full text-foreground/80 hover:text-foreground"
                            onClick={() => handleCommandClick(cmd)}
                          >
                            {cmd.icon_tag && QUICK_ICONS[cmd.icon_tag] ? (
                              (() => {
                                const iconDef = QUICK_ICONS[cmd.icon_tag!];
                                return (
                                  <iconDef.icon
                                    className="text-[12px] opacity-80"
                                    style={{ color: iconDef.color }}
                                  />
                                );
                              })()
                            ) : (
                              <span
                                className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                              />
                            )}
                            {cmd.pinned && <MdPushPin className="text-[10px] opacity-60" />}
                            <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                              {cmd.label}
                            </span>
                          </button>
                        </TooltipTrigger>
                      </ContextMenuTrigger>
                      <TooltipContent
                        side="top"
                        align="start"
                        className="w-[300px] p-3 shadow-xl border-border bg-popover/95 backdrop-blur-sm"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            {cmd.icon_tag && QUICK_ICONS[cmd.icon_tag] ? (
                              (() => {
                                const iconDef = QUICK_ICONS[cmd.icon_tag!];
                                return (
                                  <iconDef.icon
                                    className="text-[14px] opacity-80 shrink-0"
                                    style={{ color: iconDef.color }}
                                  />
                                );
                              })()
                            ) : (
                              <span
                                className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                              />
                            )}
                            <span className="font-semibold text-xs text-foreground truncate">
                              {cmd.label}
                            </span>
                            {cmd.category && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border">
                                {cmd.category}
                              </span>
                            )}
                            <div className="flex-1" />
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              {cmd.execution_mode === "append" ? (
                                <MdKeyboardReturn className="text-[12px]" />
                              ) : (
                                <MdBolt className="text-[12px]" />
                              )}
                              {cmd.execution_mode === "append"
                                ? t("quickCommands.appendOnly") || "Append"
                                : t("quickCommands.executeImmediately") || "Execute"}
                            </span>
                          </div>

                          {cmd.description && (
                            <div
                              className="text-[11px] text-muted-foreground leading-snug line-clamp-3"
                              title={cmd.description}
                            >
                              {cmd.description}
                            </div>
                          )}

                          <div className="bg-muted/50 rounded p-2 border mt-1">
                            <pre
                              className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all line-clamp-5"
                              title={cmd.command}
                            >
                              {cmd.command}
                            </pre>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>

                    <ContextMenuContent className="min-w-[120px]">
                      <ContextMenuItem
                        className="text-xs gap-2"
                        onClick={() => {
                          setEditingCmd(cmd);
                          setIsEditDialogOpen(true);
                        }}
                      >
                        <MdEdit className="text-[14px]" />
                        {t("quickCommands.edit") || "Edit"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-xs gap-2 text-destructive focus:text-destructive"
                        onClick={() => handleDelete(cmd.id)}
                      >
                        <MdDelete className="text-[14px]" />
                        {t("quickCommands.delete") || "Delete"}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            )}
          </div>
        </div>
      </TooltipProvider>
      {/* Dialogs */}
      {isEditDialogOpen && (
        <EditQuickCommandDialog
          open={isEditDialogOpen}
          initialData={editingCmd}
          onClose={() => setIsEditDialogOpen(false)}
          onSave={handleEditSave}
        />
      )}

      {promptCmd && (
        <VariablePromptDialog
          open={!!promptCmd}
          command={partiallyResolvedCmd || promptCmd.command}
          variables={promptVars}
          onCancel={() => {
            setPromptCmd(null);
            setPartiallyResolvedCmd("");
          }}
          onSubmit={handlePromptSubmit}
        />
      )}
    </div>
  );
}

export default memo(QuickCommands);
