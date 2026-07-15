const ua = navigator.userAgent.toLowerCase();
const platform = navigator.platform.toLowerCase();

export const isMacOS = ua.includes("macintosh") || ua.includes("mac os");
export const isWindows = ua.includes("windows");
export const isLinux = ua.includes("linux") || platform.includes("linux");
