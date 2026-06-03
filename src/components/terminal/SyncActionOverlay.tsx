import { useTranslation } from "react-i18next";
import { MdCellTower, MdClose, MdLogout, MdPause, MdPlayArrow } from "react-icons/md";
import type { SyncOverlayState } from "./xterminalTypes";

export default function SyncActionOverlay({ overlay }: { overlay: SyncOverlayState }) {
  const { t } = useTranslation();
  const color = overlay.groupColor ?? "var(--df-primary)";

  return (
    <div
      className="absolute right-2 top-1 z-20 flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] shadow-sm"
      style={{
        backgroundColor: "color-mix(in srgb, var(--df-bg-panel) 92%, transparent)",
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <MdCellTower className="text-xs mr-0.5" style={{ color }} />
      <span className="font-medium mr-1" style={{ color }}>
        {overlay.isPaused ? t("syncGroup.paused") : t("syncGroup.broadcastActive")}
      </span>
      <button
        type="button"
        className="flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-white/10"
        style={{ color }}
        onClick={overlay.onPauseResume}
        title={overlay.isPaused ? t("syncGroup.resumeSync") : t("syncGroup.pauseSync")}
      >
        {overlay.isPaused ? <MdPlayArrow className="text-xs" /> : <MdPause className="text-xs" />}
        <span>{overlay.isPaused ? t("syncGroup.resumeSync") : t("syncGroup.pauseSync")}</span>
      </button>
      <button
        type="button"
        className="flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-white/10"
        style={{ color }}
        onClick={overlay.onLeaveGroup}
        title={t("syncGroup.leaveGroup")}
      >
        <MdLogout className="text-xs" />
        <span>{t("syncGroup.leaveGroup")}</span>
      </button>
      <button
        type="button"
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-red-400 transition-colors hover:bg-red-500/10"
        onClick={overlay.onCloseGroup}
        title={t("syncGroup.closeGroup")}
      >
        <MdClose className="text-xs" />
        <span>{t("syncGroup.closeGroup")}</span>
      </button>
    </div>
  );
}
