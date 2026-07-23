/**
 * promote.ts — turn a recorded generation into the example the model is shown.
 *
 * `./run.sh record "<q>"` bills one generation. Historically that produced only
 * a cassette: real model output kept for free replay, which is the regression
 * check for everything downstream of the model. The program itself was thrown
 * away, and `examples/` stayed whatever someone hand-wrote months earlier.
 *
 * That is backwards. The few-shot examples are the single highest-leverage
 * input to generation, and they rot the moment the vocabulary moves — an
 * example that reaches for a verb the reference no longer teaches is actively
 * teaching the model to fail. So the same billed run now also PROMOTES its
 * program: `examples/<slug>/`, plus the manifest entry that makes the prompt
 * pick it up. Re-record and the corpus follows the engine.
 *
 * Three rules, each one a decision rather than a default:
 *
 *   1. ONE EXAMPLE PER DISCIPLINE, NEWEST WINS. A recording for a discipline
 *      that already has an example replaces it and DELETES the old directory.
 *      Examples are prompt input, not history; a second stale program for the
 *      same discipline is a thing to trip over, and git remembers it anyway.
 *   2. ONLY IF IT GATED. A program that failed lint or the sandbox is worth
 *      keeping as a cassette — that is the valuable kind — but showing it to
 *      the model as an exemplar teaches the exact failure it encodes.
 *   3. ONLY IF THE PLAN NAMED A DISCIPLINE. `disciplines: []` is a legitimate
 *      plan (compose from the kernel), but the manifest is keyed by discipline,
 *      so there is no slot to put it in. Skipped, loudly.
 *
 * Everything here is plain fs against the repo, so it is exercised by
 * promote.test.ts rather than only by the billed path.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** one row of examples/manifest.json */
export interface ManifestEntry {
  readonly key: string;
  readonly dir: string;
  readonly title: string;
}

interface Manifest {
  readonly '//'?: string;
  readonly examples: ManifestEntry[];
}

export interface PromotionInput {
  /** the cassette slug — also the directory name, unless it is already taken */
  readonly slug: string;
  readonly question: string;
  /** the plan's first discipline; '' or undefined means "no slot" */
  readonly discipline: string | undefined;
  /** the plan's topic, shown as the example's title */
  readonly title: string;
  /** the program the model authored, verbatim (the artifact of record) */
  readonly source: string;
  readonly model: string;
  readonly recordedAt: string;
  readonly warnings: readonly string[];
}

export type Promotion =
  | { readonly promoted: true; readonly dir: string; readonly replaced: string | null }
  | { readonly promoted: false; readonly reason: string };

/** provenance dropped beside a promoted program, so nobody has to guess. */
interface ExampleMeta {
  readonly question: string;
  readonly discipline: string;
  readonly title: string;
  readonly model: string;
  readonly recordedAt: string;
  readonly cassette: string;
  readonly warnings: readonly string[];
}

/**
 * A slug can collide with an example held by a DIFFERENT discipline — two
 * questions phrased alike, or a hand-written directory that happens to match.
 * Overwriting that directory would leave the other discipline's manifest entry
 * pointing at a program about something else, which is the kind of bug that
 * only shows up as the model being mysteriously worse. Suffix instead.
 */
function freeDir(root: string, slug: string, mine: readonly ManifestEntry[]): string {
  const taken = new Set(mine.map((e) => e.dir));
  if (!taken.has(slug) && !existsSync(join(root, 'examples', slug))) return slug;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${slug}-${n}`;
    if (!taken.has(candidate) && !existsSync(join(root, 'examples', candidate))) return candidate;
  }
  throw new Error(`no free example directory for "${slug}" after 99 tries`);
}

export function promoteToExample(root: string, input: PromotionInput): Promotion {
  const discipline = input.discipline?.trim();
  if (!discipline) {
    return {
      promoted: false,
      reason:
        'the plan named no discipline — the manifest is keyed by one, so there is no slot ' +
        'to promote into. The cassette is still worth having.',
    };
  }

  const manifestPath = join(root, 'examples', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const entries = [...manifest.examples];
  const at = entries.findIndex((e) => e.key === discipline);
  const previous = at >= 0 ? entries[at]! : null;

  // Re-recording the same question into the same slot reuses the directory;
  // anything else gets a directory nobody else claims.
  const dir =
    previous && previous.dir === input.slug
      ? input.slug
      : freeDir(
          root,
          input.slug,
          entries.filter((e) => e.key !== discipline),
        );

  const exampleDir = join(root, 'examples', dir);
  mkdirSync(exampleDir, { recursive: true });
  writeFileSync(join(exampleDir, 'beats.ts'), input.source.trimEnd() + '\n');

  const meta: ExampleMeta = {
    question: input.question,
    discipline,
    title: input.title,
    model: input.model,
    recordedAt: input.recordedAt,
    cassette: `packages/planner/src/cassettes/${input.slug}.json`,
    warnings: input.warnings,
  };
  writeFileSync(join(exampleDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const entry: ManifestEntry = { key: discipline, dir, title: input.title };
  if (at >= 0) entries[at] = entry;
  else entries.push(entry);

  // Newest wins: the superseded directory goes, so `examples/` never
  // accumulates programs the prompt cannot reach. Recoverable from git.
  let replaced: string | null = null;
  if (previous && previous.dir !== dir) {
    rmSync(join(root, 'examples', previous.dir), { recursive: true, force: true });
    replaced = previous.dir;
  }

  const next: Manifest = { ...manifest, examples: entries };
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n');

  return { promoted: true, dir, replaced };
}
