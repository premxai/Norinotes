"use client";

import { useState, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { SampleTag } from "@/components/SectionHead";

/**
 * Section 06's demo: Nori asks the visitor a real question in its bubble; the answer lands in a sample answer bank.
 * The seat controller hears `norinote:answer` and has Nori nod.
 */
export function AskDemo({ children }: { children: ReactNode }) {
  const [answer, setAnswer] = useState<string | null>(null);

  const choose = (value: string) => {
    setAnswer(value);
    dispatchEvent(new CustomEvent("norinote:answer", { detail: { value } }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[4/3] overflow-hidden rounded-panel [container-type:size]">
        {children}
        <div className="absolute top-[12%] right-[5%] w-[min(17.5rem,52%)] max-tablet:w-[min(17.5rem,60%)]">
          <div className="relative rounded-bubble border-2 border-ink bg-surface p-4 shadow-e1">
            <span aria-hidden="true" className="absolute bottom-6 -left-[9px] size-3.5 rotate-45 border-b-2 border-l-2 border-ink bg-surface" />
            {answer ? (
              <p className="font-semibold" role="status">
                Got it. Nori won&rsquo;t ask again.
              </p>
            ) : (
              <>
                <p id="ask-q" className="font-semibold">
                  Open to relocating to New York?
                </p>
                <div className="mt-3 flex gap-2" role="group" aria-labelledby="ask-q">
                  <button type="button" onClick={() => choose("Yes")} className={buttonClass("primary", "min-h-11 flex-1 px-4")}>
                    Yes
                  </button>
                  <button type="button" onClick={() => choose("No")} className={buttonClass("outline", "min-h-11 flex-1 px-4")}>
                    No
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="rounded-card border-[1.5px] border-line bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">Your answers</p>
          <SampleTag />
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-[0.9375rem]">
          <dt className="border-b border-line py-2.5 text-ink-2">Salary expectation</dt>
          <dd className="border-b border-line py-2.5 text-right">$95k to $110k</dd>
          <dt className="border-b border-line py-2.5 text-ink-2">Start date</dt>
          <dd className="border-b border-line py-2.5 text-right">Two weeks&rsquo; notice</dd>
          <dt className="py-2.5 text-ink-2">Relocation to New York</dt>
          <dd className={`py-2.5 text-right ${answer ? "font-semibold text-accent" : "text-ink-2"}`}>{answer ?? "Not asked yet"}</dd>
        </dl>
      </div>
    </div>
  );
}
