/** Lowercase, strip diacritics. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Normalize a person's name to tokens in "given ... family" order.
 * Handles diacritics, case, punctuation, whitespace, and "FAMILY, GIVEN" order.
 */
export function nameTokens(raw: string): string[] {
  let s = raw.trim();
  const comma = s.indexOf(",");
  if (comma !== -1) {
    s = `${s.slice(comma + 1)} ${s.slice(0, comma)}`;
  }
  return fold(s)
    .replace(/['’.]/g, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Names match when first and last tokens agree; middle names/initials are ignored. */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

const EMPLOYER_NOISE = new Set([
  "the",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "lp",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
]);

/** Normalize an employer name: case, punctuation, and corporate suffixes. */
export function normalizeEmployer(raw: string): string {
  return fold(raw)
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !EMPLOYER_NOISE.has(t))
    .join(" ");
}

/** Parse a strict YYYY-MM-DD date to whole days since epoch, or null if invalid. */
export function parseIsoDay(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return ms / 86_400_000;
}
