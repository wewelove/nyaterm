interface ExternalFileDropOverlayProps {
  title: string;
  hint: string;
  insetClassName?: string;
}

export default function ExternalFileDropOverlay({
  title,
  hint,
  insetClassName = "inset-2",
}: ExternalFileDropOverlayProps) {
  return (
    <div
      className={`pointer-events-none absolute ${insetClassName} z-10 flex items-center justify-center rounded-lg border-2 border-dashed`}
      style={{
        borderColor: "var(--df-primary)",
        backgroundColor: "rgba(59, 130, 246, 0.14)",
      }}
    >
      <div
        className="max-w-sm rounded-lg border px-6 py-4 text-center shadow-xl"
        style={{
          borderColor: "var(--df-primary)",
          backgroundColor: "var(--df-bg-panel)",
          color: "var(--df-text)",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.28)",
        }}
      >
        <div className="flex flex-col items-center gap-1.5">
          <div className="text-base font-semibold leading-snug">{title}</div>
          <div
            className="text-xs font-normal leading-relaxed"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {hint}
          </div>
        </div>
      </div>
    </div>
  );
}
