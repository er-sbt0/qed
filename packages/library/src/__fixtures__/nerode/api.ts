/**
 * api.ts — the runtime `./api` module for the Myhill–Nerode fixture program.
 * A module of its own on purpose, rather than a shared one: the program binds
 * the scope active at its own import moment, which is what lets a second
 * fixture be added later without the two fighting over one binding.
 */

import { getActiveScope } from '../../scope.js';

const scope = getActiveScope();

export const M = scope.M;
export const Prob = scope.Prob;
export const View = scope.View;
export const Layout = scope.Layout;
export const F = scope.F;
export const lesson = scope.lesson;

export type { Word } from '../../automata.js';
export type { Verdict } from '@math-ai/lesson';
