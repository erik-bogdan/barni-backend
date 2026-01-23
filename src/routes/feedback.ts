import { Elysia, t } from "elysia";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../lib/db";
import { auth } from "../lib/auth";
import { feedbacks, feedbackReplies, user } from "../../packages/db/src/schema";

async function requireSession(headers: Headers, set: { status: number }) {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    set.status = 401;
    return null;
  }
  return session;
}

export const feedbackApi = new Elysia({ name: "feedback", prefix: "/feedback" })
  // GET /feedback - Get user's feedbacks
  .get("/", async ({ request, set }) => {
    const session = await requireSession(request.headers, set);
    if (!session) return { error: "Unauthorized" };

    const userFeedbacks = await db
      .select({
        id: feedbacks.id,
        title: feedbacks.title,
        content: feedbacks.content,
        status: feedbacks.status,
        createdAt: feedbacks.createdAt,
        updatedAt: feedbacks.updatedAt,
        closedAt: feedbacks.closedAt,
      })
      .from(feedbacks)
      .where(eq(feedbacks.userId, session.user.id))
      .orderBy(desc(feedbacks.createdAt));

    return { feedbacks: userFeedbacks };
  })

  // GET /feedback/:id - Get single feedback with replies
  .get(
    "/:id",
    async ({ request, params, set }) => {
      const session = await requireSession(request.headers, set);
      if (!session) return { error: "Unauthorized" };

      const [feedback] = await db
        .select()
        .from(feedbacks)
        .where(and(eq(feedbacks.id, params.id), eq(feedbacks.userId, session.user.id)))
        .limit(1);

      if (!feedback) {
        set.status = 404;
        return { error: "Feedback not found" };
      }

      // Mark as viewed when user opens the feedback
      await db
        .update(feedbacks)
        .set({
          lastViewedAt: new Date(),
        })
        .where(eq(feedbacks.id, params.id));

      const replies = await db
        .select({
          id: feedbackReplies.id,
          content: feedbackReplies.content,
          isAdmin: feedbackReplies.isAdmin,
          createdAt: feedbackReplies.createdAt,
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
          },
        })
        .from(feedbackReplies)
        .innerJoin(user, eq(feedbackReplies.userId, user.id))
        .where(eq(feedbackReplies.feedbackId, params.id))
        .orderBy(feedbackReplies.createdAt);

      // Get updated feedback with lastViewedAt
      const [updatedFeedback] = await db
        .select()
        .from(feedbacks)
        .where(eq(feedbacks.id, params.id))
        .limit(1);

      return {
        feedback: updatedFeedback || feedback,
        replies,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /feedback/unread-count - Get count of unread messages
  .get("/unread-count", async ({ request, set }) => {
    const session = await requireSession(request.headers, set);
    if (!session) return { error: "Unauthorized" };

    // Get all user feedbacks with admin replies
    const userFeedbacks = await db
      .select({
        id: feedbacks.id,
        lastViewedAt: feedbacks.lastViewedAt,
      })
      .from(feedbacks)
      .where(eq(feedbacks.userId, session.user.id));

    let unreadCount = 0;

    for (const feedback of userFeedbacks) {
      // Get the latest admin reply
      const [latestAdminReply] = await db
        .select()
        .from(feedbackReplies)
        .where(
          and(
            eq(feedbackReplies.feedbackId, feedback.id),
            eq(feedbackReplies.isAdmin, true)
          )
        )
        .orderBy(desc(feedbackReplies.createdAt))
        .limit(1);

      if (latestAdminReply) {
        // If user hasn't viewed this feedback yet, or the latest admin reply is newer than lastViewedAt
        if (
          !feedback.lastViewedAt ||
          new Date(latestAdminReply.createdAt) > new Date(feedback.lastViewedAt)
        ) {
          unreadCount++;
        }
      }
    }

    return { count: unreadCount };
  })

  // POST /feedback - Create new feedback
  .post(
    "/",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set);
      if (!session) return { error: "Unauthorized" };

      const { title, content } = body;

      const [feedback] = await db
        .insert(feedbacks)
        .values({
          userId: session.user.id,
          title,
          content,
          status: "submitted",
        })
        .returning();

      return { feedback };
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        content: t.String({ minLength: 1, maxLength: 5000 }),
      }),
    }
  )

  // POST /feedback/:id/reply - Add reply to feedback
  .post(
    "/:id/reply",
    async ({ request, params, body, set }) => {
      const session = await requireSession(request.headers, set);
      if (!session) return { error: "Unauthorized" };

      const { content } = body;

      // Check if feedback exists and belongs to user
      const [feedback] = await db
        .select()
        .from(feedbacks)
        .where(and(eq(feedbacks.id, params.id), eq(feedbacks.userId, session.user.id)))
        .limit(1);

      if (!feedback) {
        set.status = 404;
        return { error: "Feedback not found" };
      }

      // Check if feedback is closed
      if (feedback.status === "closed") {
        set.status = 400;
        return { error: "Cannot reply to closed feedback" };
      }

      // Add reply
      const [reply] = await db
        .insert(feedbackReplies)
        .values({
          feedbackId: params.id,
          userId: session.user.id,
          content,
          isAdmin: false,
        })
        .returning();

      // Update feedback status to "awaiting_response" if it was "responded"
      if (feedback.status === "responded") {
        await db
          .update(feedbacks)
          .set({
            status: "awaiting_response",
            updatedAt: new Date(),
          })
          .where(eq(feedbacks.id, params.id));
      }

      return { reply };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        content: t.String({ minLength: 1, maxLength: 5000 }),
      }),
    }
  );
