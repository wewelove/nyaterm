import { useRef } from "react";

export interface ShellIntegrationState {
  enabled: boolean;
}

export function useShellIntegration() {
  const shellIntegrationRef = useRef<ShellIntegrationState>({
    enabled: false,
  });

  return { shellIntegrationRef };
}
