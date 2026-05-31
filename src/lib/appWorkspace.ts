import type { TerminalWindowNode } from "@/lib/tabWindows";
import { collectSessionPanes } from "@/lib/workspaceTabs";
import type { ActivityBarLayout, SessionPane, Tab } from "@/types/global";

export const NON_PANEL_IDS = new Set([
  "settings",
  "lock",
  "quickCmdBar",
  "serialSend",
]);

export type TrayAction =
  | { type: "open_new_session" }
  | { type: "focus_session"; sessionId: string }
  | { type: "open_panel"; panelId: "activeSessions" | "syncBackupHistory" }
  | { type: "open_settings" }
  | { type: "lock_screen" }
  | { type: "check_updates" }
  | { type: "request_quit" };

export function canCreateSessionFromPane(
  pane: Pick<SessionPane, "type" | "connectionId"> | null | undefined,
): pane is Pick<SessionPane, "type" | "connectionId"> {
  return !!pane && (pane.type === "Local" || !!pane.connectionId);
}

export function hasLiveSession<T extends Pick<SessionPane, "connecting" | "connectError">>(
  pane: T | null | undefined,
): pane is T {
  return !!pane && !pane.connecting && !pane.connectError;
}

export function getItemSide(id: string, layout: ActivityBarLayout): "left" | "right" | null {
  if (layout.left_top.includes(id) || layout.left_bottom.includes(id)) return "left";
  if (layout.right_top.includes(id) || layout.right_bottom.includes(id)) return "right";
  return null;
}

export function collectActiveShellSessionIds(
  layout: TerminalWindowNode | null,
  tabsById: Map<string, Tab>,
) {
  if (!layout) return [];

  const sessionIds = new Set<string>();

  const visit = (node: TerminalWindowNode) => {
    if (node.kind === "split") {
      visit(node.first);
      visit(node.second);
      return;
    }

    for (const tabId of node.tabIds) {
      const tab = tabsById.get(tabId);
      if (!tab) continue;

      for (const pane of collectSessionPanes(tab.root)) {
        if (hasLiveSession(pane) && pane.type === "SSH") {
          sessionIds.add(pane.sessionId);
        }
      }
    }
  };

  visit(layout);
  return [...sessionIds];
}
