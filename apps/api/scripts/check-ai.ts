import { z } from 'zod';
import { config } from '../src/config.js';
import { closeDb } from '../src/db/client.js';
import { chatJson, checkModelAvailability } from '../src/services/ai/client.js';

/**
 * Verifies the exact configured model. There is deliberately no fallback:
 * if the model is missing, this script fails loudly.
 */
async function main(): Promise<void> {
  console.log(`[ai] base URL: ${config.ai.baseUrl}`);
  console.log(`[ai] model:    ${config.ai.model}`);
  if (!config.ai.apiKey) {
    console.error('[ai] NVIDIA_API_KEY is not set.');
    process.exit(1);
  }

  const availability = await checkModelAvailability();
  console.log(
    `[ai] model listed for this key: ${availability.available ? 'yes' : 'NO'} ` +
      `(${availability.modelsSeen} models visible)`,
  );
  if (availability.error) console.error(`[ai] ${availability.error}`);
  if (!availability.available) {
    console.error('[ai] Refusing to continue: no silent model substitution is allowed.');
    process.exit(1);
  }

  const result = await chatJson({
    purpose: 'check_ai',
    system:
      'You are a health check for a newsroom. Return only JSON matching the requested shape. Do not add commentary.',
    user: 'Return exactly {"ok": true, "message": "press ready"}.',
    schema: z.object({ ok: z.boolean(), message: z.string() }),
    maxTokens: 80,
    temperature: 0,
  });
  console.log(`[ai] response: ${JSON.stringify(result.data)} (attempts: ${result.attempts})`);
  console.log('[ai] OK');
  await closeDb();
}

main().catch((error) => {
  console.error('[ai] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
