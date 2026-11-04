/**
 * Currency standards for QuickBite OS:
 * All internal prices, order calculations, and balances are stored strictly in integer PAISA (1 INR = 100 Paisa).
 * Floating-point arithmetic on currency is strictly forbidden.
 */

/**
 * Formats integer paisa into readable Indian Rupee format (e.g. 2000 -> ₹20 or ₹20.00).
 */
export function formatPaisaToINR(paisa: number, showDecimalsIfZero = false): string {
  if (!Number.isInteger(paisa)) {
    // Defense in depth: round if an unexpected float entered
    paisa = Math.round(paisa)
  }

  const rupees = paisa / 100

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimalsIfZero || paisa % 100 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees)
}

/**
 * Converts whole rupees into integer paisa safely.
 */
export function rupeesToPaisa(rupees: number): number {
  return Math.round(rupees * 100)
}

