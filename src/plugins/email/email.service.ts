import * as nodemailer from "nodemailer";

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
        await this.transporter.sendMail({
            from: process.env.MAIL_FROM || 'noreply@moneyapp.local',
            to,
            subject,
            html,
        })
    }

    static async sendTemplate(to: string, subject: string, html: string) {
        await this.send(to, subject, html);
    }
} 