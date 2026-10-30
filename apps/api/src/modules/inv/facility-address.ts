/**
 * The seed ships the two facilities with an address that says it is not one. A facility whose first line still
 * reads like that is not shown to customers in production and cannot be a shipping origin.
 */
export function isPlaceholderAddress(line1: string): boolean {
  return /placeholder|SET REAL ADDRESS/i.test(line1);
}
