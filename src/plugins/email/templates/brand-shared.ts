export const solvoBrandStyles = `
  :root {
    --bg: #fff8f2;
    --card: #ffffff;
    --text: #2d2a32;
    --muted: #6a6772;
    --accent: #ff914d;
    --accent-dark: #e6762c;
    --border: #f0e6dc;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif;
    color: var(--text);
  }
  .wrapper {
    width: 100%;
    padding: 32px 0;
    background: var(--bg);
  }
  .card {
    max-width: 640px;
    margin: 0 auto;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px 32px 36px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.04);
  }
  .logo {
    text-align: center;
    margin-bottom: 16px;
  }
  .logo span {
    display: inline-block;
    font-weight: 700;
    font-size: 22px;
    color: var(--accent);
    letter-spacing: 0.3px;
  }
  h1 {
    margin: 0;
    text-align: center;
    font-size: 24px;
    line-height: 32px;
  }
  p {
    font-size: 15px;
    line-height: 24px;
    color: var(--muted);
    margin: 16px 0;
  }
  .card-highlight {
    margin: 24px 0;
    padding: 18px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #fff2e8;
    color: var(--text);
    font-size: 14px;
    line-height: 22px;
  }
  .cta {
    display: block;
    width: 100%;
    text-align: center;
    margin: 24px 0 12px;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    padding: 14px 16px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 16px;
  }
  .cta:hover { background: var(--accent-dark); }
  .link {
    font-size: 13px;
    color: var(--muted);
    word-break: break-all;
  }
  .footer {
    text-align: center;
    margin-top: 28px;
    font-size: 12px;
    color: var(--muted);
  }
  .footer strong { color: var(--text); }
`;


