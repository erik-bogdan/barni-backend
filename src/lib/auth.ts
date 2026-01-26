import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { admin, openAPI, emailOTP, haveIBeenPwned, bearer } from "better-auth/plugins"
import * as schema from "./../../packages/db/src/schema"; // Importáld a séma objektumot
import { EmailService } from "../plugins/email/email.service";
import { VerificationEmail } from "../plugins/email/templates/verification-email";
import { ResetPasswordEmail } from "../plugins/email/templates/reset-password-email";
import { expo } from "@better-auth/expo";

export const auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || 'https://solvo.ngrok.app/api/auth',
    trustedOrigins: [
        'http://localhost:3000',
        'http://localhost:4444',
        'http://localhost:3001',
        'https://beta.barnimesei.hu',
        'https://barnimesei.hu',
    ],
    advanced: {
        // state cookie problémákra (SameSite + https ngrok alatt)
        defaultCookieAttributes: {
          sameSite: "none",
          secure: true,
        },
      },
    database: drizzleAdapter(db, {
        schema,
        provider: "pg",
    }),
    emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ user, url, token }, _request) => {
            try {
                const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                const finalResetUrl = `${appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
                const subject = "Jelszó visszaállítás - Solvo";
                const html = ResetPasswordEmail({
                    resetUrl: finalResetUrl,
                    backendUrl: url,
                    userEmail: user.email
                });
                await EmailService.sendTemplate(user.email, subject, html);
                console.log(`✅ Password reset email sent successfully to ${user.email}`);
            } catch (error) {
                console.error('❌ Failed to send password reset email:', error);
                throw error;
            }
        },
        onPasswordReset: async ({ user }, _request) => {
            console.log(`ℹ️ Password for user ${user.email} has been reset.`);
        },
    },
    resetPassword: {
        enabled: true,
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password`,
    },
    plugins: [
        haveIBeenPwned(),
        bearer(),
        admin(),
        openAPI(),
        expo(),
        emailOTP({
            async sendVerificationOTP({ email, otp, type }) {
                try {
                    // Determine email subject based on type
                    let subject: string;
                    switch (type) {
                        case 'email-verification':
                            subject = 'Email megerősítés - Solvo';
                            break;
                        case 'forget-password':
                            subject = 'Jelszó visszaállítás - Solvo';
                            break;
                        case 'sign-in':
                            subject = 'Bejelentkezési kód - Solvo';
                            break;
                        default:
                            subject = 'Megerősítő kód - Solvo';
                    }
                    
                    // Send verification email with template
                    await EmailService.sendTemplate(
                        email,
                        subject,
                        VerificationEmail({ otp, type })
                    );
                    
                    console.log(`✅ OTP email sent successfully to ${email}`);
                } catch (error) {
                    console.error('❌ Failed to send OTP email:', error);
                    throw error;
                }
            },
            overrideDefaultEmailVerification: true,
            otpLength: 6,
            expiresIn: 300, // 5 minutes
        }),
    ],
    databaseHooks: {
        user: {
            create: {
                before: async (user, additionalFields: any) => {
                    // Normalize date-ish values to Date or null on both user and additionalFields
                    const normalizeDate = (value: any) => {
                        if (!value || value === 'N/A') return null;
                        const parsed = new Date(value);
                        return isNaN(parsed.getTime()) ? null : parsed;
                    };

                    if (user && Object.prototype.hasOwnProperty.call(user, 'banExpires')) {
                        (user as any).banExpires = normalizeDate((user as any).banExpires);
                    }

                    if (additionalFields) {
                        if (Object.prototype.hasOwnProperty.call(additionalFields, 'banExpires')) {
                            additionalFields.banExpires = normalizeDate(additionalFields.banExpires);
                        }
                        
                        // Ensure firstName and lastName are set from additionalFields
                        if (additionalFields.firstName !== undefined) {
                            (user as any).firstName = additionalFields.firstName || null;
                        }
                        if (additionalFields.lastName !== undefined) {
                            (user as any).lastName = additionalFields.lastName || null;
                        }
                    }

                    // If firstName/lastName are not set but name contains them, try to parse
                    if (!(user as any).firstName && !(user as any).lastName && user.name) {
                        const nameParts = user.name.trim().split(/\s+/).filter(Boolean);
                        if (nameParts.length >= 2) {
                            (user as any).lastName = nameParts[0] || null;
                            (user as any).firstName = nameParts.slice(1).join(" ") || null;
                        } else if (nameParts.length === 1) {
                            (user as any).firstName = nameParts[0] || null;
                            (user as any).lastName = null;
                        }
                    }

                    if (user.email === user.name) {
                        user.name = "";
                    }
                },
                after: async (user, additionalFields: any) => {
                    // Invitation token processing is now handled separately via API endpoint
                    // after successful registration
                },
            },
            update: {
                before: async (userData: any) => {
                    // Handle firstName and lastName from updateUser call
                    const updateData: any = { ...userData };
                    
                    // If firstName or lastName are provided in the update data, use them
                    if (userData.firstName !== undefined) {
                        updateData.firstName = userData.firstName || null;
                    }
                    if (userData.lastName !== undefined) {
                        updateData.lastName = userData.lastName || null;
                    }
                    
                    // If name is updated and firstName/lastName are provided, update name accordingly
                    if (userData.name !== undefined && (userData.firstName !== undefined || userData.lastName !== undefined)) {
                        const firstName = userData.firstName !== undefined ? (userData.firstName || "") : "";
                        const lastName = userData.lastName !== undefined ? (userData.lastName || "") : "";
                        updateData.name = `${lastName} ${firstName}`.trim() || null;
                    } else if (userData.name !== undefined && userData.firstName === undefined && userData.lastName === undefined) {
                        // If only name is updated, try to parse firstName and lastName from it
                        if (userData.name) {
                            const nameParts = userData.name.trim().split(/\s+/).filter(Boolean);
                            if (nameParts.length >= 2) {
                                updateData.lastName = nameParts[0] || null;
                                updateData.firstName = nameParts.slice(1).join(" ") || null;
                            } else if (nameParts.length === 1) {
                                updateData.firstName = nameParts[0] || null;
                                updateData.lastName = null;
                            }
                        }
                    }
                    
                    return { data: updateData };
                },
            },
        },
    },
    user: {
        additionalFields: {
            role: {
                type: "string",
                required: false,
                defaultValue: "user",
                input: false, // don't allow user to set role
            },
            lang: {
                type: "string",
                required: false,
                defaultValue: "en",
            },
            firstName: {
                type: "string",
                required: false,
                defaultValue: "",
                input: true,
            },
            lastName: {
                type: "string",
                required: false,
                defaultValue: "",
                input: true,
            },
            profileCompleted: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: true,
            },
        },
    },
});