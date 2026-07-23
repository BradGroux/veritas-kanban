import { createHash } from 'crypto';
import type { DesktopStatusSnapshot } from './types.js';

const STATUS_PAGE_CSS = `
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
        -webkit-app-region: drag;
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
        -webkit-app-region: no-drag;
      }
    `;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function styleHash(style: string): string {
  return `'sha256-${createHash('sha256').update(style).digest('base64')}'`;
}

export function statusPage(title: string, message: string, status?: DesktopStatusSnapshot): string {
  const statusJson = status ? escapeHtml(JSON.stringify(status, null, 2)) : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${styleHash(STATUS_PAGE_CSS)}; img-src data:; script-src 'none';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${STATUS_PAGE_CSS}</style>
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
