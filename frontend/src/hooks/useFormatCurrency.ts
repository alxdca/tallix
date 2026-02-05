import { useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { formatCurrency as formatCurrencyUtil } from '../utils';

export function useFormatCurrency() {
  const { decimalSeparator } = useSettings();

  const formatCurrency = useCallback(
    (value: number, showZero = false) => {
      return formatCurrencyUtil(value, showZero, decimalSeparator);
    },
    [decimalSeparator]
  );

  return formatCurrency;
}
