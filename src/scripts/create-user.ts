import { auth } from "../lib/auth"; // ugyanaz a better-auth instance
import { db } from "../lib/db";
import { createLogger, setLogger } from "../lib/logger";

const logger = createLogger("backend");
setLogger(logger);

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    logger.error("Usage: bun create-user.ts <email> <password>");
    process.exit(1);
  }

  const user = await auth.api.createUser({
    body: {
        email,
        password,
        name: "Admin",
        role: "admin",
        data: {
            firstName: "Admin",
            lastName: "Admin",
            emailVerified: true,
            profileCompleted: true,
        },
    },
  });

  logger.info({ userId: user.user.id, email: user.user.email }, "user.created");
  process.exit(0);
}

main().catch(err => {
  logger.error({ err }, "user.create_failed");
  process.exit(1);
});