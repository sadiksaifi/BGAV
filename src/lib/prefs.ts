export interface Prefs {
  /** Which graph the run page shows. */
  mode: "bgav" | "native";
  /** Hide edges implied by longer dependency chains. */
  simplifyEdges: boolean;
  showMinimap: boolean;
  /** Height of the inline panel in pixels, or null to size it to the graph. */
  height: number | null;
}

export const DEFAULT_PREFS: Prefs = {
  mode: "bgav",
  simplifyEdges: true,
  showMinimap: true,
  height: null,
};

const KEY = "bgav:prefs";

const storage = (): chrome.storage.StorageArea | undefined => {
  try {
    return globalThis.chrome?.storage?.local;
  } catch {
    return undefined;
  }
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const stored = (await storage()?.get(KEY))?.[KEY] as Partial<Prefs> | undefined;
    return { ...DEFAULT_PREFS, ...stored };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  try {
    await storage()?.set({ [KEY]: prefs });
  } catch (error) {
    // The extension context is gone after an update or reload; the next page load reads fresh prefs.
    console.debug("[BGAV] Could not save preferences", error);
  }
}
