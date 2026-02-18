import { useEffect, useRef, useState } from "react";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { appLogDir } from "@tauri-apps/api/path";
import packageJson from "../../../package.json";
import { useApp } from "../../context/AppContext";
import { useTheme } from "../../context/ThemeContext";

interface HeaderProps {
  onNewSession: () => void;
}

interface MenuItem {
  label: string;
  action?: () => void;
  separator?: boolean;
  submenu?: MenuItem[];
  checked?: boolean;
  icon?: string;
}

/** Top bar with File/Edit/View/Terminal/Help menus, theme picker, and mobile toggles. */
export default function Header({
  onNewSession,
  onToggleLeft,
  onToggleRight,
  onAbout,
}: HeaderProps & { onToggleLeft?: () => void; onToggleRight?: () => void; onAbout: () => void }) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { themeName, setTheme, themeNames } = useTheme();
  const { uiConfig, updateUiConfig } = useApp();

  const handleZoom = (delta: number) => {
    const newZoom = Math.max(0.5, Math.min(2.0, uiConfig.zoom_level + delta));
    updateUiConfig({ zoom_level: parseFloat(newZoom.toFixed(1)) });
  };

  const handleResetZoom = () => updateUiConfig({ zoom_level: 1.0 });

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: "New SSH Connection", action: onNewSession, icon: "add" },
      { label: "separator", separator: true },
      { label: "Exit", action: () => window.close(), icon: "exit_to_app" }, // Assuming window.close() works or using tauri/api
    ],
    Edit: [
      { label: "Copy", icon: "content_copy" },
      { label: "Paste", icon: "content_paste" },
      { label: "Select All", icon: "select_all" },
    ],
    View: [
      // Layout Submenu
      {
        label: "Layout",
        icon: "dashboard",
        submenu: [
          {
            label: "File Explorer",
            checked: uiConfig.show_file_explorer,
            action: () => updateUiConfig({ show_file_explorer: !uiConfig.show_file_explorer }),
          },
          {
            label: "Saved Connections",
            checked: uiConfig.show_saved_connections,
            action: () => updateUiConfig({ show_saved_connections: !uiConfig.show_saved_connections }),
          },
          {
            label: "Active Sessions",
            checked: uiConfig.show_active_sessions,
            action: () => updateUiConfig({ show_active_sessions: !uiConfig.show_active_sessions }),
          },
          {
            label: "Command History",
            checked: uiConfig.show_command_history,
            action: () => updateUiConfig({ show_command_history: !uiConfig.show_command_history }),
          },
          {
            label: "Quick Commands",
            checked: uiConfig.show_quick_commands,
            action: () => updateUiConfig({ show_quick_commands: !uiConfig.show_quick_commands }),
          },
        ],
      },
      // Theme Submenu
      {
        label: "Theme",
        icon: "palette",
        submenu: themeNames.map((t) => ({
          label: t.name,
          checked: themeName === t.id,
          action: () => setTheme(t.id),
        })),
      },
      { label: "separator", separator: true },
      { label: "Zoom In", action: () => handleZoom(0.1), icon: "zoom_in" },
      { label: "Zoom Out", action: () => handleZoom(-0.1), icon: "zoom_out" },
      { label: "Reset Zoom", action: handleResetZoom, icon: "restart_alt" },
      { label: "separator", separator: true },
      { label: "Fullscreen", action: toggleFullscreen, icon: "fullscreen" },
    ],
    Terminal: [
      { label: "New SSH Connection", action: onNewSession, icon: "add" },
      { label: "New Local Terminal", action: onNewSession, icon: "computer" },
    ],
    Help: [
      {
        label: "Documentation",
        icon: "menu_book",
        action: () => openUrl(packageJson.homepage + "/docs"),
      },
      {
        label: "Check for Updates",
        icon: "update",
        action: () => openUrl(packageJson.homepage + "/releases"),
      },
      {
        label: "View Logs",
        icon: "article",
        action: async () => {
          try {
            const logDir = await appLogDir();
            await openPath(logDir);
          } catch (error) {
            console.error("Failed to open logs:", error);
          }
        },
      },
      { label: "separator", separator: true },
      { label: "About", action: onAbout, icon: "info" },
    ],
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    if (activeMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeMenu]);

  return (
    <header
      className="h-10 border-b flex items-center justify-between px-3 select-none shrink-0"
      style={{ backgroundColor: "var(--df-bg-panel)", borderColor: "var(--df-border)" }}
    >
      <div className="flex items-center gap-4" ref={menuRef}>
        {/* Mobile Left Toggle */}
        <button
          className="lg:hidden flex items-center"
          style={{ color: "var(--df-text-muted)" }}
          onClick={onToggleLeft}
        >
          <span className="material-icons text-base">menu</span>
        </button>

        <nav className="flex items-center gap-0 text-xs font-medium relative">
          {Object.keys(menus).map((item) => (
            <div key={item} className="relative">
              <span
                className="cursor-pointer px-2 py-1 rounded transition-colors"
                style={{
                  color: activeMenu === item ? "var(--df-primary)" : "var(--df-text-muted)",
                  backgroundColor:
                    activeMenu === item
                      ? "color-mix(in srgb, var(--df-primary) 10%, transparent)"
                      : undefined,
                }}
                onClick={() => setActiveMenu(activeMenu === item ? null : item)}
              >
                {item}
              </span>
              {activeMenu === item && (
                <div
                  className="absolute top-full left-0 mt-1 rounded shadow-xl py-1 min-w-[180px] z-50 border"
                  style={{ backgroundColor: "var(--df-bg-panel)", borderColor: "var(--df-border)" }}
                >
                  <MenuContent items={menus[item]} onClose={() => setActiveMenu(null)} />
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3" style={{ color: "var(--df-text-muted)" }}>
        {/* Mobile Right Toggle */}
        <button
          className="md:hidden flex items-center"
          style={{ color: "var(--df-text-muted)" }}
          onClick={onToggleRight}
        >
          <span className="material-icons text-base">view_sidebar</span>
        </button>

        <span className="material-icons text-base cursor-pointer hover:opacity-80 transition-opacity hidden sm:block">
          search
        </span>
        <span className="material-icons text-base cursor-pointer hover:opacity-80 transition-opacity hidden sm:block">
          settings
        </span>
      </div>
    </header>
  );
}

function MenuContent({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((menuItem, idx) =>
        menuItem.separator ? (
          <div
            key={`sep-${idx}`}
            className="my-1 border-t"
            style={{ borderColor: "var(--df-border)" }}
          />
        ) : (
          <MenuItemRow key={menuItem.label} item={menuItem} onClose={onClose} />
        ),
      )}
    </>
  );
}

function MenuItemRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [showSubmenu, setShowSubmenu] = useState(false);

  return (
    <div
      className="px-3 py-1.5 text-xs cursor-pointer transition-colors relative flex items-center justify-between group"
      style={{ color: "var(--df-text)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor =
          "color-mix(in srgb, var(--df-primary) 20%, transparent)";
        if (item.submenu) setShowSubmenu(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
        if (item.submenu) setShowSubmenu(false);
      }}
      onClick={() => {
        if (!item.submenu) {
          item.action?.();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span className="w-4 flex items-center justify-center">
          {item.checked ? (
            <span className="material-icons text-[10px]" style={{ color: "var(--df-primary)" }}>
              check
            </span>
          ) : item.icon ? (
            <span className="material-icons text-[16px] text-[var(--df-text-muted)]">
              {item.icon}
            </span>
          ) : null}
        </span>
        <span>{item.label}</span>
      </div>
      {item.submenu && <span className="material-icons text-[10px]">chevron_right</span>}

      {/* Submenu */}
      {item.submenu && showSubmenu && (
        <div
          className="absolute top-0 left-full ml-1 rounded shadow-xl py-1 min-w-[160px] z-50 border"
          style={{ backgroundColor: "var(--df-bg-panel)", borderColor: "var(--df-border)" }}
        >
          <MenuContent items={item.submenu} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
