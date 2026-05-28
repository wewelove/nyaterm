import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ActionFooter({
  className,
  leading,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  leading?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-t bg-background/95 px-5 py-3 backdrop-blur",
        leading ? "justify-between" : "justify-end",
        className,
      )}
      {...props}
    >
      {leading ? <div className="min-w-0 flex-1">{leading}</div> : null}
      <div className="flex shrink-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function ActionButton({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button size={size} className={cn("min-w-16 px-4", className)} {...props} />;
}

export { ActionButton, ActionFooter };
