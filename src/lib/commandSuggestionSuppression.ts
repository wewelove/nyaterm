import { sanitizeTerminalCommand } from "@/lib/terminalCommand";

const INTERACTIVE_COMMANDS = new Set([
  "btop",
  "htop",
  "less",
  "man",
  "more",
  "nano",
  "nvim",
  "top",
  "vi",
  "vim",
  "watch",
]);

const SUDO_OPTION_REQUIRES_VALUE = new Set(["-C", "-g", "-h", "-p", "-T", "-u"]);

function splitCommandSegments(input: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      current += char;
      continue;
    }

    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }

    if (!quote && (char === "|" || char === ";" || char === "&")) {
      if (current.trim()) {
        segments.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments;
}

function tokenizeShellLike(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (!quote && /\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function commandName(token: string): string {
  const normalized = token.replace(/\\/gu, "/");
  return (normalized.split("/").pop() ?? normalized).toLowerCase();
}

function skipEnvPrefix(tokens: string[], index: number): number {
  let next = index;
  while (next < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[next] ?? "")) {
    next += 1;
  }
  return next;
}

function skipSudoLike(tokens: string[], index: number): number {
  let next = index + 1;
  while (next < tokens.length) {
    const token = tokens[next] ?? "";
    if (token === "--") {
      return next + 1;
    }
    if (!token.startsWith("-") || token === "-") {
      return next;
    }
    if (SUDO_OPTION_REQUIRES_VALUE.has(token)) {
      next += 2;
    } else {
      next += 1;
    }
  }
  return next;
}

function unwrapCommand(tokens: string[]): string[] {
  let index = skipEnvPrefix(tokens, 0);

  while (index < tokens.length) {
    const name = commandName(tokens[index] ?? "");

    if (name === "sudo" || name === "doas") {
      index = skipSudoLike(tokens, index);
      index = skipEnvPrefix(tokens, index);
      continue;
    }

    if (name === "env") {
      index = skipEnvPrefix(tokens, index + 1);
      continue;
    }

    if (name === "command" || name === "builtin" || name === "exec" || name === "time") {
      index += 1;
      continue;
    }

    if (name === "nice" || name === "nohup") {
      index += 1;
      while (index < tokens.length && (tokens[index] ?? "").startsWith("-")) {
        index += 1;
      }
      continue;
    }

    break;
  }

  return tokens.slice(index);
}

function hasOption(tokens: string[], longName: string, shortName?: string): boolean {
  return tokens.some((token) => token === longName || (!!shortName && token.includes(shortName)));
}

function commandSegmentStartsInteractiveProgram(segment: string): boolean {
  const tokens = unwrapCommand(tokenizeShellLike(segment));
  const name = commandName(tokens[0] ?? "");
  if (!name) {
    return false;
  }

  if (INTERACTIVE_COMMANDS.has(name)) {
    return true;
  }

  if (name === "journalctl") {
    return !hasOption(tokens, "--no-pager");
  }

  if (name === "tail") {
    return hasOption(tokens, "--follow", "f");
  }

  return false;
}

export function commandStartsSuggestionSuppressingProgram(command: string): boolean {
  const normalized = sanitizeTerminalCommand(command);
  if (!normalized) {
    return false;
  }

  return splitCommandSegments(normalized).some(commandSegmentStartsInteractiveProgram);
}

export function isPagerSearchOrCommandInput(value: string): boolean {
  return /^[/?:]/u.test(value.trimStart());
}

export function isPagerSingleKeyInput(data: string): boolean {
  return [" ", "b", "g", "G", "n", "N", "q"].includes(data);
}
