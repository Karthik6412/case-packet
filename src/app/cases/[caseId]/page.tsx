import Link from "next/link";
import { Suspense } from "react";
import { CaseDetail } from "../../_components/CaseDetail";

export default function CasePage({ params }: PageProps<"/cases/[caseId]">) {
  return (
    <>
      <p className="back">
        <Link href="/">← Case queue</Link>
      </p>
      <Suspense fallback={<p className="muted">Loading case…</p>}>
        <CaseDetail params={params} />
      </Suspense>
    </>
  );
}
