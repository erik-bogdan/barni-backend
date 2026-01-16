import { Elysia, t } from "elysia"
import { and, eq, inArray, sql } from "drizzle-orm"

import { db } from "../lib/db"
import { auth } from "../lib/auth"
import {
  billingAddresses,
  childThemes,
  children,
  storyCreditTransactions,
  themeCategories,
  themes,
  user,
} from "../../packages/db/src/schema"

async function requireSession(headers: Headers, set: { status: number }) {
  const session = await auth.api.getSession({ headers })
  if (!session) {
    set.status = 401
    return null
  }
  return session
}

export const portal = new Elysia({ name: "portal", prefix: "/portal" })
  .get("/themes", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const cats = await db.select().from(themeCategories).orderBy(themeCategories.id)
    const allThemes = await db.select().from(themes).orderBy(themes.id)

    const byCat = new Map<number, typeof allThemes>()
    for (const th of allThemes) {
      const arr = byCat.get(th.categoryId) ?? []
      arr.push(th)
      byCat.set(th.categoryId, arr)
    }

    return {
      categories: cats.map((c) => ({
        id: c.id,
        name: c.name,
        themes: (byCat.get(c.id) ?? []).map((th) => ({
          id: th.id,
          name: th.name,
          icon: th.icon,
          main: th.main,
          categoryId: th.categoryId,
        })),
      })),
    }
  })
  .get("/children", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const rows = await db
      .select()
      .from(children)
      .where(eq(children.userId, session.user.id))
      .orderBy(children.createdAt)

    return {
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        age: c.age,
        learningGoal: c.learningGoal ?? null,
        mood: c.mood ?? null,
        createdAt: c.createdAt,
      })),
    }
  })
  .post(
    "/children",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const userId = session.user.id

      const [created] = await db
        .insert(children)
        .values({
          userId,
          name: body.name.trim(),
          age: body.age,
          learningGoal: body.learningGoal?.trim() || null,
          mood: body.mood?.trim() || null,
        })
        .returning()

      if (!created) {
        set.status = 500
        return { error: "Failed to create child" }
      }

      const themeIds = Array.from(
        new Set([
          body.favoriteThemeId,
          ...(body.themeIds ?? []),
        ].filter((x): x is number => typeof x === "number")),
      )

      if (themeIds.length > 0) {
        // Ensure themes exist (best-effort)
        const existingThemes = await db
          .select({ id: themes.id })
          .from(themes)
          .where(inArray(themes.id, themeIds))

        const existingThemeIds = new Set(existingThemes.map((t) => t.id))
        const finalThemeIds = themeIds.filter((id) => existingThemeIds.has(id))

        if (finalThemeIds.length > 0) {
          await db.insert(childThemes).values(
            finalThemeIds.map((themeId) => ({
              childId: created.id,
              themeId,
              isFavorite: themeId === body.favoriteThemeId,
            })),
          )
        }
      }

      return {
        id: created.id,
        name: created.name,
        age: created.age,
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        age: t.Number({ minimum: 0, maximum: 25 }),
        favoriteThemeId: t.Number(),
        themeIds: t.Optional(t.Array(t.Number())),
        learningGoal: t.Optional(t.String()),
        mood: t.Optional(t.String()),
      }),
    },
  )
  .get("/credits", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const [row] = await db
      .select({
        balance: sql<number>`coalesce(sum(${storyCreditTransactions.amount}), 0)`,
      })
      .from(storyCreditTransactions)
      .where(eq(storyCreditTransactions.userId, session.user.id))

    return { balance: row?.balance ?? 0 }
  })
  .get("/children/:childId", async ({ request, params, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const [child] = await db
      .select()
      .from(children)
      .where(and(eq(children.id, params.childId), eq(children.userId, session.user.id)))
      .limit(1)

    if (!child) {
      set.status = 404
      return { error: "Child not found" }
    }

    const childThemeRows = await db
      .select({
        themeId: childThemes.themeId,
        isFavorite: childThemes.isFavorite,
      })
      .from(childThemes)
      .where(eq(childThemes.childId, child.id))

    const favoriteTheme = childThemeRows.find((ct) => ct.isFavorite)
    const allThemeIds = childThemeRows.map((ct) => Number(ct.themeId))

    return {
      id: child.id,
      name: child.name,
      age: child.age,
      learningGoal: child.learningGoal ?? null,
      mood: child.mood ?? null,
      favoriteThemeId: favoriteTheme ? Number(favoriteTheme.themeId) : null,
      themeIds: allThemeIds,
    }
  })
  .put(
    "/children/:childId",
    async ({ request, params, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [existing] = await db
        .select()
        .from(children)
        .where(and(eq(children.id, params.childId), eq(children.userId, session.user.id)))
        .limit(1)

      if (!existing) {
        set.status = 404
        return { error: "Child not found" }
      }

      const [updated] = await db
        .update(children)
        .set({
          name: body.name?.trim() ?? existing.name,
          age: body.age ?? existing.age,
          learningGoal: body.learningGoal?.trim() || null,
          mood: body.mood?.trim() || null,
        })
        .where(eq(children.id, params.childId))
        .returning()

      if (!updated) {
        set.status = 500
        return { error: "Failed to update child" }
      }

      // Update themes if provided
      if (body.favoriteThemeId !== undefined || body.themeIds !== undefined) {
        // Delete existing child themes
        await db.delete(childThemes).where(eq(childThemes.childId, params.childId))

        const themeIds = Array.from(
          new Set([
            body.favoriteThemeId ?? null,
            ...(body.themeIds ?? []),
          ].filter((x): x is number => typeof x === "number")),
        )

        if (themeIds.length > 0) {
          // Ensure themes exist
          const existingThemes = await db
            .select({ id: themes.id })
            .from(themes)
            .where(inArray(themes.id, themeIds))

          const existingThemeIds = new Set(existingThemes.map((t) => t.id))
          const finalThemeIds = themeIds.filter((id) => existingThemeIds.has(id))

          if (finalThemeIds.length > 0) {
            await db.insert(childThemes).values(
              finalThemeIds.map((themeId) => ({
                childId: updated.id,
                themeId,
                isFavorite: themeId === (body.favoriteThemeId ?? null),
              })),
            )
          }
        }
      }

      return {
        id: updated.id,
        name: updated.name,
        age: updated.age,
      }
    },
    {
      params: t.Object({
        childId: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        age: t.Optional(t.Number({ minimum: 0, maximum: 25 })),
        favoriteThemeId: t.Optional(t.Number()),
        themeIds: t.Optional(t.Array(t.Number())),
        learningGoal: t.Optional(t.String()),
        mood: t.Optional(t.String()),
      }),
    },
  )
  .get("/profile", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const [userRow] = await db
      .select({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (!userRow) {
      set.status = 404
      return { error: "User not found" }
    }

    const [billing] = await db
      .select()
      .from(billingAddresses)
      .where(eq(billingAddresses.userId, session.user.id))
      .limit(1)

    return {
      firstName: userRow.firstName ?? null,
      lastName: userRow.lastName ?? null,
      email: userRow.email,
      billingAddress: billing
        ? {
            name: billing.name,
            street: billing.street,
            city: billing.city,
            postalCode: billing.postalCode,
            country: billing.country,
            taxNumber: billing.taxNumber ?? null,
          }
        : null,
    }
  })
  .put(
    "/profile",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [existing] = await db
        .select()
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)

      if (!existing) {
        set.status = 404
        return { error: "User not found" }
      }

      const updateData: { firstName?: string; lastName?: string; name?: string } = {}
      if (body.firstName !== undefined) {
        updateData.firstName = body.firstName.trim() || null
      }
      if (body.lastName !== undefined) {
        updateData.lastName = body.lastName.trim() || null
      }
      if (body.firstName !== undefined || body.lastName !== undefined) {
        const firstName = body.firstName?.trim() || existing.firstName || ""
        const lastName = body.lastName?.trim() || existing.lastName || ""
        updateData.name = `${lastName} ${firstName}`.trim() || null
      }

      if (Object.keys(updateData).length === 0) {
        return { success: true }
      }

      await db.update(user).set(updateData).where(eq(user.id, session.user.id))

      return { success: true }
    },
    {
      body: t.Object({
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/billing-address",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [existing] = await db
        .select()
        .from(billingAddresses)
        .where(eq(billingAddresses.userId, session.user.id))
        .limit(1)

      if (existing) {
        await db
          .update(billingAddresses)
          .set({
            name: body.name.trim(),
            street: body.street.trim(),
            city: body.city.trim(),
            postalCode: body.postalCode.trim(),
            country: body.country.trim(),
            taxNumber: body.taxNumber?.trim() || null,
          })
          .where(eq(billingAddresses.userId, session.user.id))
      } else {
        await db.insert(billingAddresses).values({
          userId: session.user.id,
          name: body.name.trim(),
          street: body.street.trim(),
          city: body.city.trim(),
          postalCode: body.postalCode.trim(),
          country: body.country.trim(),
          taxNumber: body.taxNumber?.trim() || null,
        })
      }

      return { success: true }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        street: t.String({ minLength: 1 }),
        city: t.String({ minLength: 1 }),
        postalCode: t.String({ minLength: 1 }),
        country: t.String({ minLength: 1 }),
        taxNumber: t.Optional(t.String()),
      }),
    },
  )


