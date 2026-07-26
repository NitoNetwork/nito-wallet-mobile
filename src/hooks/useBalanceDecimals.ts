import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

import { reportNonFinancialFailure } from '../services/diagnostics';
import {
  isBalanceDecimals,
  type BalanceDecimals,
} from '../ui/format';

const BALANCE_DECIMALS_PREFERENCE_KEY = 'nito.wallet.balanceDecimals.v1';
const DEFAULT_BALANCE_DECIMALS: BalanceDecimals = 2;

export const useBalanceDecimals = () => {
  const [balanceDecimals, setBalanceDecimals] = useState<BalanceDecimals>(
    DEFAULT_BALANCE_DECIMALS,
  );

  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(BALANCE_DECIMALS_PREFERENCE_KEY)
      .then((saved) => {
        if (mounted && isBalanceDecimals(saved)) {
          setBalanceDecimals(Number(saved) as BalanceDecimals);
        }
      })
      .catch((caught) => {
        reportNonFinancialFailure('balance decimal preference read', caught);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectBalanceDecimals = useCallback((next: BalanceDecimals) => {
    setBalanceDecimals(next);
    void SecureStore.setItemAsync(BALANCE_DECIMALS_PREFERENCE_KEY, String(next)).catch(
      (caught) => {
        reportNonFinancialFailure('balance decimal preference write', caught);
      },
    );
  }, []);

  return { balanceDecimals, selectBalanceDecimals };
};
