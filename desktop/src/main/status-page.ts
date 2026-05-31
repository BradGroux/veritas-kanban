import type { DesktopStatusSnapshot } from './types.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function statusPage(title: string, message: string, status?: DesktopStatusSnapshot): string {
  const statusJson = status ? escapeHtml(JSON.stringify(status, null, 2)) : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111318;
        color: #eef1f7;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      main {
        width: min(720px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        font-weight: 650;
      }
      p {
        margin: 0;
        color: #b8c0cf;
        line-height: 1.5;
      }
      pre {
        margin-top: 24px;
        max-height: 320px;
        overflow: auto;
        border: 1px solid #2b3242;
        background: #171b24;
        border-radius: 8px;
        padding: 16px;
        color: #d8deea;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      ${statusJson ? `<pre>${statusJson}</pre>` : ''}
    </main>
  </body>
</html>`;
}

export function statusPageUrl(
  title: string,
  message: string,
  status?: DesktopStatusSnapshot
): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(statusPage(title, message, status))}`;
}
