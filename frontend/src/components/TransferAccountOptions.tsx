import type { AccountIdentifier, PaymentMethod } from '../api';
import { useI18n } from '../contexts/I18nContext';
import { formatWithInstitution } from './transactionFormUtils';

interface TransferAccountOptionsProps {
  accounts: AccountIdentifier[];
  paymentMethods: PaymentMethod[];
}

export default function TransferAccountOptions({ accounts, paymentMethods }: TransferAccountOptionsProps) {
  const { t, locale } = useI18n();
  const groups = [
    { label: 'accounts.checkingAccounts', accounts: [] as AccountIdentifier[] },
    { label: 'settings.savingsType.epargne', accounts: [] as AccountIdentifier[] },
    { label: 'settings.savingsType.investissements', accounts: [] as AccountIdentifier[] },
  ];
  const savingsTypes = new Map(paymentMethods.map((method) => [method.id, method.savingsType]));

  for (const account of [...accounts].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }))) {
    const groupIndex = !account.isSavingsAccount ? 0 : savingsTypes.get(account.id) === 'investissements' ? 2 : 1;
    groups[groupIndex].accounts.push(account);
  }

  return (
    <>
      {groups
        .filter((group) => group.accounts.length > 0)
        .map((group) => (
          <optgroup key={group.label} label={t(group.label)}>
            {group.accounts.map((account) => (
              <option key={account.id} value={`${account.id}`}>
                {formatWithInstitution(account.name, account.institution)}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}
