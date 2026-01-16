import { SignJWT, importPKCS8 } from "jose";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const MAX_TTL_SECONDS = 60 * 60 * 24 * 180;
const REFRESH_BUFFER_SECONDS = 60 * 60 * 24;

type CachedSecret = {
  token: string;
  exp: number;
};

let cached: CachedSecret | null = null;
let signingKeyPromise: Promise<CryptoKey> | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function normalizePrivateKey(raw: string): string {
  const cleaned = raw.replace(/\\n/g, "\n").trim();
  if (cleaned.includes("BEGIN PRIVATE KEY")) return cleaned;
  const body = cleaned.replace(/-----.*PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

async function getSigningKey(): Promise<CryptoKey> {
  if (!signingKeyPromise) {
    const pkcs8 = normalizePrivateKey(getRequiredEnv("APPLE_P8_KEY"));
    signingKeyPromise = importPKCS8(pkcs8, "ES256");
  }
  return signingKeyPromise;
}

async function generateClientSecret(): Promise<CachedSecret> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + MAX_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: getRequiredEnv("APPLE_KEY_ID"), typ: "JWT" })
    .setIssuer(getRequiredEnv("APPLE_TEAM_ID"))
    .setSubject(getRequiredEnv("APPLE_CLIENT_ID"))
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(await getSigningKey());
  return { token, exp };
}

export async function getAppleClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - REFRESH_BUFFER_SECONDS > now) {
    return cached.token;
  }
  cached = await generateClientSecret();
  return cached.token;
}