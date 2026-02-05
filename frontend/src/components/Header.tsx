import { useFormatCurrency } from '../hooks/useFormatCurrency';

interface HeaderProps {
  year: number;
  initialBalance: number;
  remainingBalance: number;
}

export default function Header({ year, initialBalance, remainingBalance }: HeaderProps) {
  const formatCurrency = useFormatCurrency();

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="page-title">Budget {year}</h1>
      </div>
      <div className="header-right">
        <div className="balance-card">
          <span className="balance-label">Solde initial</span>
          <span className="balance-value">CHF {formatCurrency(initialBalance, true)}</span>
        </div>
        <div className={`balance-card ${remainingBalance >= 0 ? 'positive' : 'negative'}`}>
          <span className="balance-label">Restant annuel</span>
          <span className="balance-value">CHF {formatCurrency(remainingBalance, true)}</span>
        </div>
      </div>
    </header>
  );
}
