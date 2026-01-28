#!/usr/bin/env bun

/**
 * Generate missing covers for all stories
 * Usage: bun src/scripts/generate-missing-covers.ts
 */

import { or, eq, sql } from "drizzle-orm"
import { db } from "../lib/db"
import { stories } from "../../packages/db/src/schema"
import { createCoverRepo, buildCoverKey, buildCoverSquareKey } from "../services/cover/coverService"
import { generateCoverWebp } from "../services/cover/generateCover"
import { type Mood, type Theme, type Length } from "../services/cover/constants"
import { uploadBuffer, buildPublicUrl } from "../services/s3"
import { createLogger, setLogger } from "../lib/logger"

const logger = createLogger("backend")
setLogger(logger)

const COVER_CACHE_CONTROL = "public, max-age=31536000, immutable"

async function generateMissingCovers() {
  logger.info("covers.generate_missing.start")

  // Find all stories without cover
  // Use IS NULL instead of eq(column, null) because SQL null comparison doesn't work with =
  const storiesWithoutCover = await db
    .select({
      id: stories.id,
      title: stories.title,
      theme: stories.theme,
      mood: stories.mood,
      length: stories.length,
      coverUrl: stories.coverUrl,
      coverSquareUrl: stories.coverSquareUrl,
    })
    .from(stories)
    .where(
      or(
        sql`${stories.coverUrl} IS NULL`,
        sql`${stories.coverSquareUrl} IS NULL`,
      ),
    )

  const total = storiesWithoutCover.length

  if (total === 0) {
    logger.info("covers.generate_missing.none")
    return
  }

  logger.info({ total }, "covers.generate_missing.found")

  const repo = createCoverRepo(db)
  let successCount = 0
  let errorCount = 0

  for (let i = 0; i < storiesWithoutCover.length; i++) {
    const story = storiesWithoutCover[i]
    const progress = `[${i + 1}/${total}]`

    // Skip if story doesn't have title
    if (!story.title) {
      logger.info({ storyId: story.id }, "covers.generate_missing.skip_no_title")
      continue
    }

    // Skip if already has both covers
    if (story.coverUrl && story.coverSquareUrl) {
      logger.info({ storyId: story.id }, "covers.generate_missing.skip_existing")
      continue
    }

    try {
    logger.info({ storyId: story.id, title: story.title }, "covers.generate_missing.processing")

      // Generate cover
      const { cover, coverSquare } = await generateCoverWebp({
        title: story.title,
        theme: story.theme as Theme,
        mood: story.mood as Mood,
        length: story.length as Length,
      })

      // Upload main cover (if missing)
      let coverUrl = story.coverUrl
      if (!coverUrl) {
        const coverKey = buildCoverKey(story.id)
        await uploadBuffer({
          key: coverKey,
          body: cover,
          contentType: "image/webp",
          cacheControl: COVER_CACHE_CONTROL,
        })
        coverUrl = buildPublicUrl(coverKey)
        logger.info({ storyId: story.id, coverKey }, "covers.generate_missing.cover_uploaded")
      }

      // Upload square cover (if missing)
      let coverSquareUrl = story.coverSquareUrl
      if (!coverSquareUrl && coverSquare) {
        const coverSquareKey = buildCoverSquareKey(story.id)
        await uploadBuffer({
          key: coverSquareKey,
          body: coverSquare,
          contentType: "image/webp",
          cacheControl: COVER_CACHE_CONTROL,
        })
        coverSquareUrl = buildPublicUrl(coverSquareKey)
        logger.info({ storyId: story.id, coverSquareKey }, "covers.generate_missing.cover_square_uploaded")
      }

      // Update database
      await repo.updateCover(story.id, {
        coverUrl,
        coverSquareUrl,
      })

      successCount++
      logger.info({ storyId: story.id }, "covers.generate_missing.assigned")
    } catch (error) {
      errorCount++
      logger.error(
        { err: error, storyId: story.id },
        "covers.generate_missing.failed",
      )

      // Update DB to mark as failed (null coverUrl)
      try {
        await repo.updateCover(story.id, {
          coverUrl: null,
          coverSquareUrl: null,
        })
      } catch (updateErr) {
        logger.error(
          { err: updateErr, storyId: story.id },
          "covers.generate_missing.db_update_failed",
        )
      }
    }
  }

  logger.info(
    { successCount, errorCount, total },
    "covers.generate_missing.summary",
  )
}

generateMissingCovers()
  .then(() => {
    logger.info("covers.generate_missing.done")
    process.exit(0)
  })
  .catch((error) => {
    logger.error({ err: error }, "covers.generate_missing.fatal")
    process.exit(1)
  })
