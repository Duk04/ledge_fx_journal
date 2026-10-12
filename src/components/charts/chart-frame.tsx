import type { ReactNode } from "react";

/**
 * The accessible wrapper every chart sits in. An SVG chart is a picture to a
 * screen reader — dozens of unlabelled paths — so the frame says, in one
 * sentence, what the picture shows. The sentence is the chart's conclusion
 * (best/worst, start/end), not a description of its axes.
 */
export function ChartFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} className="h-full w-full">
      {children}
    </div>
  );
}
