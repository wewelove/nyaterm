import type { IDisposable, Terminal } from "@xterm/xterm";
import type { SessionType } from "@/types/global";

export const REMOTE_COLOR_OSC_IDS = [4, 10, 11, 12, 104, 110, 111, 112] as const;

const NOOP_DISPOSABLE: IDisposable = {
  dispose: () => undefined,
};

export function installRemoteColorOscGuard(
  terminal: Terminal,
  sessionType: SessionType,
  onBlocked?: (oscId: number, data: string) => void,
): IDisposable {
  if (sessionType !== "Serial") {
    return NOOP_DISPOSABLE;
  }

  const disposables = REMOTE_COLOR_OSC_IDS.map((oscId) =>
    terminal.parser.registerOscHandler(oscId, (data) => {
      onBlocked?.(oscId, data);
      return true;
    }),
  );

  return {
    dispose() {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}
