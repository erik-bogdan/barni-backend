import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import sharp from "sharp"
import { pickPose, pickBackground, getThemeLabel, getMoodLabel, getLengthLabel, type Mood, type Theme, type Length } from "./constants"
import { getLogger } from "../../lib/logger"

const COVER_WIDTH = 1200
const COVER_HEIGHT = 630
const COVER_SQUARE_SIZE = 600

/**
 * Escape XML/SVG special characters
 */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

/**
 * Truncate title to fit in 2 lines (approximately 50 chars per line)
 */
function truncateTitle(title: string, maxLength = 100): string {
  if (title.length <= maxLength) return title
  return `${title.slice(0, maxLength - 3)}...`
}

/**
 * Wrap title text into 2 lines
 */
function wrapTitle(title: string): string[] {
  const truncated = truncateTitle(title)
  const words = truncated.split(" ")
  if (words.length <= 1) return [truncated, ""]
  
  const mid = Math.ceil(words.length / 2)
  const line1 = words.slice(0, mid).join(" ")
  const line2 = words.slice(mid).join(" ")
  
  return [line1, line2]
}

/**
 * Build SVG overlay for title and chips (square version)
 */
function buildTextOverlaySvgSquare(params: {
  title: string
  theme: Theme
  mood: Mood
  length: Length
}): string {
  const [titleLine1, titleLine2] = wrapTitle(params.title)
  const safeTitle1 = escapeXml(titleLine1)
  const safeTitle2 = escapeXml(titleLine2)
  const themeLabel = escapeXml(getThemeLabel(params.theme))
  const moodLabel = escapeXml(getMoodLabel(params.mood))
  const lengthLabel = escapeXml(getLengthLabel(params.length))

  return `
<svg width="${COVER_SQUARE_SIZE}" height="${COVER_SQUARE_SIZE}" viewBox="0 0 ${COVER_SQUARE_SIZE} ${COVER_SQUARE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="titleShadowSquare" x="-50%" y="-50%" width="200%" height="200%">
      <feOffset dx="0" dy="2" result="offset"/>
      <feFlood flood-color="rgba(0,0,0,0.3)"/>
      <feComposite in2="offset" operator="in" result="shadow"/>
      <feGaussianBlur in="shadow" stdDeviation="2"/>
      <feComposite in2="SourceGraphic" operator="over"/>
    </filter>
  </defs>
  
  <!-- Title (smaller, top) -->
  <g font-family="Outfit, Arial, sans-serif" fill="#ffffff">
    <text x="40" y="100" font-size="36" font-weight="700" filter="url(#titleShadowSquare)">
      ${safeTitle1}
    </text>
    ${titleLine2 ? `<text x="40" y="140" font-size="36" font-weight="700" filter="url(#titleShadowSquare)">${safeTitle2}</text>` : ""}
  </g>
  
  <!-- Chips (smaller, bottom) -->
  <g font-family="Outfit, Arial, sans-serif" font-size="12" font-weight="600" fill="#ffffff">
    <!-- Theme chip -->
    <rect x="40" y="520" rx="12" ry="12" width="90" height="32" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="85" y="536" text-anchor="middle" dominant-baseline="middle">${themeLabel}</text>
    
    <!-- Mood chip -->
    <rect x="145" y="520" rx="12" ry="12" width="90" height="32" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="190" y="536" text-anchor="middle" dominant-baseline="middle">${moodLabel}</text>
    
    <!-- Length chip -->
    <rect x="250" y="520" rx="12" ry="12" width="130" height="32" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="315" y="536" text-anchor="middle" dominant-baseline="middle">${lengthLabel}</text>
  </g>
</svg>
`.trim()
}

/**
 * Build SVG overlay for title and chips (main cover)
 */
