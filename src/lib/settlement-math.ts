export const FEE_RATES = {
  visit: 90000,
  detachment: 90000,
  event: 90000,
  introduce: 20000,
  fuel: 20000,
  interview: 500000,
} as const;

export type FeeType = keyof typeof FEE_RATES | "other";

export function lineAmount(type: FeeType, quantity: number, otherAmount = 0): number {
  if (type === "other") return Math.max(0, otherAmount);
  return Math.max(0, quantity) * FEE_RATES[type];
}

export function recomputeSettlement(baseAmountKrw: number, additionalAmountKrw: number) {
  const subtotal = baseAmountKrw + additionalAmountKrw;
  const taxAmountKrw = Math.floor(subtotal * 0.033);
  const afterTax = subtotal - taxAmountKrw;
  const finalAmountKrw = Math.floor(afterTax / 10) * 10;
  return { taxAmountKrw, finalAmountKrw };
}
