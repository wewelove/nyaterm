import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdLock, MdLockOpen } from "react-icons/md";
import { invoke } from "@/lib/invoke";
import NyaTermLogo from "../../NyaTermLogo";

interface LockScreenProps {
  hasPassword: boolean;
  onUnlock: () => void;
}

/**
 * Full-screen overlay shown when the app has been locked due to inactivity.
 * If a lock password is set, the user must enter it to unlock (verified by backend).
 * Otherwise, clicking the unlock button is sufficient.
 */
export default function LockScreen({ hasPassword, onUnlock }: LockScreenProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hasPassword && inputRef.current) {
      inputRef.current.focus();
    }
  }, [hasPassword]);

  const handleUnlock = async () => {
    if (!hasPassword) {
      onUnlock();
      return;
    }
    setVerifying(true);
    try {
      const ok = await invoke<boolean>("verify_master_password", { password: input });
      if (ok) {
        setInput("");
        setError(false);
        onUnlock();
      } else {
        setError(true);
        setInput("");
        inputRef.current?.focus();
      }
    } catch {
      setError(true);
      setInput("");
      inputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleUnlock();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="flex flex-col items-center gap-5 select-none animate-in fade-in duration-300">
        {/* Logo with lock badge */}
        <div className="relative">
          <NyaTermLogo style={{ width: 80, height: 80 }} className="rounded-2xl" />
          {/* Small lock badge */}
          <div
            className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center border-2 border-black/80"
            style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
          >
            <MdLock className="text-white/80" style={{ fontSize: 14 }} />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-white/90 mt-1">{t("lockScreen.title")}</h2>

        {/* Message */}
        <p className="text-sm text-white/50 text-center max-w-xs">{t("lockScreen.message")}</p>

        {/* Password input */}
        {hasPassword && (
          <div className="flex flex-col items-center gap-2 w-64">
            <input
              ref={inputRef}
              type="password"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder={t("lockScreen.passwordPlaceholder")}
              className="w-full px-4 py-2.5 rounded-lg text-sm text-white bg-white/10 border border-white/20 placeholder-white/30 outline-none focus:border-white/40 transition-colors"
              autoComplete="off"
              disabled={verifying}
            />
            {error && <p className="text-xs text-red-400">{t("lockScreen.wrongPassword")}</p>}
          </div>
        )}

        {/* Unlock button */}
        <button
          type="button"
          onClick={handleUnlock}
          disabled={verifying}
          className="mt-1 px-8 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          }}
        >
          <span className="flex items-center gap-2">
            <MdLockOpen className="text-[1.125rem]" />
            {t("lockScreen.unlock")}
          </span>
        </button>
      </div>
    </div>
  );
}
