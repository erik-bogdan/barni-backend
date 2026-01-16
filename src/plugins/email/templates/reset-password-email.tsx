import { solvoBrandStyles } from "./brand-shared";

interface ResetPasswordEmailProps {
  resetUrl: string;
  backendUrl?: string;
  userEmail: string;
}

export const ResetPasswordEmail = ({ resetUrl, backendUrl, userEmail }: ResetPasswordEmailProps): string => {
  return `<!DOCTYPE html>
<html lang="hu">
  <head>
    <meta charSet="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jelszó visszaállítás</title>
    <style>
      ${solvoBrandStyles}
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="logo">
          <span>Solvo</span>
        </div>
        <h1>Állítsd vissza a jelszavad</h1>
        <p>Szia${userEmail ? `, ${userEmail}` : ""}!</p>
        <p>Kértél egy jelszó-visszaállítást. A folyamat befejezéséhez kattints az alábbi gombra. A link biztonsági okokból rövid ideig érvényes.</p>
        <a class="cta" href="${resetUrl}" target="_blank" rel="noopener noreferrer">Jelszó visszaállítása</a>
        <div class="card-highlight">
          Ha a fenti gomb nem működne, másold be a böngésződbe ezt a linket:
          <div class="link">${resetUrl}</div>
        </div>
        <p>Ha nem te kérted a visszaállítást, hagyd figyelmen kívül ezt az emailt. A fiókod biztonsága érdekében kérdés esetén keresd fel az ügyfélszolgálatot.</p>
        <div class="footer">
          <strong>Solvo</strong><br />
          Pénzügyeid, egyszerűbben.
        </div>
      </div>
    </div>
  </body>
</html>`;
};

export default ResetPasswordEmail;

