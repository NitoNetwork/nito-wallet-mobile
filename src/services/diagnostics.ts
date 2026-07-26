export const reportNonFinancialFailure = (operation: string, caught: unknown) => {
  const errorName = caught instanceof Error ? caught.name : typeof caught;
  console.info(`[Nito] ${operation} failed (${errorName}).`);
};
