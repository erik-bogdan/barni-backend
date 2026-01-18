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
  jsonb,
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
  audioCharacterCount: integer("audio_character_count"), // Character count for audio generation (1 char = 1 credit)
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
  // orderId foreign key will be added in migration (orders table defined later)
  orderId: uuid("order_id"),
  type: text("type").notNull().default("manual"), // reserve | refund | manual | purchase | bonus | adjustment | spend
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

/**
 * Stripe payment integration tables
 */

// Stripe customers mapping
export const stripeCustomers = pgTable("stripe_customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .unique(),
  customerId: text("customer_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Coupons for discounts
export const couponType = pgEnum("coupon_type", ["percent", "amount"]);

// Pricing plans for credit bundles
export const pricingPlans = pgTable("pricing_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  credits: integer("credits").notNull(),
  currency: text("currency").notNull().default("HUF"),
  priceCents: integer("price_cents").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  promoEnabled: boolean("promo_enabled").notNull().default(false),
  promoType: couponType("promo_type"), // "percent" | "amount" | null
  promoValue: integer("promo_value"), // percent 1..100 OR amount in minor units
  promoPriceCents: integer("promo_price_cents"), // Deprecated: kept for backward compatibility
  promoStartsAt: timestamp("promo_starts_at", { withTimezone: true }),
  promoEndsAt: timestamp("promo_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const coupons = pgTable("coupons", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  type: couponType("type").notNull(),
  value: integer("value").notNull(), // percent 1..100 OR amount in minor units
  currency: text("currency"), // required for amount type
  maxRedemptions: integer("max_redemptions"),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  perUserLimit: integer("per_user_limit").default(1),
  minOrderAmountCents: integer("min_order_amount_cents"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Order status enum
export const orderStatus = pgEnum("order_status", [
  "created",
  "pending_payment",
  "paid",
  "canceled",
  "failed",
  "refunded",
]);

// Orders
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  status: orderStatus("status").notNull().default("created"),
  currency: text("currency").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
  couponCodeSnapshot: text("coupon_code_snapshot"),
  couponTypeSnapshot: text("coupon_type_snapshot"),
  couponValueSnapshot: integer("coupon_value_snapshot"),
  creditsTotal: integer("credits_total").notNull(),
  provider: text("provider").notNull().default("stripe"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCustomerId: text("stripe_customer_id"),
  billingoInvoiceId: integer("billingo_invoice_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Order items
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  pricingPlanId: uuid("pricing_plan_id")
    .notNull()
    .references(() => pricingPlans.id, { onDelete: "restrict" }),
  planCodeSnapshot: text("plan_code_snapshot").notNull(),
  planNameSnapshot: text("plan_name_snapshot").notNull(),
  unitPriceCentsSnapshot: integer("unit_price_cents_snapshot").notNull(),
  quantity: integer("quantity").notNull(),
  creditsPerUnitSnapshot: integer("credits_per_unit_snapshot").notNull(),
  lineSubtotalCents: integer("line_subtotal_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Payment attempts
export const paymentStatus = pgEnum("payment_status", [
  "created",
  "requires_action",
  "succeeded",
  "failed",
  "refunded",
]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("stripe"),
  status: paymentStatus("status").notNull().default("created"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeChargeId: text("stripe_charge_id"),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Stripe events (raw webhook logs)
export const stripeEvents = pgTable("stripe_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  type: text("type").notNull(),
  apiVersion: text("api_version"),
  created: timestamp("created", { withTimezone: true }).notNull(),
  livemode: boolean("livemode").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
