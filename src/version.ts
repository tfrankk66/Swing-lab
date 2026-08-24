/**
 * The one place the version lives.
 *
 * It was hardcoded in the topbar and drifted two phases behind the app, which
 * is the sort of thing nobody notices until it is the first thing a new user
 * reads. `version.test.ts` fails if this and package.json disagree.
 */
export const VERSION = "0.4.0";

/** What this phase actually delivers, for the chip beside the number. */
export const PHASE = "metrics";

/** `v0.4 · metrics` — the patch number is noise in a chip this size. */
export function versionLabel(): string {
  const [major = "0", minor = "0"] = VERSION.split(".");
  return `v${major}.${minor} · ${PHASE}`;
}
