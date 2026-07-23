/**
 * Ambient types for build artifacts the gate harness inlines. `guest-sources.js`
 * is emitted by build.mjs (the bundled spike programs + their raw author
 * sources) before main.ts is bundled.
 */
declare module '*/guest-sources.js' {
  type Spike = 'nerode' | 'ftc' | 'determinant';
  export const GUEST_SOURCES: Record<Spike, string>;
  export const AUTHOR_SOURCES: Record<Spike, string>;
}
