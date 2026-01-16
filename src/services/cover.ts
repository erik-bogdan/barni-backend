import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import sharp from "sharp"

function escapeXml(value: string | null | undefined) {
  if (!value) return ""
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function truncate(value: string | null | undefined, max = 60) {
  if (!value) return ""
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function buildCoverSvg({
  title,
  theme,
  mood,
  length,
}: {
  title: string | null | undefined
  theme: string | null | undefined
  mood: string | null | undefined
  length: string | null | undefined
}) {
  const safeTitle = escapeXml(truncate(title || "Mese"))
  const safeTheme = escapeXml(theme || "Téma")
  const safeMood = escapeXml(mood || "Hangulat")
  const safeLength = escapeXml(length || "Hossz")

  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2b1055"/>
      <stop offset="50%" stop-color="#3d1a73"/>
      <stop offset="100%" stop-color="#2b1055"/>
    </linearGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="12" />
    </filter>
  </defs>
  <rect width="1200" height="630" rx="42" fill="url(#bg)"/>
  <circle cx="180" cy="120" r="90" fill="#4a2a8c" opacity="0.4" filter="url(#blur)"/>
  <circle cx="980" cy="90" r="70" fill="#6a3aa8" opacity="0.35" filter="url(#blur)"/>
  <g opacity="0.4" fill="#ffffff">
    <circle cx="120" cy="260" r="2"/>
    <circle cx="210" cy="340" r="2"/>
    <circle cx="320" cy="190" r="1.8"/>
    <circle cx="420" cy="120" r="2.2"/>
    <circle cx="560" cy="280" r="1.6"/>
    <circle cx="680" cy="170" r="1.8"/>
    <circle cx="820" cy="230" r="2"/>
  </g>
  <rect x="70" y="95" width="640" height="360" rx="32" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)"/>
  <text x="100" y="170" font-family="Outfit, Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff">${safeTitle}</text>
  <text x="100" y="220" font-family="Outfit, Arial, sans-serif" font-size="22" fill="rgba(255,255,255,0.75)">Barni Meséi</text>
  <g font-family="Outfit, Arial, sans-serif" font-size="18" font-weight="600">
    <rect x="100" y="260" rx="16" ry="16" width="170" height="40" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)"/>
    <text x="120" y="287" fill="#ffffff">${safeTheme}</text>

    <rect x="290" y="260" rx="16" ry="16" width="150" height="40" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)"/>
    <text x="310" y="287" fill="#ffffff">${safeMood}</text>

    <rect x="460" y="260" rx="16" ry="16" width="150" height="40" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)"/>
    <text x="480" y="287" fill="#ffffff">${safeLength}</text>
  </g>
</svg>
`.trim()
}

export async function generateCoverBuffer(input: {
  title?: string | null
  theme?: string | null
  mood?: string | null
  length?: string | null
}): Promise<Buffer> {
  const barniPath = resolve(process.cwd(), "assets", "barni.png")
  if (!existsSync(barniPath)) {
    throw new Error("assets/barni.png is missing")
  }
  const barniBuffer = readFileSync(barniPath)
  const barniResized = await sharp(barniBuffer)
    .resize({ width: 360 })
    .png()
    .toBuffer()

  const svg = buildCoverSvg(input)
  const svgBuffer = Buffer.from(svg)

  return sharp(svgBuffer)
    .composite([{ input: barniResized, left: 760, top: 150 }])
    .webp({ quality: 88 })
    .toBuffer()
}

