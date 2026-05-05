import { useEffect, useMemo, useState } from "react";
import { collectSessionPanes, findTabBySessionId } from "@/lib/workspaceTabs";
import type { Tab } from "@/types/global";

export function useUnreadTabs(tabs: Tab[], activeTabId: string | null) {
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (event: Event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;
      const tab = findTabBySessionId(tabs, sessionId);
      if (tab && tab.id !== activeTabId) {
        setUnreadSessionIds((prev) => {
          if (prev.has(sessionId)) return prev;
          const next = new Set(prev);
          next.add(sessionId);
          return next;
        });
      }
    };

    window.addEventListener("nyaterm:session-output", handler);
    return () => window.removeEventListener("nyaterm:session-output", handler);
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (!activeTabId) return;

    const tab = tabs.find((item) => item.id === activeTabId);
    if (!tab) return;

    const paneSessionIds = new Set(collectSessionPanes(tab.root).map((pane) => pane.sessionId));
    setUnreadSessionIds((prev) => {
      const hasUnreadPane = [...prev].some((id) => paneSessionIds.has(id));
      if (!hasUnreadPane) return prev;

      const next = new Set(prev);
      for (const id of paneSessionIds) {
        next.delete(id);
      }
      return next;
    });
  }, [activeTabId, tabs]);

  return useMemo(() => {
    const result = new Set<string>();
    for (const sessionId of unreadSessionIds) {
      const tab = findTabBySessionId(tabs, sessionId);
      if (tab) result.add(tab.id);
    }
    return result;
  }, [unreadSessionIds, tabs]);
}
