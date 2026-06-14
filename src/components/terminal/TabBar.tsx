import {
  type DragEvent,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  MdAdd,
  MdCellTower,
  MdChevronLeft,
  MdChevronRight,
  MdClose,
  MdContentCopy,
  MdDns,
  MdErrorOutline,
  MdFolder,
  MdHistory,
  MdTerminal,
} from "react-icons/md";
import { toast } from "sonner";
import { getActiveGroupForSession, isSessionPausedInGroup } from "@/lib/syncInputGroups";
import { getActivePane, getTabDisplayName } from "@/lib/workspaceTabs";
import type { Group, PaneSplitDirection, SavedConnection, Tab } from "@/types/global";
import { useApp } from "../../context/AppContext";
import { CONNECTION_ICONS } from "../icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import TabContextMenu from "./TabContextMenu";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  focusedTabId?: string | null;
  unreadTabIds?: Set<string>;
  onTabChange: (tabId: string) => void;
  onTabClose: (tab: Tab) => void | Promise<void>;
  onAddTab: () => void;
  onConnectConnection: (connection: SavedConnection) => void | Promise<void>;
  onDuplicateSession: (tab: Tab) => void | Promise<void>;
  onMultiplexSshSession: (tab: Tab) => void | Promise<void>;
  onReconnectSession: (tab: Tab) => void | Promise<void>;
  onDisconnectSession: (tab: Tab) => void | Promise<void>;
  onSplitSession: (tab: Tab, direction: PaneSplitDirection) => void | Promise<void>;
  onUnsplit?: () => void;
  onCloseSession: (tab: Tab) => void | Promise<void>;
  onCloseAll: () => void | Promise<void>;
  onCloseInactive: (keepTabId: string) => void | Promise<void>;
  onCloseRight: (tabId: string) => void | Promise<void>;
  onSessionInfo: (tab: Tab) => void | Promise<void>;
  onReorderTabs: (fromTabId: string, toIndex: number) => void;
  onMoveTabHere?: (fromTabId: string, toIndex: number) => void;
}

interface ConnectionGroupNode {
  group: Group;
  children: ConnectionGroupNode[];
  connections: SavedConnection[];
  totalCount: number;
}

const TAB_STRIP_SCROLL_DURATION_MS = 180;
const TAB_STRIP_SCROLL_PADDING = 12;

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function clampTabStripScrollLeft(strip: HTMLElement, value: number): number {
  const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
  return Math.max(0, Math.min(maxScrollLeft, value));
}

function animateTabStripScroll(
  strip: HTMLElement,
  targetScrollLeft: number,
  onComplete?: () => void,
): () => void {
  const startScrollLeft = strip.scrollLeft;
  const clampedTarget = clampTabStripScrollLeft(strip, targetScrollLeft);
  const distance = clampedTarget - startScrollLeft;

  if (Math.abs(distance) < 0.5) {
    strip.scrollLeft = clampedTarget;
    onComplete?.();
    return () => {};
  }

  const startTime = performance.now();
  let rafId = 0;

  const step = (now: number) => {
    const progress = Math.min(1, (now - startTime) / TAB_STRIP_SCROLL_DURATION_MS);
    strip.scrollLeft = startScrollLeft + distance * easeOutCubic(progress);
    if (progress < 1) {
      rafId = requestAnimationFrame(step);
      return;
    }
    strip.scrollLeft = clampedTarget;
    onComplete?.();
  };

  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
}

function compareSortOrder(left: { sort_order?: number }, right: { sort_order?: number }) {
  return (left.sort_order ?? 0) - (right.sort_order ?? 0);
}

function SyncIndicator({
  tab,
  syncGroups,
  broadcastToAll,
}: {
  tab: Tab;
  syncGroups: import("@/types/global").SyncGroup[];
  broadcastToAll: boolean;
}) {
  const pane = getActivePane(tab);
  const sessionId = pane?.sessionId;

  const activeGroup = useMemo(() => {
    if (!sessionId || pane?.connecting || pane?.connectError) return null;
    if (broadcastToAll) return null;
    return getActiveGroupForSession(sessionId, syncGroups);
  }, [sessionId, syncGroups, broadcastToAll, pane?.connecting, pane?.connectError]);

  const isMember = broadcastToAll || !!activeGroup;
  const isPaused =
    activeGroup && sessionId ? isSessionPausedInGroup(activeGroup, sessionId) : false;

  if (!isMember) return null;

  return (
    <MdCellTower
      className="text-[11px] shrink-0"
      style={{
        color: activeGroup?.color ?? "var(--df-primary)",
        opacity: isPaused ? 0.4 : 1,
      }}
    />
  );
}

