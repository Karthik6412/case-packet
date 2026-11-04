import { Suspense } from "react";
import { CaseQueue } from "./_components/CaseQueue";

export default function Home() {
  return (
    <>
      <h1>Case queue</h1>
      <p className="muted lead">Cases that need action come first.</p>
      <Suspense fallback={<p className="muted">Loading cases…</p>}>
        <CaseQueue />
      </Suspense>
    </>
  );
}
