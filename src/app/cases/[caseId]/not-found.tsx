import Link from "next/link";

export default function CaseNotFound() {
  return (
    <section className="card">
      <h1>Case not found</h1>
      <p>We could not find that case. It may have been removed, or the link may be wrong.</p>
      <p>
        <Link href="/">Back to the case queue</Link>
      </p>
    </section>
  );
}
