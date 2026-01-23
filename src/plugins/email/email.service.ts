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
        try {
            console.log("[EmailService] Sending email to:", to)
            console.log("[EmailService] Subject:", subject)
            console.log("[EmailService] Host:", process.env.MAILTRAP_HOST || '127.0.0.1')
            console.log("[EmailService] Port:", process.env.MAILTRAP_PORT || '1025')
            console.log("[EmailService] From:", process.env.MAIL_FROM || 'noreply@moneyapp.local')
            
            const result = await this.transporter.sendMail({
                from: process.env.MAIL_FROM || 'noreply@moneyapp.local',
                to,
                subject,
                html,
            })
            
            console.log("[EmailService] Email sent successfully:", result.messageId)
            return result
        } catch (error: any) {
            console.error("[EmailService] Error sending email:", error)
            console.error("[EmailService] Error message:", error?.message)
            console.error("[EmailService] Error code:", error?.code)
            throw error
        }
    }

    static async sendTemplate(to: string, subject: string, html: string) {
        await this.send(to, subject, html);
    }
} 