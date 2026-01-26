import { auth } from "../lib/auth"; // ugyanaz a better-auth instance
import { db } from "../lib/db";

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error("Usage: bun create-user.ts <email> <password>");
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

  console.log("User created:", user.user.id, user.user.email);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});