import React from "react"
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Img,
  Hr,
} from "@react-email/components"
import { render } from "@react-email/render"

interface BarniMeseiInvitationEmailProps {
  inviterName: string
  registerUrl: string
  isApprovalEmail?: boolean // If true, shows "Barni jóváhagyta" message
}

export const BarniMeseiInvitationEmail = ({
  inviterName,
  registerUrl,
  isApprovalEmail = false,
}: BarniMeseiInvitationEmailProps) => {
  return (
    <Html lang="hu">
      <Head />
      <Body style={main}>
        <Container style={container}>
          {/* Header with gradient background */}
          <Section style={headerSection}>
            <Img
              src="https://barnimesei.hu/images/barni.png"
              alt="Barni"
              width="120"
              height="70"
              style={logo}
            />
            <Text style={brandText}>Barni Meséi</Text>
            <Text style={tagline}>Esti mesék újragondolva</Text>
          </Section>

          {/* Main content */}
          <Section style={contentSection}>
            <Text style={heading}>
              {isApprovalEmail ? "Barni jóváhagyta a regisztrációs kérelmed! 🎉" : "Meghívó a BarniMeséi-hoz! 🎉"}
            </Text>
            
            {isApprovalEmail ? (
              <Text style={paragraph}>
                <strong>Barni</strong> jóváhagyta a regisztrációs kérelmed! Most már regisztrálhatsz a BarniMeséinek használatára.
              </Text>
            ) : (
              <Text style={paragraph}>
                <strong>{inviterName}</strong> meghívott téged, hogy csatlakozz a BarniMeséi közösségéhez!
              </Text>
            )}

            <Text style={paragraph}>
              A BarniMeséi egy személyre szabott mesealkotó platform, ahol gyermeked számára egyedi, 
              izgalmas történeteket készíthetsz. Válassz hangulatot, témát és hosszt, és Barni elkészíti 
              a tökéletes mesét!
            </Text>

            {/* CTA Button */}
            <Section style={buttonContainer}>
              <Button style={button} href={registerUrl}>
                Regisztráció és elfogadás
              </Button>
            </Section>

            {/* Link fallback */}
            <Section style={linkSection}>
              <Text style={linkText}>
                Ha a gomb nem működne, másold be ezt a linket a böngésződbe:
              </Text>
              <Text style={linkUrl}>{registerUrl}</Text>
            </Section>

            <Hr style={divider} />

            <Text style={footerText}>
              Ez a meghívó <strong>30 napig érvényes</strong>. Ha nem te kérted ezt a meghívót, 
              hagyd figyelmen kívül ezt az üzenetet.
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerNote}>
              Ez egy automatikus üzenet, kérjük ne válaszolj rá.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// Styles matching BarniMeséi design
const main = {
  backgroundColor: "#000b44",
  fontFamily: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: "20px 0",
}

const container = {
  backgroundColor: "#ffffff",
  borderRadius: "16px",
  maxWidth: "600px",
  margin: "0 auto",
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
}

const headerSection = {
  background: "linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)",
  padding: "40px 32px",
  textAlign: "center" as const,
}

const logo = {
  margin: "0 auto 20px",
  display: "block",
}

const brandText = {
  fontSize: "28px",
  fontWeight: "700",
  color: "#ffffff",
  margin: "0 0 4px 0",
  fontFamily: '"Bangers", system-ui, sans-serif',
  letterSpacing: "0.5px",
}

const tagline = {
  fontSize: "12px",
  color: "rgba(255, 255, 255, 0.9)",
  margin: "0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
}

const contentSection = {
  padding: "40px 32px",
  backgroundColor: "#ffffff",
}

const heading = {
  fontSize: "24px",
  fontWeight: "700",
  color: "#000b44",
  margin: "0 0 24px 0",
  textAlign: "center" as const,
  fontFamily: '"Bangers", system-ui, sans-serif',
}

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  color: "#333333",
  margin: "0 0 20px 0",
}

const buttonContainer = {
  margin: "32px 0",
  textAlign: "center" as const,
}

const button = {
  backgroundColor: "#d76d77",
  backgroundImage: "linear-gradient(135deg, #d76d77 0%, #d76d77 50%, #ffaf7b 100%)",
  borderRadius: "999px",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
  boxShadow: "0 4px 12px rgba(215, 109, 119, 0.3)",
}

const linkSection = {
  margin: "24px 0",
  padding: "20px",
  backgroundColor: "#fff8f2",
  borderRadius: "12px",
  border: "1px solid #f0e6dc",
}

const linkText = {
  fontSize: "14px",
  color: "#6a6772",
  margin: "0 0 8px 0",
}

const linkUrl = {
  fontSize: "13px",
  color: "#d76d77",
  wordBreak: "break-all" as const,
  margin: "0",
  fontFamily: "monospace",
}

const divider = {
  borderColor: "#e5e5e5",
  margin: "32px 0",
}

const footerText = {
  fontSize: "14px",
  lineHeight: "20px",
  color: "#6a6772",
  margin: "0",
  textAlign: "center" as const,
}

const footerSection = {
  padding: "24px 32px",
  backgroundColor: "#f9f9f9",
  borderTop: "1px solid #e5e5e5",
}

const footerNote = {
  fontSize: "12px",
  color: "#999999",
  margin: "0",
  textAlign: "center" as const,
}

// Export render function
export const renderBarniMeseiInvitationEmail = async (
  props: BarniMeseiInvitationEmailProps
): Promise<string> => {
  return await render(<BarniMeseiInvitationEmail {...props} />)
}

export default BarniMeseiInvitationEmail
