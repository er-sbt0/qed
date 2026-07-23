import type { NextConfig } from 'next';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Marks every emitted chunk that contains a module matching `match` as already
 * minimized, which makes Next's minify plugin skip it. See the call site for
 * why one chunk has to opt out.
 */
class SkipMinifyPlugin {
  constructor(
    private readonly webpack: any,
    private readonly match: RegExp,
  ) {}

  apply(compiler: any) {
    const { Compilation } = this.webpack;
    compiler.hooks.thisCompilation.tap('SkipMinifyPlugin', (compilation: any) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'SkipMinifyPlugin',
          // One stage ahead of the minifier, which taps OPTIMIZE_SIZE.
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1,
        },
        () => {
          for (const chunk of compilation.chunks) {
            const modules = compilation.chunkGraph.getChunkModulesIterable(chunk);
            let hit = false;
            for (const mod of modules) {
              if (this.match.test(mod.nameForCondition?.() ?? '')) {
                hit = true;
                break;
              }
            }
            if (!hit) continue;
            for (const file of chunk.files) {
              compilation.updateAsset(file, (source: any) => source, { minimized: true });
            }
          }
        },
      );
    });
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-tools badge defaults to bottom-left, exactly where the sidebar's
  // theme toggle lives. Dev-only; production never renders it.
  devIndicators: {
    position: 'bottom-right',
  },
  // The workspace packages ship TypeScript source, so Next must transpile them.
  transpilePackages: [
    '@math-ai/core',
    '@math-ai/lesson',
    '@math-ai/render',
    '@math-ai/library',
    '@math-ai/host',
    '@math-ai/planner',
  ],
  webpack: (config, { isServer, webpack }) => {
    // The packages use `.js` import specifiers that resolve to `.ts`/`.tsx`
    // sources (moduleResolution: Bundler). Teach webpack the same mapping.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    // esbuild — the planner's type-stripper — spawns a native binary and
    // `require`s paths dynamically. Bundling it makes webpack enumerate its lib
    // directory, which then tries to parse `main.d.ts` as JavaScript. It must
    // stay a real Node import. (`serverExternalPackages` does not reach it:
    // esbuild is imported from a TRANSPILED workspace package, not from the
    // app.) The client never sees it — only the API routes touch the planner.
    if (isServer) {
      config.externals = [...(config.externals ?? []), { esbuild: 'commonjs esbuild' }];
    }
    // The QuickJS singlefile variant carries ~600KB of wasm as a template
    // literal of latin1 characters. Some of its bytes are `\x000` — a NUL
    // followed by the digit zero. Next's SWC minifier re-emits that NUL as
    // `\0`, yielding `\00`, which is an OCTAL ESCAPE and therefore a syntax
    // error inside a template literal. The production chunk then fails to
    // parse ("Octal escape sequences are not allowed in template strings")
    // while dev, being unminified, works fine.
    //
    // Next's minifier skips any asset already flagged `minimized`, so flag the
    // quickjs chunk before the minify pass runs. Nothing else loses
    // minification, and the payload is opaque binary that would not have
    // compressed further anyway.
    if (!isServer) {
      config.plugins.push(new SkipMinifyPlugin(webpack, /quickjs-singlefile-browser-release-sync/));
    }
    return config;
  },
};

export default nextConfig;
