/**
 * GPT model pricing per 1M tokens (in USD)
 * Prices are approximate and may vary - update as needed
 */
const GPT_MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'gpt-5-mini': { input: 0.15, output: 0.60 }, // Assuming same as gpt-4o-mini
  'gpt-5.2': { input: 1.75, output: 14.0 }, // GPT-5.2 pricing per 1M tokens
}

/**
 * Default USD to HUF exchange rate
 * Can be overridden via env variable GPT_USD_TO_HUF_RATE
 */
const DEFAULT_USD_TO_HUF = 380 // Approximate rate, update as needed

/**
 * Calculate GPT cost in HUF based on token usage
 */
export function calculateGPTCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!model) {
    return 0
  }

  const prices = GPT_MODEL_PRICES[model]
  if (!prices) {
    // Unknown model, use default (gpt-4o-mini pricing)
    const defaultPrices = GPT_MODEL_PRICES['gpt-4o-mini']
    const usdCost = (inputTokens / 1_000_000) * defaultPrices.input + (outputTokens / 1_000_000) * defaultPrices.output
    const hufRate = Number(process.env.GPT_USD_TO_HUF_RATE) || DEFAULT_USD_TO_HUF
    return Math.round(usdCost * hufRate * 100) // Convert to cents
  }

  // Calculate USD cost
  const usdCost = (inputTokens / 1_000_000) * prices.input + (outputTokens / 1_000_000) * prices.output

  // Convert to HUF (cents)
  const hufRate = Number(process.env.GPT_USD_TO_HUF_RATE) || DEFAULT_USD_TO_HUF
  return Math.round(usdCost * hufRate * 100) // Convert to cents
}

/**
 * Get model pricing info
 */
export function getModelPricing(model: string | null): { input: number; output: number } | null {
  if (!model) return null
  return GPT_MODEL_PRICES[model] || null
}

/**
 * Audio cost: 1 credit (character) = 0.00022 USD
 * Calculate audio cost in HUF based on character count
 */
export function calculateAudioCost(characterCount: number | null): number {
  if (!characterCount || characterCount === 0) {
    return 0
  }

  // 1 character = 1 credit = 0.00022 USD
  const usdCost = characterCount * 0.00022

  // Convert to HUF (cents) using same rate as GPT
  const hufRate = Number(process.env.GPT_USD_TO_HUF_RATE) || DEFAULT_USD_TO_HUF
  return Math.round(usdCost * hufRate * 100) // Convert to cents
}
