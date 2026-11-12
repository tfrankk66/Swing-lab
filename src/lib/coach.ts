import type Anthropic from "@anthropic-ai/sdk";
import { DRILLS, FAULT_LABEL, directionOf, drillById, type Drill } from "./drills";
import { formatMetric, type Metric } from "./metrics";

/**
 * Claude as the coach: the nine numbers in, a short lesson out.
 *
 * ## What leaves the phone
 *
 * The nine readings, their bands and what each one cannot see — a few hundred
 * bytes of numbers and prose. **Never the video, never a frame, never a
 * landmark track.** That is the line the rest of the app is built on ("no
 * upload, no server holding your video") and coaching does not cross it.
 *
 * ## Whose key
 *
 * There is no Swing Lab server to hold an API key, so the golfer brings their
 * own and it lives in this browser's localStorage. The SDK calls that
 * "dangerous" because a key shipped *inside* a public web page is anyone's;
 * a key a user typed into their own installed app on their own phone is the
 * same trust as any other app they have given a key to. It is sent to
 * api.anthropic.com and nowhere else.
 *
 * ## Why the drills are an enum
 *
 * The response schema only accepts drill ids from `drills.ts`. Claude decides
 * which faults matter and why, and writes the cue, but every drill it can
 * prescribe is one a person wrote down and checked. A model asked for drills
 * freely will happily invent a plausible one.
 *
 * The SDK is imported on demand, like MediaPipe in `pose.ts`: nobody needs it
 * to load a clip, and most sessions at the range will never press the button.
 */

export const COACH_MODEL = "claude-opus-5-5";

/** Most priorities the coach may return; the panel never shows more. */
export const MAX_COACH_PRIORITIES = 3;

export interface CoachPriority {
  metricId: string;
  /** Why this one first, in plain language. */
  why: string;
  /** A single swing thought to take to the next ball. */
  cue: string;
  drills: Drill[];
}

export interface Coaching {
  headline: string;
  priorities: CoachPriority[];
  /** How to spend the next session. */
  plan: string;
  /** Which model actually answered (differs if a fallback ran). */
  model: string;
}

/* ------------------------------------------------------------ the prompt */

/**
 * Fixed for every request, so it caches. Nothing per-swing goes in here —
 * a timestamp or a reading in the system prompt would break the prefix.
 */
export function systemPrompt(): string {
  const library = DRILLS.map(
    (d) =>
      `- ${d.id}: ${d.name}. Fixes ${d.fixes
        .map((f) => `${f.metric} (${f.direction})`)
        .join(", ")}. ${d.steps[0]}`,
  ).join("\n");

  return `You are a golf coach reviewing one down-the-line swing that an app has measured from phone video with pose detection. You see only the measurements below, not the video.

How to coach:
- Pick at most ${MAX_COACH_PRIORITIES} things to work on, most important first. Fewer is better when one fault explains others: early extension, posture loss and head lift are often the same move, and fixing the root fixes the rest. Say so when that is the case.
- Work from cause to effect. A setup fault (spine tilt, knee flex, arm hang at address) usually comes before anything in motion that it causes.
- Respect each measurement's stated limitation. If a reading could be a camera or landmark artefact, say what to check before treating it as a fault.
- A reading marked "unread" was not measured. Never guess it.
- If everything is green, say so plainly and suggest one thing to keep checking. Do not invent a fault.
- The bands are coaching rules of thumb set deliberately wide, not tour norms. Do not describe a reading as elite or terrible.
- Plain language a weekend golfer understands. No jargon without a gloss. No more than two sentences per "why".
- The cue is one short swing thought the golfer can hold over the next ball, under twelve words.
- Choose drills only from this library, by id, one or two per priority:
${library}

Respond with JSON matching the schema: a one-sentence headline, the priorities, and a short plan for the next practice session (two or three sentences).`;
}

