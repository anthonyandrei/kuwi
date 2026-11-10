import {
  ScrollViewStyleReset,
  useServerDocumentContext,
} from "expo-router/html";
import type { PropsWithChildren } from "react";
/** Render the exported web document with install metadata and system appearance tokens.
 * @param children - Expo Router's rendered application tree.
 * @returns The document shell with viewport, install, theme, and focus styles.
 */
export default function Html({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } =
    useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#f9f5eb" />
        <meta name="theme-color" content="#111a14" media="(prefers-color-scheme: dark)" />
        <style>{`
          :root {
            color-scheme: light dark;
            --kuwi-page: #f9f5eb;
            --kuwi-ink: #293c32;
            --kuwi-accent-button: #486b51;
            --kuwi-accent-text: #486b51;
            --kuwi-secondary-text: #526355;
            --kuwi-border: #83927e;
            --kuwi-surface: #fffdf7;
            --kuwi-selected: #e2e9d9;
            --kuwi-divider: #d4ddcf;
            --kuwi-soft: #eef1e7;
            --kuwi-error-bg: #fae7de;
            --kuwi-error-fg: #752e1a;
            --kuwi-warning-bg: #f4e5c6;
            --kuwi-warning-fg: #4a321b;
            --kuwi-success-fg: #263e2c;
            --kuwi-danger-border: #d7a08c;
            --kuwi-danger-surface: #fff8f2;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --kuwi-page: #111a14;
              --kuwi-ink: #eef4ed;
              --kuwi-accent-button: #355f43;
              --kuwi-accent-text: #b5d9bb;
              --kuwi-secondary-text: #bdc9be;
              --kuwi-border: #708775;
              --kuwi-surface: #1c2920;
              --kuwi-selected: #33483a;
              --kuwi-divider: #3c4b40;
              --kuwi-soft: #27362b;
              --kuwi-error-bg: #4d2b28;
              --kuwi-error-fg: #ffd2ca;
              --kuwi-warning-bg: #493a21;
              --kuwi-warning-fg: #f6dda3;
              --kuwi-success-fg: #c7e5cc;
              --kuwi-danger-border: #9a655d;
              --kuwi-danger-surface: #322420;
            }
          }
          html, body, #root { min-height: 100%; background: var(--kuwi-page); color: var(--kuwi-ink); }
          body { margin: 0; }
          :focus-visible { outline: 3px solid #a3512d; outline-offset: 3px; }
          @media (prefers-color-scheme: dark) { :focus-visible { outline-color: #f0b58c; } }
          [aria-invalid="true"] { border-color: var(--kuwi-error-fg) !important; }
          [role="button"], [role="radio"], [role="checkbox"] {
            cursor: pointer;
            transition: filter 120ms ease, transform 120ms ease;
          }
          [role="button"]:hover:not([disabled]):not([aria-disabled="true"]),
          [role="radio"]:hover:not([disabled]):not([aria-disabled="true"]),
          [role="checkbox"]:hover:not([disabled]):not([aria-disabled="true"]) {
            filter: brightness(0.94);
          }
          [role="button"]:active:not([disabled]):not([aria-disabled="true"]),
          [role="radio"]:active:not([disabled]):not([aria-disabled="true"]),
          [role="checkbox"]:active:not([disabled]):not([aria-disabled="true"]) {
            transform: translateY(1px);
          }
          [role="button"][disabled], [role="button"][aria-disabled="true"] { cursor: not-allowed; }
          @media (prefers-reduced-motion: reduce) {
            [role="button"], [role="radio"], [role="checkbox"] { transition: none; }
          }
        `}</style>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
