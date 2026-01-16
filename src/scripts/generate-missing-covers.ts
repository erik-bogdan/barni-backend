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

const COVER_CACHE_CONTROL = "public, max-age=31536000, immutable"

async function generateMissingCovers() {
  console.log("🎨 Generating missing covers...\n")

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
    console.log("✅ No stories missing covers!")
    return
  }

  console.log(`Found ${total} story/stories without cover(s)\n`)

  const repo = createCoverRepo(db)
  let successCount = 0
  let errorCount = 0

  for (let i = 0; i < storiesWithoutCover.length; i++) {
    const story = storiesWithoutCover[i]
    const progress = `[${i + 1}/${total}]`

    // Skip if story doesn't have title
    if (!story.title) {
      console.log(`${progress} ⏭️  Skipping ${story.id} - no title`)
      continue
    }

    // Skip if already has both covers
    if (story.coverUrl && story.coverSquareUrl) {
      console.log(`${progress} ⏭️  Skipping ${story.id} - already has covers`)
      continue
    }

    try {
      console.log(`${progress} 📝 Processing: ${story.title} (${story.id})`)

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
        console.log(`   ✅ Main cover uploaded: ${coverKey}`)
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
        console.log(`   ✅ Square cover uploaded: ${coverSquareKey}`)
      }

      // Update database
      await repo.updateCover(story.id, {
        coverUrl,
        coverSquareUrl,
      })

      successCount++
      console.log(`   ✨ Cover assigned to story\n`)
    } catch (error) {
      errorCount++
      console.error(`   ❌ Error:`, error instanceof Error ? error.message : error)
      console.log()

      // Update DB to mark as failed (null coverUrl)
      try {
        await repo.updateCover(story.id, {
          coverUrl: null,
          coverSquareUrl: null,
        })
      } catch (updateErr) {
        console.error(`   ⚠️  Failed to update DB:`, updateErr)
      }
    }
  }

  console.log("\n" + "=".repeat(50))
  console.log(`✨ Summary:`)
  console.log(`   ✅ Success: ${successCount}`)
  console.log(`   ❌ Errors: ${errorCount}`)
  console.log(`   📊 Total: ${total}`)
  console.log("=".repeat(50))
}

generateMissingCovers()
  .then(() => {
    console.log("\n✅ Done!")
    process.exit(0)
  })
  .catch((error) => {
    console.error("\n❌ Fatal error:", error)
    process.exit(1)
  })
