/**
 * Deterministic mappings for cover generation
 */

export type Mood = "vidam" | "kalandos" | "nyugodt"
export type Theme = string
export type Length = "short" | "medium" | "long"

/**
 * Maps mood and length to Barni pose number (1-5)
 */
export function pickPose(mood: Mood, length: Length): number {
  if (mood === "vidam") return 3
  if (mood === "kalandos") return 4
  if (mood === "nyugodt" && length === "long") return 5
  if (mood === "nyugodt") return 2
  return 1 // default
}

/**
 * Maps theme, mood, and length to background number (1-5)
 */
export function pickBackground(theme: Theme, mood: Mood, length: Length): number {
  if (length === "long") return 5 // bg5_dark
  if (theme === "ur" || theme === "varazslat") return 3 // bg3_starry
  if (theme === "termeszet") return 4 // bg4_forest
  if (mood === "vidam") return 2 // bg2_warm
  return 1 // bg1_default
}

/**
 * Get Hungarian label for theme
 */
export function getThemeLabel(theme: Theme): string {
  const labels: Record<string, string> = {
    ur: "Űr",
    varazslat: "Varázslat",
    termeszet: "Természet",
    allatok: "Állatok",
    kaland: "Kaland",
    baratsag: "Barátság",
    csalad: "Család",
    sport: "Sport",
    muveszet: "Művészet",
    tudomany: "Tudomány",
  }
  return labels[theme] || theme
}

/**
 * Get Hungarian label for mood
 */
export function getMoodLabel(mood: Mood): string {
  const labels: Record<Mood, string> = {
    vidam: "Vidám",
    kalandos: "Kalandos",
    nyugodt: "Nyugodt",
  }
  return labels[mood] || mood
}

/**
 * Get Hungarian label for length
 */
export function getLengthLabel(length: Length): string {
  const labels: Record<Length, string> = {
    short: "Rövid (2–3p)",
    medium: "Közepes (4–5p)",
    long: "Hosszú (6–8p)",
  }
  return labels[length] || length
}
