import type { TFunction } from "i18next";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { BiServer } from "react-icons/bi";
import { FaRegFolder } from "react-icons/fa";
import { LuKeyRound } from "react-icons/lu";
import {
  MdAutoAwesome,
  MdBackup,
  MdBolt,
  MdHistory,
  MdLan,
  MdLink,
  MdLock,
  MdOutlineMonitorHeart,
  MdSend,
  MdSettings,
} from "react-icons/md";
import { PiRecordFill } from "react-icons/pi";
import type { ActivityBarItem } from "@/components/layout/ActivityBar";
import { getItemSide } from "@/lib/appWorkspace";
import { openSettings } from "@/lib/windowManager";
import type { ActivityBarLayout, ActivityBarZone, UiConfig } from "@/types/global";

type UpdateUi = (updates: Partial<UiConfig> | ((prev: UiConfig) => Partial<UiConfig>)) => void;

interface UseActivityBarControllerOptions {
  uiConfig: UiConfig;
  recordingSessions: Set<string>;
  updateUi: UpdateUi;
  setIsLocked: (locked: boolean) => void;
  t: TFunction;
}

export function useActivityBarController({
  uiConfig,
  recordingSessions,
  updateUi,
  setIsLocked,
  t,
}: UseActivityBarControllerOptions) {
  const itemRegistry = useMemo<Record<string, { icon: ReactNode; tooltip: string }>>(
    () => ({
      fileExplorer: { icon: <FaRegFolder />, tooltip: t("panel.fileExplorer") },
      network: { icon: <MdLan />, tooltip: t("panel.network") },
      securityAuth: { icon: <LuKeyRound />, tooltip: t("securityAuth.title") },
      syncBackupHistory: { icon: <MdBackup />, tooltip: t("panel.syncBackupHistory") },
      settings: { icon: <MdSettings />, tooltip: t("settings.title") },
      savedConnections: { icon: <BiServer />, tooltip: t("panel.savedConnections") },
      aiAssistant: { icon: <MdAutoAwesome />, tooltip: t("ai.title") },
      activeSessions: { icon: <MdLink />, tooltip: t("panel.activeSessions") },
      commandHistory: { icon: <MdHistory />, tooltip: t("panel.commandHistory") },
      resourceMonitor: { icon: <MdOutlineMonitorHeart />, tooltip: t("panel.resourceMonitor") },
      quickCmdBar: { icon: <MdBolt />, tooltip: t("panel.quickCommands") },
      serialSend: { icon: <MdSend />, tooltip: t("panel.serialSend", "Command Send") },
      recording: {
        icon: (
          <PiRecordFill
            className={recordingSessions.size > 0 ? "animate-pulse" : undefined}
          />
        ),
        tooltip: t("recording.panelTitle"),
      },
      lock: { icon: <MdLock />, tooltip: t("statusBar.lock") },
    }),
    [recordingSessions, t],
  );

  const layout = uiConfig.activity_bar_layout;

  useEffect(() => {
    const allIds = [
      ...layout.left_top,
      ...layout.left_bottom,
      ...layout.right_top,
      ...layout.right_bottom,
    ];
    const needsSyncBackupHistory = !allIds.includes("syncBackupHistory");
    const needsAiAssistant = !allIds.includes("aiAssistant");
    const needsSerialSend = !allIds.includes("serialSend");
    const needsRecording = !allIds.includes("recording");
    if (!needsSyncBackupHistory && !needsAiAssistant && !needsSerialSend && !needsRecording) return;

    updateUi((prev) => {
      const nextLeftBottom = [...prev.activity_bar_layout.left_bottom];
      const nextRightTop = [...prev.activity_bar_layout.right_top];
      const nextRightBottom = [...prev.activity_bar_layout.right_bottom];

      if (!nextLeftBottom.includes("syncBackupHistory")) {
        const settingsIndex = nextLeftBottom.indexOf("settings");
        if (settingsIndex !== -1) {
          nextLeftBottom.splice(settingsIndex, 0, "syncBackupHistory");
        } else {
          nextLeftBottom.push("syncBackupHistory");
        }
      }

      if (!nextRightTop.includes("aiAssistant")) {
        const savedConnectionsIndex = nextRightTop.indexOf("savedConnections");
        if (savedConnectionsIndex !== -1) {
          nextRightTop.splice(savedConnectionsIndex + 1, 0, "aiAssistant");
        } else {
          nextRightTop.unshift("aiAssistant");
        }
      }

      if (!nextRightBottom.includes("serialSend")) {
        const quickCmdIndex = nextRightBottom.indexOf("quickCmdBar");
        const recordingIndex = nextRightBottom.indexOf("recording");
        const lockIndex = nextRightBottom.indexOf("lock");
        if (quickCmdIndex !== -1) {
          nextRightBottom.splice(quickCmdIndex + 1, 0, "serialSend");
        } else if (recordingIndex !== -1) {
          nextRightBottom.splice(recordingIndex, 0, "serialSend");
        } else if (lockIndex !== -1) {
          nextRightBottom.splice(lockIndex, 0, "serialSend");
        } else {
          nextRightBottom.push("serialSend");
        }
      }

      if (!nextRightBottom.includes("recording")) {
        const serialSendIndex = nextRightBottom.indexOf("serialSend");
        const lockIndex = nextRightBottom.indexOf("lock");
        if (serialSendIndex !== -1) {
          nextRightBottom.splice(serialSendIndex + 1, 0, "recording");
        } else if (lockIndex !== -1) {
          nextRightBottom.splice(lockIndex, 0, "recording");
        } else {
          nextRightBottom.push("recording");
        }
      }

      return {
        activity_bar_layout: {
          ...prev.activity_bar_layout,
          left_bottom: nextLeftBottom,
          right_top: nextRightTop,
          right_bottom: nextRightBottom,
        },
      };
    });
  }, [layout.left_bottom, layout.left_top, layout.right_bottom, layout.right_top, updateUi]);

  const buildItems = useCallback(
    (ids: string[]): ActivityBarItem[] =>
      ids.filter((id) => id in itemRegistry).map((id) => ({ id, ...itemRegistry[id] })),
    [itemRegistry],
  );

  const leftTopItems = useMemo(() => buildItems(layout.left_top), [buildItems, layout.left_top]);
  const leftBottomItems = useMemo(
    () => buildItems(layout.left_bottom),
    [buildItems, layout.left_bottom],
  );
  const rightTopItems = useMemo(() => buildItems(layout.right_top), [buildItems, layout.right_top]);
  const rightBottomItems = useMemo(
    () => buildItems(layout.right_bottom),
    [buildItems, layout.right_bottom],
  );

  const toggleActiveIds = useMemo(() => {
    const activeIds = new Set<string>();
    if (uiConfig.show_quick_cmd_bar) activeIds.add("quickCmdBar");
    if (uiConfig.show_serial_send_panel) activeIds.add("serialSend");
    if (recordingSessions.size > 0) activeIds.add("recording");
    return activeIds;
  }, [recordingSessions, uiConfig.show_quick_cmd_bar, uiConfig.show_serial_send_panel]);

  useEffect(() => {
    if (!uiConfig.show_quick_cmd_bar || !uiConfig.show_serial_send_panel) return;
    updateUi({ show_quick_cmd_bar: false });
  }, [uiConfig.show_quick_cmd_bar, uiConfig.show_serial_send_panel, updateUi]);

  const handleItemSelect = useCallback(
    (id: string) => {
      if (id === "settings") {
        openSettings();
        return;
      }
      if (id === "lock") {
        setIsLocked(true);
        return;
      }
      if (id === "quickCmdBar") {
        updateUi((prev) => ({
          show_quick_cmd_bar: !prev.show_quick_cmd_bar,
          ...(prev.show_serial_send_panel ? { show_serial_send_panel: false } : {}),
        }));
        return;
      }
      if (id === "serialSend") {
        updateUi((prev) => ({
          show_serial_send_panel: !prev.show_serial_send_panel,
          ...(prev.show_quick_cmd_bar ? { show_quick_cmd_bar: false } : {}),
        }));
        return;
      }
      const side = getItemSide(id, layout);
      if (side === "left") {
        updateUi((prev) => ({ active_left_panel: prev.active_left_panel === id ? null : id }));
      } else if (side === "right") {
        updateUi((prev) => ({ active_right_panel: prev.active_right_panel === id ? null : id }));
      }
    },
    [layout, setIsLocked, updateUi],
  );

  const handleReorder = useCallback(
    (side: "left" | "right", zoneKey: "top" | "bottom", orderedIds: string[]) => {
      const layoutKey = `${side}_${zoneKey}` as keyof ActivityBarLayout;
      updateUi((prev) => ({
        activity_bar_layout: { ...prev.activity_bar_layout, [layoutKey]: orderedIds },
      }));
    },
    [updateUi],
  );

  const handleMoveItem = useCallback(
    (itemId: string, targetZone: ActivityBarZone) => {
      updateUi((prev) => {
        const zones = ["left_top", "left_bottom", "right_top", "right_bottom"] as const;
        const newLayout = { ...prev.activity_bar_layout };
        for (const zone of zones) {
          newLayout[zone] = newLayout[zone].filter((id) => id !== itemId);
        }
        newLayout[targetZone] = [...newLayout[targetZone], itemId];
        const isMovingToRight = targetZone === "right_top" || targetZone === "right_bottom";
        const isMovingToLeft = targetZone === "left_top" || targetZone === "left_bottom";
        return {
          activity_bar_layout: newLayout,
          ...(prev.active_left_panel === itemId && isMovingToRight
            ? { active_left_panel: null }
            : {}),
          ...(prev.active_right_panel === itemId && isMovingToLeft
            ? { active_right_panel: null }
            : {}),
        };
      });
    },
    [updateUi],
  );

  const handleToggleLabel = useCallback(() => {
    updateUi((prev) => ({
      activity_bar_layout: {
        ...prev.activity_bar_layout,
        show_labels: !prev.activity_bar_layout.show_labels,
      },
    }));
  }, [updateUi]);

  return {
    leftTopItems,
    leftBottomItems,
    rightTopItems,
    rightBottomItems,
    showLabels: layout.show_labels,
    toggleActiveIds,
    handleItemSelect,
    handleReorder,
    handleMoveItem,
    handleToggleLabel,
  };
}