function buildTextOverlaySvg(params: {
  title: string
  theme: Theme
  mood: Mood
  length: Length
}): string {
  const [titleLine1, titleLine2] = wrapTitle(params.title)
  const safeTitle1 = escapeXml(titleLine1)
  const safeTitle2 = escapeXml(titleLine2)
  const themeLabel = escapeXml(getThemeLabel(params.theme))
  const moodLabel = escapeXml(getMoodLabel(params.mood))
  const lengthLabel = escapeXml(getLengthLabel(params.length))

  return `
<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="titleShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feOffset dx="0" dy="2" result="offset"/>
      <feFlood flood-color="rgba(0,0,0,0.3)"/>
      <feComposite in2="offset" operator="in" result="shadow"/>
      <feGaussianBlur in="shadow" stdDeviation="2"/>
      <feComposite in2="SourceGraphic" operator="over"/>
    </filter>
  </defs>
  
  <!-- Title -->
  <g font-family="Outfit, Arial, sans-serif" fill="#ffffff">
    <text x="80" y="180" font-size="56" font-weight="700" filter="url(#titleShadow)">
      ${safeTitle1}
    </text>
    ${titleLine2 ? `<text x="80" y="240" font-size="56" font-weight="700" filter="url(#titleShadow)">${safeTitle2}</text>` : ""}
  </g>
  
  <!-- Chips -->
  <g font-family="Outfit, Arial, sans-serif" font-size="16" font-weight="600" fill="#ffffff">
    <!-- Theme chip -->
    <rect x="80" y="480" rx="20" ry="20" width="140" height="40" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="150" y="500" text-anchor="middle" dominant-baseline="middle">${themeLabel}</text>
    
    <!-- Mood chip -->
    <rect x="240" y="480" rx="20" ry="20" width="140" height="40" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="310" y="500" text-anchor="middle" dominant-baseline="middle">${moodLabel}</text>
    
    <!-- Length chip -->
    <rect x="400" y="480" rx="20" ry="20" width="200" height="40" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="500" y="500" text-anchor="middle" dominant-baseline="middle">${lengthLabel}</text>
  </g>
</svg>
`.trim()
}

/**
 * Build SVG for aura effect behind Barni
 */
function buildAuraSvg(): string {
  return `
<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="auraBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="30" />
    </filter>
    <radialGradient id="auraGrad" cx="50%" cy="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="950" cy="450" rx="180" ry="120" fill="url(#auraGrad)" filter="url(#auraBlur)"/>
</svg>
`.trim()
}

/**
 * Build SVG for shadow/ledge under Barni
 */
function buildShadowSvg(): string {
  return `
<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadowBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="15" />
    </filter>
  </defs>
  <ellipse cx="950" cy="580" rx="200" ry="40" fill="rgba(0,0,0,0.4)" filter="url(#shadowBlur)"/>
</svg>
`.trim()
}

/**
 * Get asset path for Barni pose
 */
function getBarniPosePath(poseNumber: number): string {
  const path = resolve(process.cwd(), "assets", "images", "barni", `${poseNumber}.png`)
  if (!existsSync(path)) {
    throw new Error(`Barni pose asset missing: ${path}`)
  }
  return path
}

/**
 * Get asset path for background
 */
function getBackgroundPath(bgNumber: number): string {
  const bgNames: Record<number, string> = {
    1: "bg1_default",
    2: "bg2_warm",
    3: "bg3_starry",
    4: "bg4_forrest",
    5: "bg5_dark",
  }
  const bgName = bgNames[bgNumber] || bgNames[1]
  const path = resolve(process.cwd(), "assets", "images", "bgs", `${bgName}.png`)
  if (!existsSync(path)) {
    throw new Error(`Background asset missing: ${path}`)
  }
  return path
}

export interface GenerateCoverInput {
  title: string
  theme: Theme
  mood: Mood
  length: Length
}

export interface GenerateCoverOutput {
  cover: Buffer
  coverSquare?: Buffer
}

/**
 * Generate cover image (1200x630) and optionally square version (600x600)
 */
