/**
 * Checking whether a newer DevHelper exists.
 *
 * The updater plugin is compiled in, but an updater needs somewhere to look:
 * a release feed URL and the public half of the key its releases are signed
 * with. Both are decisions about how this app is distributed, not something a
 * build can invent, so until `plugins.updater` is set in `tauri.conf.json` the
 * check reports that it is unconfigured rather than failing obscurely or
 * pretending everything is up to date.
 *
 * See docs/UPDATES.md for the three steps that turn it on.
 */

import { isTauri } from "./platform";

export type UpdateState =
  | { kind: "unsupported"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "current"; version: string }
  | { kind: "available"; version: string; notes?: string; date?: string }
  | { kind: "error"; message: string };

/**
 * Does this message mean "no feed configured" rather than "the check failed"?
 *
 * The plugin surfaces a missing or empty endpoint list as an ordinary error,
 * and the difference matters: one is a setup step the user has not done, the
 * other is something that went wrong and is worth reporting.
 */
export function isUnconfigured(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("updater") && (m.includes("not configured") || m.includes("no endpoint") || m.includes("disabled"))
  ) || m.includes("endpoints") && m.includes("empty");
}

const UNCONFIGURED_MESSAGE =
  "No release feed is configured, so DevHelper cannot tell whether a newer version exists. See docs/UPDATES.md.";

/**
 * Ask the release feed whether there is something newer.
 *
 * Dynamically imported so the browser dev build, which has no Tauri bridge at
 * all, does not pull the plugin into its bundle.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateState> {
  if (!isTauri()) {
    return { kind: "unsupported", message: "Update checking only works in the desktop app." };
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "current", version: currentVersion };
    return { kind: "available", version: update.version, notes: update.body, date: update.date };
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : String(e);
    if (isUnconfigured(message)) return { kind: "unconfigured", message: UNCONFIGURED_MESSAGE };
    return { kind: "error", message };
  }
}

/** Download and install the pending update, then relaunch. */
export async function installUpdate(onProgress?: (downloaded: number, total?: number) => void): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) throw new Error("The update is no longer available.");
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded);
    } else if (event.event === "Started") {
      onProgress?.(0, event.data.contentLength);
    }
  });
}
