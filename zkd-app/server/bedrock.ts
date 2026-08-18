/**
 * The one Bedrock call in this codebase: turn a member's free-text
 * preference prompt into a structured patch (server/preferences/refinePatch.ts)
 * server/engine/refine.ts can safely merge into a re-rank. Unlike
 * server/gemini.ts (a deliberately dependency-free `fetch` for a single
 * unauthenticated-by-API-key REST call), Bedrock needs real AWS SigV4
 * request signing — hand-rolling that would be its own maintenance burden
 * for no benefit, so this uses the official SDK.
 *
 * Same "absent config → null, never fabricate" discipline as gemini.ts/
 * myca.ts: no BEDROCK_INFERENCE_PROFILE_ARN configured, any network/timeout
 * failure, an open circuit, or a response that fails the strict zod schema
 * all return null — never throw, never guess. The caller (refine.ts) falls
 * back to the unmodified deterministic ranking on null, with an honest note.
 */
import { CircuitBreaker } from './engine/circuitBreaker';
import { PreferencePatchSchema, PREFERENCE_PATCH_JSON_SCHEMA, type PreferencePatch } from './preferences/refinePatch';

const TOOL_NAME = 'emit_preference_patch';
const BEDROCK_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT =
  'A traveler whose flight was disrupted is asking for a different rebooking option in their own ' +
  'words. Extract ONLY the fields you are confident about from what they actually said; leave every ' +
  'other field unset. Never invent an airline code, a strategy, or a time they did not imply. Always ' +
  'call the emit_preference_patch tool exactly once, with a short rationale explaining what you understood.';

const bedrockBreaker = new CircuitBreaker('bedrock-refine', { failureThreshold: 5, cooldownMs: 30_000 });

let clientPromise: Promise<import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient> | null = null;
async function getClient() {
  if (!clientPromise) {
    clientPromise = import('@aws-sdk/client-bedrock-runtime').then(
      ({ BedrockRuntimeClient }) => new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'ap-south-1' }),
    );
  }
  return clientPromise;
}

/**
 * Returns null on ANY failure — unreachable, timeout, circuit open, no
 * tool-use block in the response, or a response that fails the strict zod
 * schema. Never throws.
 */
export async function parsePreferencePrompt(prompt: string): Promise<PreferencePatch | null> {
  const modelId = process.env.BEDROCK_INFERENCE_PROFILE_ARN;
  if (!modelId) return null;

  try {
    return await bedrockBreaker.execute(async () => {
      const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = await getClient();

      const res = await client.send(
        new ConverseCommand({
          // An inference-profile ARN, never a floating model alias — matches
          // documentation/agent-specs/current's frozen §A2 "model id and
          // version are pinned" rule.
          modelId,
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          system: [{ text: SYSTEM_PROMPT }],
          toolConfig: {
            toolChoice: { tool: { name: TOOL_NAME } },
            tools: [
              {
                toolSpec: {
                  name: TOOL_NAME,
                  description: 'Emit the structured preference patch extracted from the member\'s prompt.',
                  // The SDK's DocumentType is a hand-written recursive union
                  // that a plain JSON-Schema object literal doesn't
                  // structurally satisfy — this is a real JSON value at an
                  // SDK boundary that wants "any JSON," not a type escape hatch.
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  inputSchema: { json: PREFERENCE_PATCH_JSON_SCHEMA as any },
                },
              },
            ],
          },
        }),
        { abortSignal: AbortSignal.timeout(BEDROCK_TIMEOUT_MS) },
      );

      const blocks = res.output?.message?.content ?? [];
      const toolUseBlock = blocks.find((b) => 'toolUse' in b) as { toolUse?: { input?: unknown } } | undefined;
      const toolUse = toolUseBlock?.toolUse;
      if (!toolUse) throw new Error('no tool_use block in Bedrock response');

      const parsed = PreferencePatchSchema.safeParse(toolUse.input);
      if (!parsed.success) throw new Error(`invalid preference patch shape: ${parsed.error.message}`);
      return parsed.data;
    });
  } catch {
    return null;
  }
}
