
export function calculateSum(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0);
}