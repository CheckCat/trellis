/**
 * Russian plural agreement: `plural(2, ["день", "дня", "дней"])` → "дня".
 *
 * The interface is in Russian, and "5 дня подряд" is the kind of thing that
 * makes an app feel machine-made. The rule is the standard one — one form
 * for 1, one for 2–4, one for 0 and 5–20 — with the teens exception, which
 * is where naive `n % 10` versions get it wrong (11, 12, 13, 14).
 */
export function plural(count: number, forms: readonly [string, string, string]): string {
  const absolute = Math.abs(count) % 100;
  if (absolute >= 11 && absolute <= 14) {
    return forms[2];
  }
  const last = absolute % 10;
  if (last === 1) {
    return forms[0];
  }
  if (last >= 2 && last <= 4) {
    return forms[1];
  }
  return forms[2];
}