/** One reading, as the coach sees it. */
function describe(metric: Metric): string {
  const direction = directionOf(metric);
  const fault = direction ? FAULT_LABEL[metric.id]?.[direction] : undefined;
  const reading =
    metric.verdict === "unknown"
      ? "unread"
      : `${formatMetric(metric)}${metric.unit} — ${metric.verdict}${fault ? ` (${fault.toLowerCase()})` : ""}`;
  return [
    `${metric.id} · ${metric.name}, ${metric.where}: ${reading}`,
    `  good ${metric.good[0]}–${metric.good[1]}${metric.unit}, amber ${metric.watch[0]}–${metric.watch[1]}${metric.unit}`,
    `  what it means when out: ${metric.fault}`,
    metric.caveat ? `  limitation: ${metric.caveat}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function userPrompt(metrics: ReadonlyArray<Metric>): string {
  return `Here are the nine measurements from this swing:\n\n${metrics
    .map(describe)
    .join("\n\n")}`;
}

/**
 * The response schema. Structured outputs guarantee the shape, and the enums
 * keep metric and drill ids to ones this app knows.
 */
export function responseSchema(metricIds: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["headline", "priorities", "plan"],
    properties: {
      headline: { type: "string" },
      plan: { type: "string" },
      priorities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["metric", "why", "cue", "drills"],
          properties: {
            metric: { type: "string", enum: [...metricIds] },
            why: { type: "string" },
            cue: { type: "string" },
            drills: {
              type: "array",
              items: { type: "string", enum: DRILLS.map((d) => d.id) },
            },
          },
        },
      },
    },
  } as const;
}

/* ---------------------------------------------------------- the response */

interface RawCoaching {
  headline?: unknown;
  plan?: unknown;
  priorities?: unknown;
}

/**
 * Turns the model's JSON into something the panel can trust.
 *
 * Structured outputs already guarantee the shape, so this is belt and braces:
 * it drops anything naming a metric or drill the app does not know, caps the
 * list, and throws on text that is not JSON at all rather than showing it.
 */
export function parseCoaching(
  text: string,
  metricIds: readonly string[],
  model: string,
): Coaching {
  let raw: RawCoaching;
  try {
    raw = JSON.parse(text) as RawCoaching;
  } catch {
    throw new Error("The coach replied with something that was not a lesson.");
  }

  const known = new Set(metricIds);
  const priorities: CoachPriority[] = [];
  const list = Array.isArray(raw.priorities) ? raw.priorities : [];
  for (const item of list as Array<Record<string, unknown>>) {
    if (priorities.length >= MAX_COACH_PRIORITIES) break;
    const metricId = typeof item?.metric === "string" ? item.metric : "";
    if (!known.has(metricId)) continue;
    const drills = (Array.isArray(item.drills) ? item.drills : [])
      .map((id) => (typeof id === "string" ? drillById(id) : undefined))
      .filter((d): d is Drill => d !== undefined);
    priorities.push({
      metricId,
      why: typeof item.why === "string" ? item.why : "",
      cue: typeof item.cue === "string" ? item.cue : "",
      drills,
    });
  }

  return {
    headline: typeof raw.headline === "string" ? raw.headline : "",
    plan: typeof raw.plan === "string" ? raw.plan : "",
    priorities,
    model,
  };
}

/* ------------------------------------------------------------- the call */

/** A failure the panel can show as-is: written for the golfer, not a stack. */
export class CoachError extends Error {}

/** True when there is at least one measurement for the coach to talk about. */
export function canCoach(metrics: ReadonlyArray<Metric>): boolean {
  return metrics.some((m) => m.verdict !== "unknown");
}

export async function askCoach(
  apiKey: string,
  metrics: ReadonlyArray<Metric>,
  signal?: AbortSignal,
): Promise<Coaching> {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  const client: Anthropic = new AnthropicClient({
    apiKey,
    // Required for any browser use. See the note at the top on whose key it is.
    dangerouslyAllowBrowser: true,
  });

  const metricIds = metrics.map((m) => m.id);

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create(
      {
        model: COACH_MODEL,
        max_tokens: 16000,
        // If the primary model declines, the API retries on a fallback inside
        // the same call rather than returning nothing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: responseSchema(metricIds) },
        },
        system: [
          {
            type: "text",
            text: systemPrompt(),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userPrompt(metrics) }],
      },
      { signal },
    );
  } catch (error) {
    throw toCoachError(error, AnthropicClient);
  }

  if (response.stop_reason === "refusal") {
    throw new CoachError("The coach declined this one. Try again, or use the drills below.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new CoachError("The coach ran out of room mid-answer. Try again.");
  }

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  return parseCoaching(text, metricIds, response.model);
}

function toCoachError(
  error: unknown,
  sdk: typeof import("@anthropic-ai/sdk").default,
): Error {
  if (error instanceof sdk.APIUserAbortError) return error;
  if (error instanceof sdk.AuthenticationError) {
    return new CoachError("Anthropic rejected that API key. Check it and save it again.");
  }
  if (error instanceof sdk.PermissionDeniedError) {
    return new CoachError("That API key is not allowed to use this model.");
  }
  if (error instanceof sdk.RateLimitError) {
    return new CoachError("Rate limited. Wait a minute and try again.");
  }
  if (error instanceof sdk.APIConnectionError) {
    return new CoachError("Could not reach Anthropic. The coach needs signal; the drills below do not.");
  }
  if (error instanceof sdk.APIError) {
    return new CoachError(`The coach is unavailable right now (${error.status ?? "no status"}).`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/* ------------------------------------------------------------ the key */

const KEY_STORAGE = "swing-lab.anthropic-key";

/** Storage can be missing or throw (private mode, blocked site data). */
export function loadApiKey(): string {
  try {
    return window.localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key) window.localStorage.setItem(KEY_STORAGE, key);
    else window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Unsaved is fine: the key still works for this session from state.
  }
}
