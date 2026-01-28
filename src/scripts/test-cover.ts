#!/usr/bin/env bun

/**
 * Test script for cover generation
 * Usage: bun src/scripts/test-cover.ts
 */

import { writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { generateCoverWebp } from "../services/cover/generateCover"
import { createLogger, setLogger } from "../lib/logger"

const logger = createLogger("backend")
setLogger(logger)

async function testCoverGeneration() {
  logger.info("cover_test.start")

  // Check if assets exist
  const barniPath = resolve(process.cwd(), "assets", "images", "barni", "1.png")
  const bgPath = resolve(process.cwd(), "assets", "images", "bgs", "bg1_default.png")

  if (!existsSync(barniPath)) {
    logger.error({ path: barniPath }, "cover_test.barni_missing")
    process.exit(1)
  }

  if (!existsSync(bgPath)) {
    logger.error({ path: bgPath }, "cover_test.background_missing")
    process.exit(1)
  }

  logger.info("cover_test.assets_found")

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
    logger.info(
      {
        index: i + 1,
        total: testCases.length,
        title: testCase.title,
        theme: testCase.theme,
        mood: testCase.mood,
        length: testCase.length,
      },
      "cover_test.case_start",
    )

    try {
      const result = await generateCoverWebp(testCase)

      // Save main cover
      const coverPath = resolve(outputDir, `cover_${i + 1}_${testCase.theme}_${testCase.mood}.webp`)
      writeFileSync(coverPath, result.cover)
      logger.info(
        { path: coverPath, bytes: result.cover.length },
        "cover_test.cover_saved",
      )

      // Save square cover
      if (result.coverSquare) {
        const squarePath = resolve(outputDir, `cover_${i + 1}_${testCase.theme}_${testCase.mood}_square.webp`)
        writeFileSync(squarePath, result.coverSquare)
        logger.info(
          { path: squarePath, bytes: result.coverSquare.length },
          "cover_test.cover_square_saved",
        )
      }

    } catch (error) {
      logger.error({ err: error }, "cover_test.case_failed")
    }
  }

  logger.info({ outputDir }, "cover_test.complete")
}

testCoverGeneration().catch((error) => {
  logger.error({ err: error }, "cover_test.fatal")
  process.exit(1)
})