/** Tab strip for workspace tabs. Drag-reorder is runtime-only. */
function TabBar({
  tabs,
  activeTabId,
  focusedTabId,
  unreadTabIds,
  onTabChange,
  onTabClose,
  onAddTab,
  onConnectConnection,
  onDuplicateSession,
  onMultiplexSshSession,
  onReconnectSession,
  onDisconnectSession,
  onSplitSession,
  onUnsplit,
  onCloseSession,
  onCloseAll,
  onCloseInactive,
  onCloseRight,
  onSessionInfo,
  onReorderTabs,
  onMoveTabHere,
}: TabBarProps) {
  const { t } = useTranslation();
  const { appSettings, savedConnections, savedGroups, syncGroups, broadcastToAll } = useApp();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef(new Map<string, HTMLDivElement>());
  const draggedTabIdRef = useRef<string | null>(null);
  const tabStripAnimatingRef = useRef(false);
  const tabStripScrollAnimationRef = useRef<(() => void) | null>(null);
  const [tabStripScroll, setTabStripScroll] = useState({
    canScrollLeft: false,
    canScrollRight: false,
    hasOverflow: false,
  });

  const groupsById = useMemo(
    () => new Map(savedGroups.map((group) => [group.id, group])),
    [savedGroups],
  );

  const connectionTree = useMemo(() => {
    const sortedConnections = [...savedConnections].sort(compareSortOrder);
    const sortedGroups = [...savedGroups].sort(compareSortOrder);
    const nodesById = new Map<string, ConnectionGroupNode>();

    for (const group of sortedGroups) {
      nodesById.set(group.id, {
        group,
        children: [],
        connections: [],
        totalCount: 0,
      });
    }

    const ungrouped: SavedConnection[] = [];
    for (const connection of sortedConnections) {
      if (connection.group_id && nodesById.has(connection.group_id)) {
        nodesById.get(connection.group_id)?.connections.push(connection);
      } else {
        ungrouped.push(connection);
      }
    }

    const roots: ConnectionGroupNode[] = [];
    for (const group of sortedGroups) {
      const node = nodesById.get(group.id);
      if (!node) continue;
      if (group.parent_id && nodesById.has(group.parent_id)) {
        nodesById.get(group.parent_id)?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const computeTotal = (node: ConnectionGroupNode): number => {
      node.totalCount =
        node.connections.length +
        node.children.reduce((sum, child) => sum + computeTotal(child), 0);
      return node.totalCount;
    };
    roots.forEach(computeTotal);

    const pruneEmpty = (node: ConnectionGroupNode): ConnectionGroupNode | null => {
      const children = node.children
        .map(pruneEmpty)
        .filter((child): child is ConnectionGroupNode => !!child);
      if (node.connections.length === 0 && children.length === 0) return null;
      return { ...node, children };
    };

    return {
      roots: roots.map(pruneEmpty).filter((node): node is ConnectionGroupNode => !!node),
      ungrouped,
    };
  }, [savedConnections, savedGroups]);

  const shellConnections = useMemo(
    () =>
      savedConnections
        .filter((connection) => connection.type === "local_terminal")
        .sort(compareSortOrder),
    [savedConnections],
  );

  const recentConnections = useMemo(() => {
    const byId = new Map(savedConnections.map((connection) => [connection.id, connection]));
    return (appSettings.ui.recent_connection_ids ?? [])
      .map((connectionId) => byId.get(connectionId))
      .filter((connection): connection is SavedConnection => !!connection)
      .slice(0, 10);
  }, [appSettings.ui.recent_connection_ids, savedConnections]);

  const updateTabStripScrollState = useCallback(() => {
    const strip = tabStripRef.current;
    if (!strip) return;

    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const nextState = {
      canScrollLeft: strip.scrollLeft > 1,
      canScrollRight: strip.scrollLeft < maxScrollLeft - 1,
      hasOverflow: maxScrollLeft > 1,
    };

    setTabStripScroll((current) =>
      current.canScrollLeft === nextState.canScrollLeft &&
      current.canScrollRight === nextState.canScrollRight &&
      current.hasOverflow === nextState.hasOverflow
        ? current
        : nextState,
    );
  }, []);

  const runTabStripScrollAnimation = useCallback(
    (targetScrollLeft: number) => {
      const strip = tabStripRef.current;
      if (!strip) return;

      tabStripScrollAnimationRef.current?.();
      tabStripAnimatingRef.current = true;
      tabStripScrollAnimationRef.current = animateTabStripScroll(strip, targetScrollLeft, () => {
        tabStripScrollAnimationRef.current = null;
        tabStripAnimatingRef.current = false;
        updateTabStripScrollState();
      });
    },
    [updateTabStripScrollState],
  );

  const getTabStripStepTarget = useCallback((direction: -1 | 1): number | null => {
    const strip = tabStripRef.current;
    if (!strip) return null;

    const pageWidth = strip.clientWidth;
    const targetScrollLeft =
      direction === 1 ? strip.scrollLeft + pageWidth : strip.scrollLeft - pageWidth;
    const clampedTarget = clampTabStripScrollLeft(strip, targetScrollLeft);

    if (Math.abs(clampedTarget - strip.scrollLeft) < 1) return null;
    return clampedTarget;
  }, []);

  const scrollTabStripPage = useCallback(
    (direction: -1 | 1) => {
      if (tabStripAnimatingRef.current) return;
      const targetScrollLeft = getTabStripStepTarget(direction);
      if (targetScrollLeft === null) return;
      runTabStripScrollAnimation(targetScrollLeft);
    },
    [getTabStripStepTarget, runTabStripScrollAnimation],
  );

  const getActiveTabScrollTarget = useCallback((): number | null => {
    if (!activeTabId) return null;

    const strip = tabStripRef.current;
    const tabElement = tabButtonRefs.current.get(activeTabId);
    if (!strip || !tabElement) return null;

    const scrollLeft = strip.scrollLeft;
    const viewportRight = scrollLeft + strip.clientWidth;
    const padding = TAB_STRIP_SCROLL_PADDING;
    const tabLeft = tabElement.offsetLeft;
    const tabRight = tabLeft + tabElement.offsetWidth;

    if (tabLeft >= scrollLeft + padding && tabRight <= viewportRight - padding) {
      return null;
    }

    if (tabLeft < scrollLeft + padding) {
      return clampTabStripScrollLeft(strip, tabLeft - padding);
    }

    return clampTabStripScrollLeft(strip, tabRight - strip.clientWidth + padding);
  }, [activeTabId]);

  const scrollActiveTabIntoView = useCallback(
    (smooth: boolean) => {
      const targetScrollLeft = getActiveTabScrollTarget();
      if (targetScrollLeft === null) return;

      if (smooth) {
        runTabStripScrollAnimation(targetScrollLeft);
        return;
      }

      const strip = tabStripRef.current;
      if (!strip) return;
      strip.scrollLeft = targetScrollLeft;
      updateTabStripScrollState();
    },
    [getActiveTabScrollTarget, runTabStripScrollAnimation, updateTabStripScrollState],
  );

  const handleTabStripScroll = useCallback(() => {
    if (tabStripAnimatingRef.current) return;
    updateTabStripScrollState();
  }, [updateTabStripScrollState]);

  useLayoutEffect(() => {
    updateTabStripScrollState();
  }, [tabs, updateTabStripScrollState]);

  useLayoutEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) return;

    const observer = new ResizeObserver(() => {
      updateTabStripScrollState();
      scrollActiveTabIntoView(false);
    });
    observer.observe(strip);

    return () => observer.disconnect();
  }, [scrollActiveTabIntoView, tabs, updateTabStripScrollState]);

  useLayoutEffect(() => {
    scrollActiveTabIntoView(true);
  }, [activeTabId, scrollActiveTabIntoView]);

  useLayoutEffect(
    () => () => {
      tabStripScrollAnimationRef.current?.();
      tabStripScrollAnimationRef.current = null;
      tabStripAnimatingRef.current = false;
    },
    [],
  );

  const handleTabStripWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const strip = tabStripRef.current;
      if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;

      event.preventDefault();
      event.stopPropagation();

      // Wheel: continuous proportional scroll (natural for trackpad / mouse wheel).
      tabStripScrollAnimationRef.current?.();
      tabStripScrollAnimationRef.current = null;
      tabStripAnimatingRef.current = false;

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(delta) < 0.5) return;

      strip.scrollLeft = clampTabStripScrollLeft(strip, strip.scrollLeft + delta);
      updateTabStripScrollState();
    },
    [updateTabStripScrollState],
  );

  const getInsertionIndex = useCallback((event: DragEvent<HTMLDivElement>, index: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? index : index + 1;
  }, []);

  const resetDragState = useCallback(() => {
    draggedTabIdRef.current = null;
    setDraggedTabId(null);
    setDropIndex(null);
  }, []);

  const setVisibleTabRef = useCallback((tabId: string, element: HTMLDivElement | null) => {
    if (element) {
      tabButtonRefs.current.set(tabId, element);
    } else {
      tabButtonRefs.current.delete(tabId);
    }
  }, []);

  const getInsertionIndexFromClientX = useCallback(
    (clientX: number) => {
      for (const tab of tabs) {
        const element = tabButtonRefs.current.get(tab.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const tabIndex = tabs.findIndex((item) => item.id === tab.id);
        if (tabIndex === -1) continue;
        if (clientX < rect.left + rect.width / 2) return tabIndex;
        if (clientX <= rect.right) return tabIndex + 1;
      }
      return tabs.length;
    },
    [tabs],
  );

  const handleDropAtIndex = useCallback(
    (insertionIndex: number, event?: DragEvent<HTMLDivElement>) => {
      const externalTabId = event?.dataTransfer.getData("application/nyaterm-tab");
      const effectiveTabId = draggedTabIdRef.current || draggedTabId || externalTabId;
      if (!effectiveTabId) return;

      const fromIndex = tabs.findIndex((tab) => tab.id === effectiveTabId);
      if (fromIndex === -1) {
        if (onMoveTabHere) {
          onMoveTabHere(effectiveTabId, insertionIndex);
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
          });
        }
        resetDragState();
        return;
      }

      const nextIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
      onReorderTabs(effectiveTabId, nextIndex);
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
      });
      resetDragState();
    },
    [draggedTabId, onMoveTabHere, onReorderTabs, resetDragState, tabs],
  );

  const handleDragStart = (event: DragEvent<HTMLDivElement>, tabId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tabId);
    event.dataTransfer.setData("application/nyaterm-tab", tabId);
    draggedTabIdRef.current = tabId;
    setDraggedTabId(tabId);
    setDropIndex(tabs.findIndex((tab) => tab.id === tabId));
  };

  const handleDragEnd = (event: DragEvent<HTMLDivElement>) => {
    const fallbackTabId = draggedTabIdRef.current;
    const strip = tabStripRef.current;
    if (fallbackTabId && strip && event.clientX !== 0) {
      const rect = strip.getBoundingClientRect();
      const horizontalTolerance = 48;
      const isNearTabStrip =
        event.clientX >= rect.left - horizontalTolerance &&
        event.clientX <= rect.right + horizontalTolerance;
      if (isNearTabStrip) {
        handleDropAtIndex(getInsertionIndexFromClientX(event.clientX));
        return;
      }
    }

    resetDragState();
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
    });
  };

  const renderTabIcon = (tab: Tab) => {
    const pane = getActivePane(tab);

    if (pane?.connecting) {
      return (
        <svg
          aria-hidden="true"
          className="shrink-0 animate-spin"
          style={{ width: "0.875rem", height: "0.875rem", color: "var(--df-primary)" }}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      );
    }

    if (pane?.connectError) {
      return (
        <MdErrorOutline
          className="text-sm shrink-0"
          style={{ color: "var(--destructive, #ef4444)" }}
        />
      );
    }

    const conn = pane?.connectionId
      ? savedConnections.find((connection) => connection.id === pane.connectionId)
      : undefined;
    const iconDef = conn?.icon ? CONNECTION_ICONS[conn.icon] : null;
    if (iconDef) {
      const IconComp = iconDef.icon;
      return <IconComp className="text-sm shrink-0" style={{ color: iconDef.color }} />;
    }

    if (pane?.type === "Local") {
      return <MdTerminal className="text-sm shrink-0" />;
    }

    return <MdDns className="text-sm shrink-0" />;
  };

  const buildGroupPath = (groupId: string | undefined) => {
    const parts: string[] = [];
    let currentId = groupId;
    while (currentId) {
      const group = groupsById.get(currentId);
      if (!group) break;
      parts.unshift(group.name);
      currentId = group.parent_id;
    }
    return parts.join("/");
  };

  const getConnectionProtocol = (connection: SavedConnection) => {
    switch (connection.type) {
      case "local_terminal":
        return "shell";
      case "telnet":
        return "telnet";
      case "serial":
        return "serial";
      default:
        return "ssh";
    }
  };

  const getRecentConnectionLabel = (connection: SavedConnection) => {
    const groupPath = buildGroupPath(connection.group_id);
    const path = [groupPath, connection.name].filter(Boolean).join("/");
    return `${getConnectionProtocol(connection)}://${path || connection.name}`;
  };

  const renderConnectionIcon = (connection: SavedConnection) => {
    const iconDef = connection.icon ? CONNECTION_ICONS[connection.icon] : null;
    if (iconDef) {
      const IconComp = iconDef.icon;
      return <IconComp className="text-sm shrink-0" style={{ color: iconDef.color }} />;
    }

    if (connection.type === "local_terminal") {
      return <MdTerminal className="text-sm shrink-0 text-emerald-500/70" />;
    }

    return <MdDns className="text-sm shrink-0 text-emerald-500/70" />;
  };

  const renderTabItem = (tab: Tab, index: number) => {
    const isActive = activeTabId === tab.id;
    const isFocused = focusedTabId === tab.id;
    const showUnreadIndicator = !isFocused && unreadTabIds?.has(tab.id);
    const displayName = getTabDisplayName(tab);
    const accentColor = tab.tabColor;

    const tabButton = (
      <div
        draggable
        className={`group relative flex items-center gap-2 border-r pl-3 pr-2 text-xs transition-[color,background-color,opacity] duration-200 ${
          isActive ? "font-semibold" : "font-medium df-hover"
        } ${draggedTabId === tab.id ? "opacity-60" : ""}`}
        style={{
          borderColor: "var(--df-border)",
          backgroundColor: isActive
            ? accentColor
              ? `color-mix(in srgb, ${accentColor} 8%, var(--df-bg))`
              : "var(--df-bg)"
            : accentColor
              ? `color-mix(in srgb, ${accentColor} 5%, transparent)`
              : "transparent",
          color: isActive ? "var(--df-text)" : "var(--df-text-muted)",
        }}
        onClick={() => onTabChange(tab.id)}
        onContextMenu={() => onTabChange(tab.id)}
        onDragStart={(event) => handleDragStart(event, tab.id)}
        onDragEnd={(event) => {
          handleDragEnd(event);
        }}
        onDragOver={(event) => {
          if (!draggedTabId && !event.dataTransfer.types.includes("application/nyaterm-tab"))
            return;
          event.preventDefault();
          setDropIndex(getInsertionIndex(event, index));
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleDropAtIndex(getInsertionIndex(event, index), event);
        }}
      >
        {isActive && (
          <div
            className="absolute top-0 left-0 h-[2px] w-full"
            style={{
              backgroundColor: accentColor || "var(--df-primary)",
              boxShadow: `0 1px 4px ${accentColor || "var(--df-primary)"}`,
            }}
          />
        )}

        {isActive && (
          <div
            className="absolute bottom-0 left-0 z-10 h-[1px] w-full"
            style={{ backgroundColor: "var(--df-bg)" }}
          />
        )}

        {renderTabIcon(tab)}

        <span
          className="shrink-0 min-w-[1.25em] text-xs font-semibold tabular-nums leading-none"
          style={{ color: isActive ? "var(--df-text-muted)" : "var(--df-text-dimmed)" }}
          aria-hidden="true"
        >
          {index + 1}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="max-w-[160px] truncate whitespace-nowrap">{displayName}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} showArrow className="max-w-xs truncate">
            {index + 1}. {displayName}
          </TooltipContent>
        </Tooltip>

        <SyncIndicator tab={tab} syncGroups={syncGroups} broadcastToAll={broadcastToAll} />

        {(() => {
          const pane = getActivePane(tab);
          const conn = pane?.connectionId
            ? savedConnections.find((c) => c.id === pane.connectionId)
            : undefined;
          const host = conn?.host;
          if (host) {
            return (
              <div
                className="ml-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[var(--df-text-dimmed)] opacity-0 transition-all duration-200 hover:text-[var(--df-primary)] active:scale-90 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  navigator.clipboard.writeText(host).catch(() => {});
                  toast.success(t("tabCtx.ipCopied"));
                }}
                title={host}
              >
                <MdContentCopy className="text-[10px]" />
              </div>
            );
          }
          return null;
        })()}

        <div className="relative ml-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          {showUnreadIndicator ? (
            <span className="h-2 w-2 rounded-full bg-green-500 animate-breathing" />
          ) : (
            <div
              className={`absolute inset-0 flex items-center justify-center rounded transition-all duration-200 ${
                isActive
                  ? "text-[var(--df-text-muted)]"
                  : "text-[var(--df-text-dimmed)] opacity-0 group-hover:opacity-100"
              } hover:!bg-red-500/10 hover:!text-red-500 active:scale-90 active:!bg-red-500/20`}
              onClick={(event) => {
                event.stopPropagation();
                void onTabClose(tab);
              }}
            >
              <MdClose className="text-[12px]" />
            </div>
          )}
        </div>
      </div>
    );

    return (
      <div
        key={tab.id}
        ref={(element) => setVisibleTabRef(tab.id, element)}
        className="relative flex shrink-0"
      >
        {dropIndex === index && (draggedTabId || dropIndex !== null) && (
          <div
            className="pointer-events-none absolute inset-y-1 left-0 z-20 w-0.5 rounded-full"
            style={{ backgroundColor: "var(--df-primary)" }}
          />
        )}

        <TabContextMenu
          tab={tab}
          tabs={tabs}
          onDuplicateSession={onDuplicateSession}
          onMultiplexSshSession={onMultiplexSshSession}
          onReconnectSession={onReconnectSession}
          onDisconnectSession={onDisconnectSession}
          onSplitSession={onSplitSession}
          onUnsplit={onUnsplit}
          onCloseSession={onCloseSession}
          onCloseAll={onCloseAll}
          onCloseInactive={onCloseInactive}
          onCloseRight={onCloseRight}
          onSessionInfo={onSessionInfo}
          onActivateTab={onTabChange}
        >
          {tabButton}
        </TabContextMenu>
      </div>
    );
  };

  const renderConnectionMenuItem = (connection: SavedConnection, label = connection.name) => (
    <DropdownMenuItem
      key={connection.id}
      className="max-w-[320px]"
      onSelect={() => void onConnectConnection(connection)}
      title={label}
    >
      {renderConnectionIcon(connection)}
      <span className="min-w-0 truncate">{label}</span>
    </DropdownMenuItem>
  );

  const renderEmptyMenuItem = (label: string) => (
    <DropdownMenuItem disabled className="text-muted-foreground">
      <span className="truncate">{label}</span>
    </DropdownMenuItem>
  );

  const renderGroupNode = (node: ConnectionGroupNode) => (
    <DropdownMenuSub key={node.group.id}>
      <DropdownMenuSubTrigger className="max-w-[320px]">
        <MdFolder className="text-sm shrink-0 text-amber-500/70" />
        <span className="min-w-0 truncate">{node.group.name}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[240px] max-w-[340px] max-h-[70vh] overflow-y-auto">
        {node.children.map(renderGroupNode)}
        {node.children.length > 0 && node.connections.length > 0 && <DropdownMenuSeparator />}
        {node.connections.map((connection) => renderConnectionMenuItem(connection))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  return (
    <div
      className="flex h-9 shrink-0"
      style={{
        backgroundColor: "var(--df-bg-panel)",
        boxShadow: "inset 0 -1px 0 var(--df-border)",
      }}
    >
      {tabStripScroll.hasOverflow && (
        <button
          type="button"
          className="flex h-full w-7 shrink-0 items-center justify-center border-r transition-colors df-hover disabled:opacity-30"
          style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)" }}
          aria-label={t("terminal.scrollTabsLeft")}
          disabled={!tabStripScroll.canScrollLeft}
          onClick={() => scrollTabStripPage(-1)}
        >
          <MdChevronLeft className="text-base" />
        </button>
      )}

      <div
        ref={tabStripRef}
        className="tab-strip-scroll relative flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
        onScroll={handleTabStripScroll}
        onWheel={handleTabStripWheel}
      >
        {tabs.map((tab) =>
          renderTabItem(
            tab,
            tabs.findIndex((item) => item.id === tab.id),
          ),
        )}

        <div
          className="relative flex min-w-6 flex-1 shrink-0"
          onDragOver={(event) => {
            if (!draggedTabId && !event.dataTransfer.types.includes("application/nyaterm-tab"))
              return;
            event.preventDefault();
            setDropIndex(tabs.length);
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleDropAtIndex(tabs.length, event);
          }}
        >
          {(draggedTabId || dropIndex !== null) && dropIndex === tabs.length && (
            <div
              className="pointer-events-none absolute inset-y-1 left-0 z-20 w-0.5 rounded-full"
              style={{ backgroundColor: "var(--df-primary)" }}
            />
          )}
        </div>
      </div>

      {tabStripScroll.hasOverflow && (
        <button
          type="button"
          className="flex h-full w-7 shrink-0 items-center justify-center border-l transition-colors df-hover disabled:opacity-30"
          style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)" }}
          aria-label={t("terminal.scrollTabsRight")}
          disabled={!tabStripScroll.canScrollRight}
          onClick={() => scrollTabStripPage(1)}
        >
          <MdChevronRight className="text-base" />
        </button>
      )}

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-full w-9 shrink-0 items-center justify-center border-l transition-colors df-hover"
                style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)" }}
                aria-label={t("terminal.newSession")}
              >
                <MdAdd className="text-base" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} showArrow>
            {t("terminal.newSession")}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-[260px] max-w-[360px]">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => onAddTab()}>
              <MdAdd className="text-sm text-muted-foreground" />
              {t("terminal.newSession")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <MdDns className="text-sm text-muted-foreground" />
                {t("terminal.allSessions")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[260px] max-w-[360px] max-h-[70vh] overflow-y-auto">
                {connectionTree.roots.length === 0 && connectionTree.ungrouped.length === 0 ? (
                  renderEmptyMenuItem(t("terminal.noSavedSessions"))
                ) : (
                  <>
                    {connectionTree.roots.map(renderGroupNode)}
                    {connectionTree.roots.length > 0 && connectionTree.ungrouped.length > 0 && (
                      <DropdownMenuSeparator />
                    )}
                    {connectionTree.ungrouped.map((connection) =>
                      renderConnectionMenuItem(connection),
                    )}
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground">
            {t("terminal.shellSessions")}
          </DropdownMenuLabel>
          {shellConnections.length > 0
            ? shellConnections.map((connection) => renderConnectionMenuItem(connection))
            : renderEmptyMenuItem(t("terminal.noShellSessions"))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <MdHistory className="text-sm" />
              {t("terminal.recentSessions")}
            </span>
          </DropdownMenuLabel>
          {recentConnections.length > 0
            ? recentConnections.map((connection) =>
                renderConnectionMenuItem(connection, getRecentConnectionLabel(connection)),
              )
            : renderEmptyMenuItem(t("terminal.noRecentSessions"))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default memo(TabBar);
