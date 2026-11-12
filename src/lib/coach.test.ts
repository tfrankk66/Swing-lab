import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoachError,
  MAX_COACH_PRIORITIES,
  askCoach,
  canCoach,
  parseCoaching,
  responseSchema,
  systemPrompt,
  userPrompt,
} from "./coach";
import { DRILLS } from "./drills";
import { withReadings } from "./metrics.fixture";
import { computeMetrics } from "./metrics";

const IDS = computeMetrics(null, null).map((m) => m.id);

describe("the prompt", () => {
  it("keeps the system prompt identical between swings, so it caches", () => {
    // Anything per-swing in here would break the cached prefix on every call.
    expect(systemPrompt()).toBe(systemPrompt());
    expect(systemPrompt()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("lists every drill in the library", () => {
    for (const drill of DRILLS) expect(systemPrompt()).toContain(drill.id);
  });

  it("sends readings, bands and limitations, and marks the unread ones", () => {
    const text = userPrompt(withReadings({ "spine-tilt": 50 }));
    expect(text).toContain("spine-tilt");
    expect(text).toMatch(/50°.*crit.*bent over too far/);
    expect(text).toContain("good 28–42°");
    expect(text).toContain("limitation:");
    expect(text).toMatch(/tempo .*: unread/);
  });

  it("sends nothing but text", () => {
    // The line coaching must not cross: no frames, no landmark arrays.
    const text = userPrompt(withReadings({ "spine-tilt": 50 }));
    expect(text).not.toMatch(/data:image|base64|Float32Array/);
  });
});

describe("the schema", () => {
  it("restricts drills to the library and metrics to the nine", () => {
    const schema = responseSchema(IDS);
    const item = schema.properties.priorities.items;
    expect(item.properties.metric.enum).toEqual(IDS);
    expect(item.properties.drills.items.enum).toEqual(DRILLS.map((d) => d.id));
    expect(schema.additionalProperties).toBe(false);
    expect(item.additionalProperties).toBe(false);
  });
});

describe("parseCoaching", () => {
  it("resolves drill ids to drills", () => {
    const lesson = parseCoaching(
      JSON.stringify({
        headline: "Your hips are doing the damage.",
        plan: "Chair drill, then balls.",
        priorities: [
          { metric: "early-extension", why: "Room.", cue: "Backside back", drills: ["chair-drill"] },
        ],
      }),
      IDS,
      "claude-opus-5-5",
    );
    expect(lesson.priorities[0]?.drills[0]?.name).toBe("Backside on the chair");
    expect(lesson.model).toBe("claude-opus-5-5");
  });

  it("drops unknown metrics and drills, and caps the list", () => {
    const lesson = parseCoaching(
      JSON.stringify({
        headline: "h",
        plan: "p",
        priorities: [
          { metric: "shaft-lean", why: "", cue: "", drills: [] },
          { metric: "tempo", why: "", cue: "", drills: ["made-up-drill", "pause-at-top"] },
          { metric: "spine-tilt", why: "", cue: "", drills: [] },
          { metric: "knee-flex", why: "", cue: "", drills: [] },
          { metric: "arm-hang", why: "", cue: "", drills: [] },
        ],
      }),
      IDS,
      "m",
    );
    expect(lesson.priorities.map((p) => p.metricId)).not.toContain("shaft-lean");
    expect(lesson.priorities).toHaveLength(MAX_COACH_PRIORITIES);
    expect(lesson.priorities[0]?.drills.map((d) => d.id)).toEqual(["pause-at-top"]);
  });

  it("refuses text that is not JSON instead of showing it", () => {
    expect(() => parseCoaching("Sure! Here's a lesson:", IDS, "m")).toThrow();
  });
});

describe("askCoach, against a stubbed network", () => {
  afterEach(() => vi.unstubAllGlobals());

  function reply(status: number, body: unknown) {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const lesson = {
    headline: "Hips first.",
    plan: "Chair drill.",
    priorities: [{ metric: "early-extension", why: "Room.", cue: "Back", drills: ["chair-drill"] }],
  };

  it("sends the numbers to the Messages API with schema, effort and fallbacks", async () => {
    const fetch = reply(200, {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(lesson) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await askCoach("sk-ant-test", withReadings({ "early-extension": 12 }));
    expect(result.priorities[0]?.drills[0]?.id).toBe("chair-drill");

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages\b/);
    const headers = new Headers(init.headers);
    // SDK 1.x on API version 2026-10-21 sends the key as a bearer token;
    // older releases used x-api-key. Either is the key we were given.
    const sent = headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer /, "");
    expect(sent).toBe("sk-ant-test");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[0].content).toContain("early-extension");
  });

  it("turns a rejected key into a message for the golfer", async () => {
    reply(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    await expect(askCoach("sk-ant-bad", withReadings({ tempo: 1.5 }))).rejects.toThrow(
      /rejected that API key/,
    );
  });

  it("reports a refusal rather than parsing it", async () => {
    reply(200, {
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "refusal",
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(askCoach("k", withReadings({ tempo: 1.5 }))).rejects.toBeInstanceOf(CoachError);
  });
});

describe("canCoach", () => {
  it("needs at least one reading", () => {
    expect(canCoach(computeMetrics(null, null))).toBe(false);
    expect(canCoach(withReadings({ tempo: 3 }))).toBe(true);
  });
});
