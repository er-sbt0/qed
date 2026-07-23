'use client';

/**
 * /playground — run one lesson program, given to the page rather than generated.
 *
 * Two uses, both real:
 *  - inspecting or replaying a program you already have (a saved generation, a
 *    hand-authored one, a repaired one) without spending a generation;
 *  - the verification driver, which generates ONCE through /api/chat and then
 *    mounts the result here. Regenerating just to see it render would bill
 *    twice and, worse, would screenshot a DIFFERENT program than the one the
 *    gate checked.
 *
 * A program arrives by `window.__mount(js, source)` or in sessionStorage under
 * `playground-program`. It is exactly the same `<LessonCanvas>` the answer path
 * uses — no parallel rendering path, or verifying it would prove nothing.
 */

import { useEffect, useState } from 'react';
import { LessonCanvas } from '@/components/lesson-canvas';

interface Program {
  js: string;
  source: string;
}

declare global {
  interface Window {
    __mount?: (js: string, source: string) => void;
  }
}

export default function PlaygroundPage() {
  const [program, setProgram] = useState<Program | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    window.__mount = (js, source) => setProgram({ js, source });
    const saved = sessionStorage.getItem('playground-program');
    if (saved) {
      try {
        setProgram(JSON.parse(saved) as Program);
      } catch {
        /* a malformed hand-off is not worth crashing the page over */
      }
    }
    return () => {
      delete window.__mount;
    };
  }, []);

  return (
    <div className="main">
      <div className="main-inner">
        <section className="stage">
          <header className="stage-head">
            <p className="eyebrow">Playground</p>
            <h2 className="stage-q">Run a lesson program</h2>
          </header>
          <div className="answer">
            {program ? (
              <>
                <LessonCanvas
                  key={program.source.length}
                  js={program.js}
                  source={program.source}
                />
                <p className="note">
                  <button className="chip" onClick={() => setShowSource((s) => !s)}>
                    {showSource ? 'Hide' : 'Show'} the program
                  </button>
                </p>
                {showSource && <pre className="program">{program.source}</pre>}
              </>
            ) : (
              <p className="warn">
                No program mounted. Call <code>window.__mount(js, source)</code> or put one in
                sessionStorage under <code>playground-program</code>.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
