import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
/** Supply install metadata for the exported web document. */
export default function Html({ children }: PropsWithChildren) {
 return <html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><meta name="theme-color" content="#f9f5eb"/><meta name="apple-mobile-web-app-capable" content="yes"/><link rel="manifest" href="/manifest.webmanifest"/><link rel="apple-touch-icon" href="/icon-192.png"/><ScrollViewStyleReset/></head><body>{children}</body></html>;
}
