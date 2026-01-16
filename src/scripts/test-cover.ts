#!/usr/bin/env bun

/**
 * Test script for cover generation
 * Usage: bun src/scripts/test-cover.ts
 */

import { writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { generateCoverWebp } from "../services/cover/generateCover"

async function testCoverGeneration() {
  console.log("🎨 Testing cover generation...\n")

  // Check if assets exist
  const barniPath = resolve(process.cwd(), "assets", "images", "barni", "1.png")
  const bgPath = resolve(process.cwd(), "assets", "images", "bgs", "bg1_default.png")

  if (!existsSync(barniPath)) {
    console.error(`❌ Barni asset not found: ${barniPath}`)
    process.exit(1)
  }

  if (!existsSync(bgPath)) {
    console.error(`❌ Background asset not found: ${bgPath}`)
    process.exit(1)
  }

  console.log("✅ Assets found\n")

  // Test different combinations
  const testCases = [
    {
      title: "Űrbeli kaland",
      theme: "ur",
      mood: "vidam" as const,
      length: "short" as const,
    },
    {
      title: "Nyugodt erdei séta",
      theme: "termeszet",
      mood: "nyugodt" as const,
      length: "medium" as const,
    },
    {
      title: "Hosszú varázslatos történet",
      theme: "varazslat",
      mood: "kalandos" as const,
      length: "long" as const,
    },
  ]

  const outputDir = resolve(process.cwd(), "test-output")
  if (!existsSync(outputDir)) {
    const { mkdirSync } = await import("node:fs")
    mkdirSync(outputDir, { recursive: true })
  }

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i]
    console.log(`Generating cover ${i + 1}/${testCases.length}: ${testCase.title}`)
    console.log(`  Theme: ${testCase.theme}, Mood: ${testCase.mood}, Length: ${testCase.length}`)

    try {
      const result = await generateCoverWebp(testCase)

      // Save main cover
      const coverPath = resolve(outputDir, `cover_${i + 1}_${testCase.theme}_${testCase.mood}.webp`)
      writeFileSync(coverPath, result.cover)
      console.log(`  ✅ Main cover saved: ${coverPath} (${result.cover.length} bytes)`)

      // Save square cover
      if (result.coverSquare) {
        const squarePath = resolve(outputDir, `cover_${i + 1}_${testCase.theme}_${testCase.mood}_square.webp`)
        writeFileSync(squarePath, result.coverSquare)
        console.log(`  ✅ Square cover saved: ${squarePath} (${result.coverSquare.length} bytes)`)
      }

      console.log()
    } catch (error) {
      console.error(`  ❌ Error generating cover:`, error)
      console.log()
    }
  }

  console.log(`\n✨ Test complete! Check the output files in: ${outputDir}`)
}

testCoverGeneration().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
