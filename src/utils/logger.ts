import { config } from "../../package.json";

type LogLevel = "debug" | "info" | "warn" | "error";

function format(scope: string, message: string) {
  return `[${config.addonName}:${scope}] ${message}`;
}

function write(
  level: LogLevel,
  scope: string,
  message: string,
  error?: unknown,
) {
  const text = format(scope, message);

  if (level === "error") {
    if (error instanceof Error) {
      Zotero.logError(error);
    } else {
      Zotero.logError(new Error(text));
    }
    return;
  }

  Zotero.debug(text);
}

export const logger = {
  debug(scope: string, message: string) {
    write("debug", scope, message);
  },
  info(scope: string, message: string) {
    write("info", scope, message);
  },
  warn(scope: string, message: string) {
    write("warn", scope, message);
  },
  error(scope: string, message: string, error?: unknown) {
    write(
      "error",
      scope,
      `${message}${error ? `: ${String(error)}` : ""}`,
      error,
    );
  },
};
