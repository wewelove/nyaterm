import { MdCheckCircle, MdClose, MdError, MdInfo, MdWarning } from "react-icons/md";
import type { ToastType } from "./ToastContext";
import { useToast } from "./ToastContext";

const colorMap: Record<ToastType, { bg: string; border: string }> = {
  error: { bg: "rgba(220,38,38,0.9)", border: "rgba(220,38,38,0.6)" },
  warn: { bg: "rgba(217,119,6,0.9)", border: "rgba(217,119,6,0.6)" },
  info: { bg: "rgba(37,99,235,0.9)", border: "rgba(37,99,235,0.6)" },
  success: { bg: "rgba(5,150,105,0.9)", border: "rgba(5,150,105,0.6)" },
};

const iconMap: Record<ToastType, React.ElementType> = {
  error: MdError,
  warn: MdWarning,
  info: MdInfo,
  success: MdCheckCircle,
};

/** Renders toasts from ToastContext as fixed overlay. Type-based colors and icons. */
export default function ToastContainer() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-[380px]">
      {toasts.map((toast) => {
        const colors = colorMap[toast.type];
        return (
          <div
            key={toast.id}
            className="animate-slide-in-right rounded-lg shadow-xl px-4 py-3 flex items-start gap-3 border backdrop-blur-sm"
            style={{
              backgroundColor: colors.bg,
              borderColor: colors.border,
            }}
          >
            {(() => {
              const Icon = iconMap[toast.type];
              return <Icon className="text-base text-white/90 mt-0.5" />;
            })()}
            <span className="text-xs text-white flex-1 leading-relaxed">{toast.message}</span>
            <MdClose
              className="text-sm text-white/60 cursor-pointer hover:text-white mt-0.5 transition-colors"
              onClick={() => dismiss(toast.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
