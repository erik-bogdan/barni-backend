import { solvoBrandStyles } from "./brand-shared";

interface InviteEmailProps {
  registerUrl: string;
  token: string;
  message?: string;
}

export const InviteEmail = ({ registerUrl, token, message }: InviteEmailProps): string => {
  const registerLink = `${registerUrl}/register?token=${token}`;
  const displayMessage = message || "Meghívást kaptál a MoneyApp használatára és fiókod összekötésére.";

  return `<!DOCTYPE html>
<html lang="hu">
  <head>
    <meta charSet="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Meghívó a MoneyApp-hoz</title>
    <style>
      ${solvoBrandStyles}
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="logo"><span>Solvo</span></div>
        <h1>Meghívó a MoneyApp-hoz</h1>
        <p>${displayMessage}</p>
        <a class="cta" href="${registerLink}">Regisztráció és elfogadás</a>
        <div class="card-highlight">
          Ha a gomb nem működne, másold be a böngésződbe:
          <div class="link">${registerLink}</div>
        </div>
        <div class="footer">Ha nem te kértél meghívót, hagyd figyelmen kívül ezt az üzenetet.</div>
      </div>
    </div>
  </body>
</html>`;
};

export default InviteEmail;
