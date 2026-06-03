import type { SessionType } from "@/types/global";

export interface SyncOverlayState {
  peerCount: number;
  isPaused: boolean;
  groupColor?: string;
  groupName?: string;
  onPauseResume: () => void;
  onLeaveGroup: () => void;
  onCloseGroup: () => void;
}

export interface XTerminalProps {
  sessionId: string;
  active: boolean;
  visible?: boolean;
  sessionType: SessionType;
  connectionId?: string;
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
  syncPeerSessionIds?: string[];
  syncOverlay?: SyncOverlayState;
}

export type PerformanceMode = "normal" | "overloaded";
export type PerformanceOverlayState = "overloaded" | "recovered" | null;
