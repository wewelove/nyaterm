import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { invoke } from "@/lib/invoke";
import type { SavedConnection, SessionInfo } from "@/types/global";

type QuickSwitcherItem =
  | {
      kind: "session";
      id: string;
      title: string;
      subtitle: string;
      searchText: string;
      session: SessionInfo;
    }
  | {
      kind: "connection";
      id: string;
      title: string;
      subtitle: string;
      searchText: string;
      connection: SavedConnection;
    };

interface SessionQuickSwitcherProps {
  open: boolean;
  activeSessionId: string | null;
  workspaceSessionIds: Set<string>;
  savedConnections: SavedConnection[];
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onOpenConnection: (connection: SavedConnection) => void;
  onNewSshSession: () => void;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[\s_\-./\\:]+/g, "");
}

function isSubsequence(needle: string, haystack: string) {
  let cursor = 0;
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor === -1) return false;
    cursor += 1;
  }
  return true;
}

function matchesLooseSearch(searchText: string, query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;

  const normalizedSearch = searchText.toLowerCase();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.every((token) => normalizedSearch.includes(token))) return true;

  const compactQuery = normalizeSearchText(trimmed);
  return compactQuery.length > 0 && isSubsequence(compactQuery, normalizeSearchText(searchText));
}

function getConnectionTarget(connection: SavedConnection) {
  if (connection.type === "serial") return connection.port_name ?? "";
  if (connection.type === "local_terminal")
    return connection.working_dir || connection.shell_path || "";

  const host = connection.host ?? "";
  const port = connection.port ? `:${connection.port}` : "";
  return `${host}${port}`;
}

function getConnectionSubtitle(connection: SavedConnection) {
  const target = getConnectionTarget(connection);
  const username = connection.username ? `${connection.username}@` : "";
  const type = connection.type.replace("_", " ");
  return [type, `${username}${target}`.trim()].filter(Boolean).join(" - ");
}

export default function SessionQuickSwitcher({
  open,
  activeSessionId,
  workspaceSessionIds,
  savedConnections,
  onClose,
  onSelectSession,
  onOpenConnection,
  onNewSshSession,
}: SessionQuickSwitcherProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) return;

    setQuery("");
    setSelectedIndex(0);
    invoke<SessionInfo[]>("list_sessions")
      .then((result) => {
        setSessions(result.filter((session) => workspaceSessionIds.has(session.id)));
      })
      .catch(() => setSessions([]));

    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [open, workspaceSessionIds]);

  const items = useMemo<QuickSwitcherItem[]>(() => {
    const sessionItems = sessions.map((session) => ({
      kind: "session" as const,
      id: `session:${session.id}`,
      title: session.name,
      subtitle: session.session_type,
      searchText: [session.name, session.session_type, session.id].filter(Boolean).join(" "),
      session,
    }));
    const connectionItems = savedConnections.map((connection) => {
      const subtitle = getConnectionSubtitle(connection);
      return {
        kind: "connection" as const,
        id: `connection:${connection.id}`,
        title: connection.name,
        subtitle,
        searchText: [
          connection.name,
          connection.description,
          connection.type,
          connection.host,
          connection.port,
          connection.username,
          connection.port_name,
          connection.shell_path,
          connection.shell_args,
          connection.working_dir,
          subtitle,
        ]
          .filter(Boolean)
          .join(" "),
        connection,
      };
    });

    return [...sessionItems, ...connectionItems];
  }, [savedConnections, sessions]);

  const filteredItems = useMemo(
    () =>
      items
        .filter((item) => matchesLooseSearch(item.searchText, query))
        .map((item, index) => ({ item, index }))
        .sort((left, right) => {
          const getRank = ({ item }: { item: QuickSwitcherItem }) => {
            if (item.kind === "session" && item.session.id === activeSessionId) return 0;
            if (item.kind === "session") return 1;
            return 2;
          };
          return getRank(left) - getRank(right) || left.index - right.index;
        })
        .map(({ item }) => item),
    [activeSessionId, items, query],
  );

  useEffect(() => {
    setSelectedIndex((index) =>
      filteredItems.length === 0 ? 0 : Math.min(index, filteredItems.length - 1),
    );
  }, [filteredItems.length]);

  const selectItem = (item: QuickSwitcherItem) => {
    if (item.kind === "session") {
      onSelectSession(item.session.id);
      return;
    }
    onOpenConnection(item.connection);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-[18vh] w-[min(40rem,calc(100vw-2rem))] max-w-none translate-y-0 gap-0 overflow-hidden rounded-md p-0 shadow-2xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("sessionQuickSwitcher.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("sessionQuickSwitcher.searchPlaceholder")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative border-b">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  filteredItems.length === 0 ? 0 : (index + 1) % filteredItems.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  filteredItems.length === 0
                    ? 0
                    : (index - 1 + filteredItems.length) % filteredItems.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const selected = filteredItems[selectedIndex];
                if (selected) {
                  selectItem(selected);
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder={t("sessionQuickSwitcher.searchPlaceholder")}
            className="h-11 rounded-none border-0 bg-transparent pl-10 pr-3 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[min(24rem,55vh)] overflow-y-auto">
          {filteredItems.map((item, index) => {
            const active = item.kind === "session" && item.session.id === activeSessionId;
            const selected = index === selectedIndex;

            return (
              <button
                key={item.id}
                type="button"
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs ${
                  selected ? "bg-primary/15" : "hover:bg-accent/70"
                }`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => selectItem(item)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.subtitle}
                  </span>
                </span>
                {active ? (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[0.625rem] text-primary">
                    {t("sessionQuickSwitcher.active")}
                  </span>
                ) : null}
                {item.kind === "connection" ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
                    {t("sessionQuickSwitcher.saved")}
                  </span>
                ) : null}
              </button>
            );
          })}

          {filteredItems.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {items.length === 0
                ? t("sessionQuickSwitcher.noSessions")
                : t("sessionQuickSwitcher.noMatches")}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Enter {t("sessionQuickSwitcher.open")} / Esc {t("sessionQuickSwitcher.close")}
          </span>
          <Button size="sm" className="h-7 px-2 text-xs" onClick={onNewSshSession}>
            {t("sessionQuickSwitcher.newSsh")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
