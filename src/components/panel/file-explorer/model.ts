import type { FileEntry } from "@/types/global";

export interface ResolvedLocalDropPathEntry {
  path: string;
  isDir: boolean;
}

export interface RemoteTextFile {
  path: string;
  content: string;
  size: number;
}

export type FileExplorerSessionCache = {
  files: FileEntry[];
  currentPath: string;
  homeDir: string;
  history: string[];
  historyIndex: number;
  visitedHistory: string[];
};

export type LoadDirectoryOptions = {
  history?: "push" | "preserve";
  selectEntryName?: string;
};

export type InlineRenameState = {
  entryName: string;
  oldPath: string;
  initialName: string;
  value: string;
  isSubmitting: boolean;
};

export const fileExplorerSessionCacheStore = new Map<string, FileExplorerSessionCache>();
export const MAX_VISITED_HISTORY = 30;
export const FILE_LIST_ITEM_HEIGHT = 30;
export const FILE_LIST_HEADER_HEIGHT = 28;
export const FILE_LIST_OVERSCAN = 8;
export const PARENT_DIRECTORY_ENTRY_NAME = "..";

export type FileSortColumn = "name" | "mtime" | "size" | "permissions" | "owner" | "group";
export type FileSortDirection = "asc" | "desc";
export type FileSortMode = {
  column: FileSortColumn;
  direction: FileSortDirection;
};
export type FileListColumn = {
  id: FileSortColumn;
  labelKey: string;
  align?: "left" | "right";
};
export type FileListColumnWidths = Record<FileSortColumn, number>;

export const FILE_LIST_COLUMNS: FileListColumn[] = [
  { id: "name", labelKey: "fileExplorer.name" },
  { id: "mtime", labelKey: "fileExplorer.mtime" },
  { id: "size", labelKey: "fileExplorer.size", align: "right" },
  { id: "permissions", labelKey: "fileExplorer.permissions" },
  { id: "owner", labelKey: "fileExplorer.owner" },
  { id: "group", labelKey: "fileExplorer.group" },
];

export const DEFAULT_FILE_LIST_COLUMN_WIDTHS: FileListColumnWidths = {
  name: 220,
  mtime: 128,
  size: 80,
  permissions: 112,
  owner: 96,
  group: 96,
};

export const MIN_FILE_LIST_COLUMN_WIDTHS: FileListColumnWidths = {
  name: 140,
  mtime: 112,
  size: 72,
  permissions: 92,
  owner: 76,
  group: 76,
};

export const DEFAULT_FILE_SORT_DIRECTIONS: Record<FileSortColumn, FileSortDirection> = {
  name: "asc",
  mtime: "desc",
  size: "desc",
  permissions: "asc",
  owner: "asc",
  group: "asc",
};

export const PARENT_DIRECTORY_ENTRY: FileEntry = {
  name: PARENT_DIRECTORY_ENTRY_NAME,
  is_dir: true,
  is_symlink: false,
  size: 0,
  permissions: "",
  owner: "",
  group: "",
  mtime: 0,
};

export function getLocalPathName(path: string, fallback: string) {
  return path.split(/[\\/]/).pop() || fallback;
}

export function buildRemoteUploadPath(remoteDir: string, name: string) {
  return remoteDir === "/" ? `/${name}` : `${remoteDir}/${name}`;
}

export function normalizeDirectoryPath(path: string) {
  if (!path || path === "/") return path;
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
}

export function getRemoteParentDirectory(path: string) {
  const normalized = normalizeDirectoryPath(path);
  if (!normalized || normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

export function isParentDirectoryEntry(entry: FileEntry) {
  return entry.name === PARENT_DIRECTORY_ENTRY_NAME;
}

/**
 * Records a freshly visited directory into the in-memory visited list.
 * Deduplicates by path (moving an existing entry to the top), keeps the most
 * recent first, and caps the list to avoid unbounded growth per session.
 */
export function pushVisitedHistory(list: string[], path: string): string[] {
  const normalizedPath = normalizeDirectoryPath(path);
  if (!normalizedPath) return list;
  const withoutDuplicate = list.filter((entry) => entry !== normalizedPath);
  withoutDuplicate.unshift(normalizedPath);
  if (withoutDuplicate.length > MAX_VISITED_HISTORY) {
    withoutDuplicate.length = MAX_VISITED_HISTORY;
  }
  return withoutDuplicate;
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function compareFileEntries(left: FileEntry, right: FileEntry, sortMode: FileSortMode) {
  if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;

  let result = 0;
  switch (sortMode.column) {
    case "mtime":
      result = left.mtime - right.mtime;
      break;
    case "size":
      result = left.size - right.size;
      break;
    case "permissions":
      result = naturalCompare(left.permissions || "", right.permissions || "");
      break;
    case "owner":
      result = naturalCompare(left.owner || "", right.owner || "");
      break;
    case "group":
      result = naturalCompare(left.group || "", right.group || "");
      break;
    case "name":
      result = naturalCompare(left.name, right.name);
      break;
  }

  if (result !== 0) {
    return sortMode.direction === "asc" ? result : -result;
  }

  return naturalCompare(left.name, right.name);
}

export function matchesFileSearch(entry: FileEntry, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return entry.name.toLocaleLowerCase().includes(normalizedQuery);
}

export function buildSessionCacheSnapshot(
  files: FileEntry[],
  currentPath: string,
  homeDir: string,
  history: string[],
  historyIndex: number,
  visitedHistory: string[],
): FileExplorerSessionCache | null {
  const normalizedCurrentPath = normalizeDirectoryPath(currentPath);
  const normalizedHomeDir = normalizeDirectoryPath(homeDir);
  const normalizedHistory = history
    .map((entry) => normalizeDirectoryPath(entry))
    .filter((entry): entry is string => !!entry);

  if (!normalizedCurrentPath) {
    return null;
  }

  const nextHistory = normalizedHistory.length > 0 ? normalizedHistory : [normalizedCurrentPath];
  const nextHistoryIndex = Math.min(Math.max(historyIndex, 0), nextHistory.length - 1);

  const normalizedVisited = visitedHistory
    .map((entry) => normalizeDirectoryPath(entry))
    .filter((entry): entry is string => !!entry)
    .slice(0, MAX_VISITED_HISTORY);

  return {
    files,
    currentPath: normalizedCurrentPath,
    homeDir: normalizedHomeDir || normalizedCurrentPath,
    history: nextHistory,
    historyIndex: nextHistoryIndex,
    visitedHistory: normalizedVisited,
  };
}
