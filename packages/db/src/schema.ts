// packages/db/src/schema.ts
import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  boolean,
  bigint,
  bigserial,
  integer,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'


export const backupStatus = pgEnum('backup_status', ['running', 'success', 'failed'])

export const backups = pgTable('backups', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  filename: text('filename').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  sha256: text('sha256'),
  status: backupStatus('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: text('created_by'),
  notes: text('notes'),
})



export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  profileCompleted: boolean("profile_completed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  lang: text("lang").default("en"),
  isPro: boolean("is_pro").default(false).notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * BarniMeséi domain tables (no migrations here; schema-only per instructions)
 */

export const themeCategories = pgTable("theme_categories", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const themes = pgTable("themes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  categoryId: bigint("category_id", { mode: "number" })
    .notNull()
    .references(() => themeCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon").notNull(), // emoji or icon identifier
  main: boolean("main").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const children = pgTable("children", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  age: integer("age").notNull(),
  learningGoal: text("learning_goal"),
  mood: text("mood"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const childThemes = pgTable("child_themes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  childId: uuid("child_id")
    .notNull()
    .references(() => children.id, { onDelete: "cascade" }),
  themeId: bigint("theme_id", { mode: "number" })
    .notNull()
    .references(() => themes.id, { onDelete: "cascade" }),
  isFavorite: boolean("is_favorite").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storyStatus = pgEnum("story_status", [
  "queued",
  "generating_text",
  "extracting_meta",
  "generating_cover",
  "uploading_cover",
  "ready",
  "failed",
])

export const stories = pgTable("stories", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  childId: uuid("child_id")
    .notNull()
    .references(() => children.id, { onDelete: "cascade" }),
  status: storyStatus("status").notNull().default("queued"),
  title: text("title"),
  summary: text("summary"),
  text: text("text"),
  setting: text("setting"),
  conflict: text("conflict"),
  tone: text("tone"),
  theme: text("theme").notNull(),
  mood: text("mood").notNull(),
  length: text("length").notNull(),
  lesson: text("lesson"),
  previewUrl: text("preview_url"),
  withAudio: boolean("with_audio").default(false),
  creditCost: integer("credit_cost").notNull(),
  errorMessage: text("error_message"),
  audioUrl: text("audio_url"),
  audioStatus: text("audio_status").notNull().default("none"),
  audioError: text("audio_error"),
  audioVoiceId: text("audio_voice_id"),
  audioPreset: text("audio_preset"),
  audioUpdatedAt: timestamp("audio_updated_at", { withTimezone: true }),
  audioHash: text("audio_hash"),
  model: text("model"), // OpenAI model used for generation
  coverUrl: text("cover_url"),
  coverSquareUrl: text("cover_square_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  readyAt: timestamp("ready_at", { withTimezone: true }),
})

export const storyFeedbackType = pgEnum("story_feedback_type", ["like", "sleep", "more"])

export const storyFeedback = pgTable("story_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  childId: uuid("child_id")
    .references(() => children.id, { onDelete: "set null" }),
  type: storyFeedbackType("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueStoryUser: sql`UNIQUE(${table.storyId}, ${table.userId})`,
}))

export const billingAddresses = pgTable("billing_addresses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .unique(),
  name: text("name").notNull(),
  street: text("street").notNull(),
  city: text("city").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull(),
  taxNumber: text("tax_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const storyCreditTransactions = pgTable("story_credit_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  storyId: uuid("story_id").references(() => stories.id, { onDelete: "set null" }),
  type: text("type").notNull().default("manual"), // reserve | refund | manual
  amount: integer("amount").notNull(),
  reason: text("reason"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storyTransactions = pgTable("story_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  operationType: text("operation_type").notNull().default("story_generation"), // "story_generation" | "meta_extraction"
  model: text("model").notNull(), // OpenAI model name (e.g., "gpt-5-mini")
  inputTokens: integer("input_tokens").notNull(), // Input tokens used
  outputTokens: integer("output_tokens").notNull(), // Output tokens used
  totalTokens: integer("total_tokens").notNull(), // Total tokens used
  promptTokens: integer("prompt_tokens"), // Prompt tokens (if available)
  completionTokens: integer("completion_tokens"), // Completion tokens (if available)
  requestId: text("request_id"), // OpenAI request ID (if available)
  responseId: text("response_id"), // OpenAI response ID (if available)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
