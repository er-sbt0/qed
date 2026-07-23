/**
 * loop-prompt.test.ts — the tool-loop system prompt's contract (roadmap 4c).
 *
 * Same idea as followup.test.ts: what is free to prove is that the rules the
 * loop depends on are actually IN the prompt, and that the rules shared with
 * the earlier passes are shared by construction, not by parallel prose that
 * will drift. Whether the model then probes before narrating is the billed
 * exit criterion, not something a string assertion can pretend to answer.
 */

import { describe, expect, it } from 'vitest';
import { API_REFERENCE } from './api-reference.js';
import { FOLLOWUP_SYSTEM, toolLoopBrief, toolLoopSystem } from './prompts.js';
import { TOOL_DEFS } from './tool-defs.js';
import type { AnswerPlan } from './plan.js';

const SYSTEM = toolLoopSystem(['calculus']);

describe('toolLoopSystem', () => {
  it('declares every tool', () => {
    for (const t of TOOL_DEFS) expect(SYSTEM).toContain(`${t.name} — `);
  });

  it('teaches the reply protocol: one json call, or prose that ends the turn', () => {
    expect(SYSTEM).toContain('EITHER one tool call OR your final answer in prose');
    expect(SYSTEM).toContain('```json');
    expect(SYSTEM).toContain('Prose ends\nthe turn');
  });

  it('carries the probe-before-narrate rules', () => {
    expect(SYSTEM).toContain('PROBE BEFORE NARRATING');
    expect(SYSTEM).toContain('never do arithmetic a tool can do');
    // the two probes the exit criterion is named after
    expect(SYSTEM).toContain('whyChanged');
    expect(SYSTEM).toContain('bisectFlip');
  });

  it("carries 4a's evidence-honesty rules — the identical text, renumbered", () => {
    // extract rule 3-4 from the follow-up prompt and expect them here as 1-2
    const start = FOLLOWUP_SYSTEM.indexOf('3. NEVER overstate a verdict');
    const end = FOLLOWUP_SYSTEM.indexOf('\n\n5. Change nothing');
    const rules = FOLLOWUP_SYSTEM.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(SYSTEM).toContain(rules.replace('3. NEVER', '1. NEVER').replace('\n4. A claim', '\n2. A claim'));
  });

  it("carries 4b's fragment rules and the gate-retry rule", () => {
    for (const rule of [
      'IT RUNS IN ITS OWN SCOPE',
      'M.byId',
      'OPEN WITH A BEAT',
      'TO REVISE, RETIRE — DO NOT HIDE',
      'KEEP IT SHORT',
    ]) {
      expect(SYSTEM).toContain(rule);
    }
    expect(SYSTEM).toContain('A GATE REJECTION IS A TODO, NOT A DEAD END');
    expect(SYSTEM).toContain('Do not work around the gate');
  });

  it('injects the API reference exactly once', () => {
    expect(SYSTEM.split(API_REFERENCE).length - 1).toBe(1);
  });

  it('does not carry the single-shot output contract — the loop has its own', () => {
    expect(SYSTEM).not.toContain('ONE fenced TypeScript code block containing the entire program');
  });
});

describe('toolLoopBrief', () => {
  const MANIFEST = { objects: [{ id: 'parameter#1', value: 2 }], claims: [] };
  const PLAN: AnswerPlan = {
    topic: 'Curl',
    summary: 'Circulation per unit area.',
    visualize: true,
    disciplines: ['calculus'],
    beats: [
      { title: 'A field that swirls', claim: 'the field visibly rotates' },
      { title: 'Shrink the loop', claim: 'circulation/area converges' },
    ],
  };

  it('layers argument, scene, transition, question — in that order', () => {
    const brief = toolLoopBrief(MANIFEST, 'why red?', {
      plan: PLAN,
      feed: { moved: [{ target: 'parameter#1', value: 2 }], flipped: [] },
      original: 'What is curl?',
    });
    const order = [
      'The lesson answers: What is curl?',
      "THE LESSON'S ARGUMENT",
      'circulation/area converges', // a beat CLAIM — the piece 4a never had
      'SCENE MANIFEST',
      'SINCE THE LAST QUESTION',
      'The student asks: why red?',
    ];
    let at = -1;
    for (const part of order) {
      const next = brief.indexOf(part);
      expect(next, part).toBeGreaterThan(at);
      at = next;
    }
  });

  it('omits the sections it was not given', () => {
    const brief = toolLoopBrief(MANIFEST, 'why red?');
    expect(brief).not.toContain("THE LESSON'S ARGUMENT");
    expect(brief).not.toContain('SINCE THE LAST QUESTION');
    expect(brief).not.toContain('The lesson answers:');
    expect(brief).toContain('SCENE MANIFEST');
  });

  it('the manifest is valid JSON inside the brief', () => {
    const brief = toolLoopBrief(MANIFEST, 'q');
    const json = brief.slice(brief.indexOf('```json') + 7, brief.indexOf('\n```\n'));
    expect(JSON.parse(json)).toEqual(MANIFEST);
  });
});
