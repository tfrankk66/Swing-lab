import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { PHASE, VERSION, versionLabel } from "./version";

/**
 * The topbar said v0.1 while the app was at v0.2. Nothing caught it, because
 * nothing was checking — the string was just sitting in the JSX. This is the
 * check.
 */
describe("version", () => {
  it("matches the version in package.json", () => {
    expect(pkg.version).toBe(VERSION);
  });

  it("renders major.minor and the phase, without the patch", () => {
    // Derived from the constants rather than written out. The hardcoded
    // "v0.2 · pose" this replaced failed on the bump to 0.3 — a test that
    // breaks every time the thing it guards changes correctly is one people
    // learn to edit without reading, which is how the drift started.
    const [major, minor, patch] = VERSION.split(".");
    expect(versionLabel()).toBe(`v${major}.${minor} · ${PHASE}`);
    expect(versionLabel()).not.toContain(`.${patch}`);
  });

  it("is a three-part semver", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names a phase", () => {
    expect(PHASE.length).toBeGreaterThan(0);
  });
});
