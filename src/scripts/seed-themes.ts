import { and, eq } from "drizzle-orm"

import { db } from "../lib/db"
import { themeCategories, themes } from "../../packages/db/src/schema"

type SeedTheme = {
  category: string
  name: string
  icon: string
  main?: boolean
}

const SEED: SeedTheme[] = [
  // Favorites (main)
  { category: "Kedvencek", icon: "🐻", name: "Állatok", main: true },
  { category: "Kedvencek", icon: "🧸", name: "Barátság", main: true },
  { category: "Kedvencek", icon: "✨", name: "Varázslat", main: true },
  { category: "Kedvencek", icon: "🌲", name: "Természet", main: true },
  { category: "Kedvencek", icon: "🚀", name: "Űr", main: true },
  { category: "Kedvencek", icon: "🏰", name: "Kaland", main: true },
  { category: "Kedvencek", icon: "🌙", name: "Esti, álmos mese", main: true },
  { category: "Kedvencek", icon: "🧠", name: "Tanulás, kíváncsiság", main: true },
  { category: "Kedvencek", icon: "🚗", name: "Járművek", main: true },
  { category: "Kedvencek", icon: "🎁", name: "Meglepetés (random)", main: true },

  // Alap / univerzális
  { category: "Alap / univerzális", icon: "👨‍👩‍👧‍👦", name: "Család" },
  { category: "Alap / univerzális", icon: "🏡", name: "Otthon" },
  { category: "Alap / univerzális", icon: "🌧", name: "Időjárás" },
  { category: "Alap / univerzális", icon: "🌈", name: "Érzelmek" },
  { category: "Alap / univerzális", icon: "🤝", name: "Segítség, kedvesség" },

  // Fantasy / mesevilág
  { category: "Fantasy / mesevilág", icon: "🧙‍♂️", name: "Varázslók" },
  { category: "Fantasy / mesevilág", icon: "🧚‍♀️", name: "Tündérek" },
  { category: "Fantasy / mesevilág", icon: "🐉", name: "Sárkányok" },
  { category: "Fantasy / mesevilág", icon: "🏰", name: "Királyságok" },
  { category: "Fantasy / mesevilág", icon: "🗝", name: "Titkos helyek" },

  // Természet / világ
  { category: "Természet / világ", icon: "🌊", name: "Tenger" },
  { category: "Természet / világ", icon: "🏔", name: "Hegyek" },
  { category: "Természet / világ", icon: "🌳", name: "Erdő" },
  { category: "Természet / világ", icon: "🌸", name: "Virágok" },
  { category: "Természet / világ", icon: "🐾", name: "Vadállatok" },

  // Tudomány / felfedezés
  { category: "Tudomány / felfedezés", icon: "🔬", name: "Tudomány" },
  { category: "Tudomány / felfedezés", icon: "🤖", name: "Robotok" },
  { category: "Tudomány / felfedezés", icon: "⚙️", name: "Feltalálók" },
  { category: "Tudomány / felfedezés", icon: "🧭", name: "Felfedezés" },
  { category: "Tudomány / felfedezés", icon: "🗺", name: "Utazás" },

  // Hétköznapi + játékos
  { category: "Hétköznapi + játékos", icon: "⚽", name: "Sport" },
  { category: "Hétköznapi + játékos", icon: "🎵", name: "Zene" },
  { category: "Hétköznapi + játékos", icon: "🎨", name: "Rajzolás" },
  { category: "Hétköznapi + játékos", icon: "🍎", name: "Ételek" },
  { category: "Hétköznapi + játékos", icon: "🎪", name: "Cirkusz" },

  // Speciális / hangulati
  { category: "Speciális / hangulati", icon: "🌌", name: "Álmodozás" },
  { category: "Speciális / hangulati", icon: "😴", name: "Lefekvés előtti mese" },
  { category: "Speciális / hangulati", icon: "🎄", name: "Ünnepek" },
  { category: "Speciális / hangulati", icon: "🐾", name: "Kisállatok" },
  { category: "Speciális / hangulati", icon: "🌟", name: "Bátorság, önbizalom" },
]

export async function seedThemes() {
  const uniqueCats = Array.from(new Set(SEED.map((s) => s.category)))

  const existing = await db.select().from(themeCategories)
  const catByName = new Map(existing.map((c) => [c.name, c]))

  for (const catName of uniqueCats) {
    if (catByName.has(catName)) continue
    const [created] = await db.insert(themeCategories).values({ name: catName }).returning()
    if (created) catByName.set(created.name, created)
  }

  for (const s of SEED) {
    const cat = catByName.get(s.category)
    if (!cat) continue

    // naive de-dupe by (categoryId,name)
    const exists = await db
      .select({ id: themes.id })
      .from(themes)
      .where(and(eq(themes.categoryId, cat.id), eq(themes.name, s.name)))
      .limit(1)

    if (exists.length) continue

    await db.insert(themes).values({
      categoryId: cat.id,
      name: s.name,
      icon: s.icon,
      main: Boolean(s.main),
    })
  }
}

// Allow running directly: `bun backend/src/scripts/seed-themes.ts`
if (import.meta.main) {
  seedThemes()
    .then(() => {
      console.log("✅ themes seed complete")
      process.exit(0)
    })
    .catch((err) => {
      console.error("❌ themes seed failed", err)
      process.exit(1)
    })
}


