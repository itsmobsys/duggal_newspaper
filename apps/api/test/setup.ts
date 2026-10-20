/**
 * Tests must never reach the real NVIDIA API.
 *
 * The root .env holds production credentials, and dotenv never overrides a
 * variable that is already present. Setting an empty key here (before any test
 * imports src/config.ts) keeps the suite hermetic: AI calls fail fast with
 * AI_NOT_CONFIGURED unless a test opts in by assigning config.ai.apiKey and
 * stubbing fetch.
 */
process.env.NVIDIA_API_KEY = '';
