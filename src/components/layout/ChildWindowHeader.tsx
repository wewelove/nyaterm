import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
} from "react-icons/vsc";
import { isMacOS } from "@/lib/platform";

interface ChildWindowHeaderProps {
  title: string;
  onClose: () => void;
  icon?: ReactNode;
  windowControls?: boolean;
}

export default function ChildWindowHeader({
  title,
  onClose,
  icon,
  windowControls = false,
}: ChildWindowHeaderProps) {
  const { t } = useTranslation();
  const [appWindow] = useState(() => getCurrentWindow());
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (isMacOS || !windowControls) return;
    let mounted = true;
    let unlistenResized: (() => void) | undefined;

    const syncMaximizedState = async () => {
      const maximized = await appWindow.isMaximized().catch(() => false);
      if (mounted) {
        setIsMaximized(maximized);
      }
    };

    void syncMaximizedState();
    appWindow
      .onResized(() => {
        void syncMaximizedState();
      })
      .then((unlisten) => {
        unlistenResized = unlisten;
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlistenResized?.();
    };
  }, [appWindow, windowControls]);

  const handleMinimize = () => {
    appWindow.minimize().catch(() => {});
  };

  const handleToggleMaximize = async () => {
    await appWindow.toggleMaximize().catch(() => {});
    const maximized = await appWindow.isMaximized().catch(() => false);
    setIsMaximized(maximized);
  };

  return (
    <header
      className="h-10 border-b flex items-center shrink-0 select-none"
      style={{ backgroundColor: "var(--df-bg-panel)", borderColor: "var(--df-border)" }}
    >
      <div
        className={`flex-1 min-w-0 h-full flex items-center gap-2 px-3${isMacOS ? " pl-[70px]" : ""}`}
        data-tauri-drag-region
      >
        {icon ? <span className="text-primary pointer-events-none shrink-0">{icon}</span> : null}
        <span className="text-sm font-medium truncate pointer-events-none">{title}</span>
      </div>

      {!isMacOS && (
        <div className="flex h-full shrink-0 items-center">
          {windowControls && (
            <>
              <button
                type="button"
                className="flex h-10 w-[46px] items-center justify-center text-[var(--df-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--df-text)_10%,transparent)] hover:text-[var(--df-text)]"
                aria-label={t("menu.minimize")}
                title={t("menu.minimize")}
                onClick={handleMinimize}
              >
                <VscChromeMinimize className="text-base" />
              </button>
              <button
                type="button"
                className="flex h-10 w-[46px] items-center justify-center text-[var(--df-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--df-text)_10%,transparent)] hover:text-[var(--df-text)]"
                aria-label={isMaximized ? t("menu.restore") : t("menu.maximize")}
                title={isMaximized ? t("menu.restore") : t("menu.maximize")}
                onClick={() => void handleToggleMaximize()}
              >
                {isMaximized ? (
                  <VscChromeRestore className="text-base" />
                ) : (
                  <VscChromeMaximize className="text-base" />
                )}
              </button>
            </>
          )}
          <button
            type="button"
            className="flex h-10 w-[46px] items-center justify-center text-[var(--df-text-muted)] transition-colors hover:bg-[#e81123] hover:text-white"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            <VscChromeClose className="text-base" />
          </button>
        </div>
      )}
    </header>
  );
}
