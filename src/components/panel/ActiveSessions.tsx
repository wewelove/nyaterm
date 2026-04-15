import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdClose, MdRefresh, MdSearch } from "react-icons/md";
import PanelHeader from "@/components/layout/PanelHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionInfo } from "@/types/global";

interface ActiveSessionsProps {
  onSessionClick: (sessionId: string) => void;
  onSessionReconnect: (sessionId: string) => Promise<void> | void;
  onSessionDisconnect: (sessionId: string) => Promise<void> | void;
  canReconnect: (sessionId: string) => boolean;
}

/** List of active sessions (polled). Click switches to that session's tab. */
function ActiveSessions({
  onSessionClick,
  onSessionReconnect,
  onSessionDisconnect,
  canReconnect,
}: ActiveSessionsProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [search, setSearch] = useState("");
  const [busyActions, setBusyActions] = useState<Record<string, "reconnect" | "disconnect">>({});

  const fetchSessions = useCallback(async () => {
    try {
      const sess = await invoke<SessionInfo[]>("list_sessions");
      sess.sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.session_type.localeCompare(b.session_type),
      );
      setSessions(sess);
    } catch {
      // Backend might not be ready yet
    }
  }, []);

  const runAction = useCallback(
    async (sessionId: string, action: "reconnect" | "disconnect") => {
      setBusyActions((prev) => ({ ...prev, [sessionId]: action }));
      try {
        if (action === "reconnect") {
          await onSessionReconnect(sessionId);
        } else {
          await onSessionDisconnect(sessionId);
        }
      } finally {
        setBusyActions((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      }
    },
    [onSessionDisconnect, onSessionReconnect],
  );

  useEffect(() => {
    fetchSessions();
    const unlisten = listen("sessions-changed", () => {
      fetchSessions();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchSessions]);

  const query = search.trim().toLowerCase();
  const filteredSessions = query
    ? sessions.filter((session) =>
        `${session.name} ${session.session_type} ${session.id}`.toLowerCase().includes(query),
      )
    : sessions;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PanelHeader
        title={t("panel.activeSessions")}
        actions={
          <span className="text-[0.6875rem]" style={{ color: "var(--df-text-dimmed)" }}>
            {query ? `${filteredSessions.length}/${sessions.length}` : sessions.length}
          </span>
        }
      />

      <div
        className="border-b px-2 py-1.5"
        style={{ borderColor: "var(--df-border)", backgroundColor: "var(--df-bg-panel)" }}
      >
        <div className="relative shrink-0">
          <MdSearch
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[0.875rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("activeSessions.searchPlaceholder")}
            className="h-7 border-0 pl-7 text-xs shadow-none placeholder:text-[var(--df-text-dimmed)] text-[var(--df-text)] bg-[var(--df-bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--df-primary)] focus-visible:bg-transparent"
          />
        </div>
      </div>

      <div className="terminal-scroll flex-1 overflow-y-auto p-2 text-xs space-y-1">
        {sessions.length === 0 ? (
          <div
            className="text-center py-4 text-[0.6875rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {t("panel.noActiveSessions")}
          </div>
        ) : filteredSessions.length === 0 ? (
          <div
            className="text-center py-4 text-[0.6875rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {t("activeSessions.noMatches")}
          </div>
        ) : (
          filteredSessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center gap-2 rounded-md p-2 transition-colors df-hover ${!session.connected ? "opacity-50" : ""}`}
              onClick={() => onSessionClick(session.id)}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: session.connected ? "#22c55e" : "var(--df-text-dimmed)" }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate" style={{ color: "var(--df-text)" }}>
                    {session.name}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide"
                    style={{
                      color: "var(--df-text-dimmed)",
                      backgroundColor: "var(--df-bg-hover)",
                    }}
                  >
                    {session.session_type}
                  </span>
                </div>
                <div
                  className="truncate font-mono text-[0.625rem]"
                  style={{ color: "var(--df-text-dimmed)" }}
                  title={session.id}
                >
                  {session.id}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40"
                  disabled={!!busyActions[session.id] || !canReconnect(session.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    void runAction(session.id, "reconnect");
                  }}
                  aria-label={t("tabCtx.reconnect")}
                >
                  <MdRefresh
                    className={`h-4 w-4 ${busyActions[session.id] === "reconnect" ? "animate-spin" : ""}`}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-destructive disabled:opacity-40"
                  disabled={!!busyActions[session.id]}
                  onClick={(event) => {
                    event.stopPropagation();
                    void runAction(session.id, "disconnect");
                  }}
                  aria-label={t("activeSessions.disconnect")}
                >
                  <MdClose className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default memo(ActiveSessions);
