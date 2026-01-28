import * as nodemailer from "nodemailer";
import { getLogger } from "../../lib/logger";

export class EmailService {
    
    private static transporter = nodemailer.createTransport({
        host: process.env.MAILTRAP_HOST || '127.0.0.1',
        port: parseInt(process.env.MAILTRAP_PORT || '1025'),
        // Mailpit doesn't require authentication
        auth: process.env.MAILTRAP_USER && process.env.MAILTRAP_PASS ? { 
            user: process.env.MAILTRAP_USER, 
            pass: process.env.MAILTRAP_PASS 
        } : undefined,
    });

    static async send(to: string, subject: string, html: string) {
        try {
            getLogger().info(
                {
                    to,
                    subject,
                    host: process.env.MAILTRAP_HOST || '127.0.0.1',
                    port: process.env.MAILTRAP_PORT || '1025',
                    from: process.env.MAIL_FROM || 'noreply@moneyapp.local',
                },
                "email.send",
            )
            
            const result = await this.transporter.sendMail({
                from: process.env.MAIL_FROM || 'noreply@moneyapp.local',
                to,
                subject,
                html,
            })
            
            getLogger().info({ messageId: result.messageId }, "email.sent")
            return result
        } catch (error: any) {
            getLogger().error(
                {
                    err: error,
                    message: error?.message,
                    code: error?.code,
                },
                "email.send_failed",
            )
            throw error
        }
    }

    static async sendTemplate(to: string, subject: string, html: string) {
        await this.send(to, subject, html);
    }
} 