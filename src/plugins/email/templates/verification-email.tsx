import { solvoBrandStyles } from "./brand-shared";

type VerificationType = 'email-verification' | 'password-reset' | 'two-factor' | 'forget-password' | 'sign-in';

interface VerificationEmailProps {
  otp: string
  type: VerificationType
}

const getTitle = (type: VerificationEmailProps['type']) => {
    switch (type) {
      case 'email-verification':
        return 'Email megerősítés'
      case 'password-reset':
      case 'forget-password':
        return 'Jelszó visszaállítás'
      case 'two-factor':
        return 'Kétfaktoros hitelesítés'
      case 'sign-in':
        return 'Bejelentkezés'
      default:
        return 'Megerősítő kód'
    }
  }

const getMessage = (type: VerificationEmailProps['type']) => {
    switch (type) {
      case 'email-verification':
        return 'Köszönjük, hogy regisztráltál a Solvo-ba! Az email címed megerősítéséhez használd az alábbi kódot:'
      case 'password-reset':
      case 'forget-password':
        return 'A jelszó visszaállításához használd az alábbi kódot:'
      case 'two-factor':
        return 'A bejelentkezéshez használd az alábbi kódot:'
      case 'sign-in':
        return 'Az azonosításhoz használd az alábbi kódot:'
      default:
        return 'Használd az alábbi kódot a megerősítéshez:'
    }
  }

export const VerificationEmail = ({ otp, type }: VerificationEmailProps): string => {
  const title = getTitle(type)
  const message = getMessage(type)

  return `<!DOCTYPE html>
<html lang="hu">
  <head>
    <meta charSet="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      ${solvoBrandStyles}
      .code-box {
        padding: 24px 0;
        text-align: center;
        background-color: #fff2e8;
        border-radius: 12px;
        margin: 28px 0;
      }
      .code-box span {
        color: #2d2a32;
        font-size: 32px;
        font-weight: 700;
        letter-spacing: 6px;
        font-family: monospace;
      }
      .subtitle {
        text-align: center;
        color: #6a6772;
        margin-top: 8px;
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="logo"><span>Solvo</span></div>
        <h1>${title}</h1>
        <p class="subtitle">${message}</p>
        <div class="code-box">
          <span>${otp}</span>
        </div>
        <p>Ez a kód 5 percig érvényes. Ha nem te kérted ezt a kódot, hagyd figyelmen kívül ezt az üzenetet.</p>
        <div class="footer">Ez egy automatikus üzenet, kérjük ne válaszolj rá.</div>
      </div>
    </div>
  </body>
</html>`
}

export default VerificationEmail

