import type { StoryLength } from "./credits"

export const THEMES = [
  "csillagok",
  "erdő",
  "tenger",
  "űrutazás",
  "sárkánybarát",
  "állatkerti kaland",
  "varázskönyv",
  "szivárvány",
  "téli mese",
  "nyári tábor",
  "réti piknik",
  "őserdei felfedezés",
  "hópihe",
  "kisvasút",
  "légballon",
  "titkos kert",
  "mókusbarát",
  "tópart",
  "hegyi ösvény",
  "mesevonat",
  "csiga-postás",
  "felhősziget",
  "holdfény",
  "vulkán",
  "tündérfalu",
  "kincses térkép",
  "szélmalom",
  "kincskeresés",
  "bálnadala",
  "sivatagi oázis",
  "vihar után",
  "őszi lomb",
  "tavaszi rügyek",
  "kavicsgyűjtés",
  "kandalló melege",
  "vitorlázás",
  "gombák titka",
  "barlangi fények",
  "mesebeli híd",
  "űrbéli kert",
]

type AvoidPair = {
  setting: string
  conflict: string
}

type PromptInput = {
  childAge: number
  mood: "nyugodt" | "vidam" | "kalandos"
  length: StoryLength
  theme: string
  lesson?: string | null
  avoidPairs: AvoidPair[]
}

function lengthLabel(length: StoryLength) {
  if (length === "short") return "rövid"
  if (length === "medium") return "közepes"
  return "hosszú"
}

function wordRange(length: StoryLength) {
  if (length === "short") return "400–520 words"
  if (length === "medium") return "650–800 words"
  return "950–1100 words"
}

export function buildStoryPrompt(input: PromptInput): string {
  const avoidList =
    input.avoidPairs.length === 0
      ? "None"
      : input.avoidPairs.map((p) => `- ${p.setting} / ${p.conflict}`).join("\n")

  return `
You are a senior children's story writer.
Write a UNIQUE Hungarian bedtime story.

OUTPUT LANGUAGE: Hungarian.
Style: warm, comforting, modern, short paragraphs.
Target age: ${input.childAge} years.
Theme: ${input.theme}.
Mood: ${input.mood}.
Length: ${lengthLabel(input.length)} (${wordRange(input.length)}).
Lesson (optional): ${input.lesson ?? "none"}.

AVOID (do not reuse these setting/conflict pairs):
${avoidList}

LANGUAGE RULES (STRICT):
- Use simple, natural Hungarian.
- Avoid abstract or literary expressions.
- Avoid unusual verb forms or rare words.
- Avoid future-reflective phrases like "majd később megismerte".
- Do NOT invent new locations or objects in the last paragraph.
- The final sentence must stay consistent with the setting.
- Never introduce modern or urban elements (shops, photos, devices).
- Prefer concrete, child-friendly words.

ENDING CONSTRAINT:
- The ending must repeat at least one concrete element already mentioned (e.g. park, mushrooms, trees).
- The ending must be calm, grounded, and not introduce anything new.
- The ending must feel like bedtime, not reflection.

Hard rules:
- Do not give the child a title/role name (no "király", "hős", "varázsló" titles).
- Avoid scary, aggressive, or threatening elements.
- Avoid classic fairy-tale clichés (e.g. evil witch, dark curse, wicked stepmother, magic wand shortcuts).
- Do not reuse any AVOID pair (even paraphrased).
- End calmly and safely with a bedtime-friendly closing.
- Use 6-10 short paragraphs.

Return only the story text.
`.trim()
}

