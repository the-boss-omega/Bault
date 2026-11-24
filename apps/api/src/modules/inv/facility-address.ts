export function isPlaceholderAddress(line1: string): boolean {
  return /placeholder|SET REAL ADDRESS/i.test(line1);
}
