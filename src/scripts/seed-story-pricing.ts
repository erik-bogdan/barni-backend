import { db } from "../lib/db"
import { storyPricing } from "../../packages/db/src/schema"
import { eq } from "drizzle-orm"

const DEFAULT_PRICING = [
  // Regular stories
  { key: "story_short", length: "short", isInteractive: false, isAudio: false, credits: 20 },
  { key: "story_medium", length: "medium", isInteractive: false, isAudio: false, credits: 35 },
  { key: "story_long", length: "long", isInteractive: false, isAudio: false, credits: 50 },
  
  // Interactive stories
  { key: "story_interactive_short", length: "short", isInteractive: true, isAudio: false, credits: 60 },
  { key: "story_interactive_medium", length: "medium", isInteractive: true, isAudio: false, credits: 80 },
  { key: "story_interactive_long", length: "long", isInteractive: true, isAudio: false, credits: 100 },
  
  // Audio
  { key: "audio_short", length: "short", isInteractive: false, isAudio: true, credits: 300 },
  { key: "audio_medium", length: "medium", isInteractive: false, isAudio: true, credits: 400 },
  { key: "audio_long", length: "long", isInteractive: false, isAudio: true, credits: 500 },
]

export async function seedStoryPricing() {
  console.log("Seeding story pricing...")

  for (const pricing of DEFAULT_PRICING) {
    const [existing] = await db
      .select()
      .from(storyPricing)
      .where(eq(storyPricing.key, pricing.key))
      .limit(1)

    if (existing) {
      // Update existing pricing
      await db
        .update(storyPricing)
        .set({
          credits: pricing.credits,
          updatedAt: new Date(),
        })
        .where(eq(storyPricing.key, pricing.key))
      console.log(`Updated pricing for ${pricing.key}: ${pricing.credits} credits`)
    } else {
      // Insert new pricing
      await db.insert(storyPricing).values(pricing)
      console.log(`Created pricing for ${pricing.key}: ${pricing.credits} credits`)
    }
  }

  console.log("Story pricing seeded successfully!")
}

if (import.meta.main) {
  seedStoryPricing()
    .then(() => {
      console.log("Done!")
      process.exit(0)
    })
    .catch((err) => {
      console.error("Error seeding story pricing:", err)
      process.exit(1)
    })
}