export async function generateCoverWebp(input: GenerateCoverInput): Promise<GenerateCoverOutput> {
  const logger = getLogger()
  const { title, theme, mood, length } = input
  const start = Date.now()

  // Pick assets deterministically
  const poseNumber = pickPose(mood, length)
  const bgNumber = pickBackground(theme, mood, length)

  // Load assets
  const bgPath = getBackgroundPath(bgNumber)
  const barniPath = getBarniPosePath(poseNumber)

  // Load and resize background to cover size
  const background = await sharp(bgPath)
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover" })
    .toBuffer()

  // Load and resize Barni pose
  // Barni should be ~75-80% of cover height, positioned right/bottom
  const barniHeight = Math.round(COVER_HEIGHT * 0.78)
  const barniImage = await sharp(barniPath)
    .resize(null, barniHeight, { fit: "contain" })
    .toBuffer()

  const barniMetadata = await sharp(barniImage).metadata()
  const barniWidth = barniMetadata.width || 0

  // Position Barni on the right, bottom-aligned
  const barniLeft = COVER_WIDTH - barniWidth - 50
  const barniTop = COVER_HEIGHT - barniHeight - 20

  // Build overlays for main cover
  const auraSvg = Buffer.from(buildAuraSvg())
  const shadowSvg = Buffer.from(buildShadowSvg())
  const textSvg = Buffer.from(buildTextOverlaySvg({ title, theme, mood, length }))

  // Composite main cover
  const cover = await sharp(background)
    .composite([
      { input: auraSvg, blend: "over" },
      { input: shadowSvg, blend: "over" },
      { input: barniImage, left: barniLeft, top: barniTop, blend: "over" },
      { input: textSvg, blend: "over" },
    ])
    .webp({ quality: 90 })
    .toBuffer()

  // Generate square version separately with different composition
  const bgSquare = await sharp(bgPath)
    .resize(COVER_SQUARE_SIZE, COVER_SQUARE_SIZE, { fit: "cover" })
    .toBuffer()

  // Barni for square: smaller, positioned center-right
  const barniHeightSquare = Math.round(COVER_SQUARE_SIZE * 0.65)
  const barniImageSquare = await sharp(barniPath)
    .resize(null, barniHeightSquare, { fit: "contain" })
    .toBuffer()

  const barniMetadataSquare = await sharp(barniImageSquare).metadata()
  const barniWidthSquare = barniMetadataSquare.width || 0

  // Position Barni on the right, bottom-aligned for square
  const barniLeftSquare = COVER_SQUARE_SIZE - barniWidthSquare - 30
  const barniTopSquare = COVER_SQUARE_SIZE - barniHeightSquare - 60 // Leave space for chips

  // Build square overlays
  const auraSvgSquare = Buffer.from(`
<svg width="${COVER_SQUARE_SIZE}" height="${COVER_SQUARE_SIZE}" viewBox="0 0 ${COVER_SQUARE_SIZE} ${COVER_SQUARE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="auraBlurSquare" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="20" />
    </filter>
    <radialGradient id="auraGradSquare" cx="50%" cy="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="${COVER_SQUARE_SIZE - 100}" cy="${COVER_SQUARE_SIZE - 100}" rx="100" ry="70" fill="url(#auraGradSquare)" filter="url(#auraBlurSquare)"/>
</svg>
`.trim())

  const shadowSvgSquare = Buffer.from(`
<svg width="${COVER_SQUARE_SIZE}" height="${COVER_SQUARE_SIZE}" viewBox="0 0 ${COVER_SQUARE_SIZE} ${COVER_SQUARE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadowBlurSquare" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" />
    </filter>
  </defs>
  <ellipse cx="${COVER_SQUARE_SIZE - 100}" cy="${COVER_SQUARE_SIZE - 30}" rx="120" ry="25" fill="rgba(0,0,0,0.4)" filter="url(#shadowBlurSquare)"/>
</svg>
`.trim())

  const textSvgSquare = Buffer.from(buildTextOverlaySvgSquare({ title, theme, mood, length }))

  // Composite square cover
  const coverSquare = await sharp(bgSquare)
    .composite([
      { input: auraSvgSquare, blend: "over" },
      { input: shadowSvgSquare, blend: "over" },
      { input: barniImageSquare, left: barniLeftSquare, top: barniTopSquare, blend: "over" },
      { input: textSvgSquare, blend: "over" },
    ])
    .webp({ quality: 90 })
    .toBuffer()

  const durationMs = Date.now() - start
  logger.info(
    {
      backgroundId: bgNumber,
      poseId: poseNumber,
      durationMs,
      outputBytes: cover.length,
      outputSquareBytes: coverSquare.length,
    },
    "cover.generated",
  )

  return { cover, coverSquare }
}
