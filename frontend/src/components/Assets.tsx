import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Asset,
  type Account,
  type PaymentMethod,
  createAsset,
  deleteAsset,
  fetchAccounts,
  fetchAssets,
  fetchPaymentMethods,
  setAccountBalance,
  updateAssetValue,
} from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { logger } from '../utils/logger';

interface AssetsProps {
  onDataChanged: () => void;
}

type AssetRow = Asset & {
  accountId?: number;
  accountInitialBalances?: Record<number, number>;
  institution?: string | null;
  isAccountAsset?: boolean;
};

export default function Assets({ onDataChanged }: AssetsProps) {
  const formatCurrency = useFormatCurrency();
  const { t } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [accountAssets, setAccountAssets] = useState<AssetRow[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<{ assetId: number; year: number } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetIsDebt, setNewAssetIsDebt] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();

  const buildAccountAssets = useCallback((
    baseAssets: Asset[],
    accountsByYear: Array<{ year: number; accounts: Account[] }>,
    paymentMethods: PaymentMethod[]
  ): AssetRow[] => {
    const paymentMethodMap = new Map(paymentMethods.map((method) => [method.id, method]));

    const systemCategoryIds = {
      checkings: baseAssets.find((asset) => asset.isSystem && asset.name === 'Checkings')?.id ?? null,
      savings: baseAssets.find((asset) => asset.isSystem && asset.name === 'Savings')?.id ?? null,
      pension: baseAssets.find((asset) => asset.isSystem && asset.name === 'Pension')?.id ?? null,
      investments: baseAssets.find((asset) => asset.isSystem && asset.name === 'Investments')?.id ?? null,
    };

    const accountAssetsMap = new Map<number, AssetRow>();

    for (const { year, accounts } of accountsByYear) {
      for (const account of accounts) {
        const paymentMethod = paymentMethodMap.get(account.id);
        let parentAssetId = systemCategoryIds.checkings;

        if (account.isSavingsAccount) {
          if (paymentMethod?.savingsType === 'prevoyance') {
            parentAssetId = systemCategoryIds.pension;
          } else if (paymentMethod?.savingsType === 'investissements') {
            parentAssetId = systemCategoryIds.investments;
          } else {
            parentAssetId = systemCategoryIds.savings;
          }
        }

        const yearEndValue = account.monthlyBalances[11] ?? 0;

        if (!accountAssetsMap.has(account.id)) {
          accountAssetsMap.set(account.id, {
            id: -account.id,
            name: account.name,
            sortOrder: account.sortOrder,
            isSystem: true,
            isDebt: false,
            parentAssetId,
            savingsType: null,
            yearlyValues: { [year]: yearEndValue },
            accountId: account.id,
            accountInitialBalances: { [year]: account.initialBalance },
            institution: account.institution,
            isAccountAsset: true,
          });
        } else {
          const existing = accountAssetsMap.get(account.id)!;
          existing.parentAssetId = parentAssetId;
          existing.yearlyValues[year] = yearEndValue;
          existing.institution = account.institution;
          existing.accountId = account.id;
          if (!existing.accountInitialBalances) {
            existing.accountInitialBalances = {};
          }
          existing.accountInitialBalances[year] = account.initialBalance;
        }
      }
    }

    return Array.from(accountAssetsMap.values());
  }, []);

  const loadAssets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAssets();

      const paymentMethodsPromise = fetchPaymentMethods().catch((error) => {
        logger.error('Failed to load payment methods', error);
        return [] as PaymentMethod[];
      });

      const accountsByYearPromise = Promise.all(
        data.years.map(async (year) => {
          try {
            const accountsData = await fetchAccounts(year);
            return { year, accounts: accountsData.accounts };
          } catch (error) {
            logger.error(`Failed to load accounts for year ${year}`, error);
            return { year, accounts: [] as Account[] };
          }
        })
      );

      const [paymentMethods, accountsByYear] = await Promise.all([paymentMethodsPromise, accountsByYearPromise]);

      setAssets(data.assets);
      setAccountAssets(buildAccountAssets(data.assets, accountsByYear, paymentMethods));
      setYears(data.years);
    } catch (error) {
      logger.error('Failed to load assets', error);
    } finally {
      setLoading(false);
    }
  }, [buildAccountAssets]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const startEditCell = (assetId: number, year: number, currentValue: number) => {
    setEditingCell({ assetId, year });
    setEditValue(currentValue.toString());
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveValue = async (asset: AssetRow, year: number) => {
    if (isSubmitting) return;

    const newValue = parseFloat(editValue);
    if (Number.isNaN(newValue)) {
      cancelEdit();
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      if (asset.isAccountAsset) {
        const accountId = asset.accountId;
        const initialBalances = asset.accountInitialBalances;
        const currentInitialBalance = initialBalances?.[year];
        const currentYearEnd = asset.yearlyValues[year] ?? 0;

        if (!accountId || currentInitialBalance === undefined) {
          throw new Error('Missing account balance data');
        }

        const delta = newValue - currentYearEnd;
        const newInitialBalance = currentInitialBalance + delta;
        await setAccountBalance(year, accountId, newInitialBalance);
      } else {
        console.log('Saving asset value:', { assetId: asset.id, year, newValue });
        await updateAssetValue(asset.id, year, newValue);
      }
      await loadAssets();
      onDataChanged();
      cancelEdit();
    } catch (error) {
      logger.error('Failed to save asset value', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save asset value';
      console.error('Error saving asset value:', errorMessage);
      setError(`Failed to save value for year ${year}: ${errorMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAsset = async () => {
    if (!newAssetName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      await createAsset(newAssetName.trim(), newAssetIsDebt);
      await loadAssets();
      onDataChanged();
      setNewAssetName('');
      setNewAssetIsDebt(false);
      setShowAddAsset(false);
    } catch (error) {
      logger.error('Failed to create asset', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteAsset = async (asset: Asset) => {
    if (asset.isSystem) {
      return; // System assets cannot be deleted
    }

    const confirmed = window.confirm(t('assets.deleteConfirm', { name: asset.name }));
    if (!confirmed) return;

    try {
      await deleteAsset(asset.id);
      await loadAssets();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to delete asset', error);
    }
  };

  const getAccountDisplayName = (name: string, institution?: string | null) => {
    if (!institution) return name;
    const escapedInstitution = institution.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`\\s*\\(\\s*${escapedInstitution}\\s*\\)\\s*$`, 'i'),
      new RegExp(`\\s*-\\s*${escapedInstitution}\\s*$`, 'i'),
      new RegExp(`\\s*\\u2022\\s*${escapedInstitution}\\s*$`, 'i'),
      new RegExp(`\\s*\\u2013\\s*${escapedInstitution}\\s*$`, 'i'),
      new RegExp(`\\s*\\u2014\\s*${escapedInstitution}\\s*$`, 'i'),
    ];

    let cleanedName = name;
    for (const pattern of patterns) {
      cleanedName = cleanedName.replace(pattern, '');
    }
    return cleanedName.trim() || name;
  };

  const getAssetDisplayName = (asset: Asset): string => {
    if (!asset.isSystem) return asset.name;

    if (asset.savingsType === 'epargne') return t('settings.savingsType.epargne');
    if (asset.savingsType === 'prevoyance') return t('settings.savingsType.prevoyance');
    if (asset.savingsType === 'investissements') return t('settings.savingsType.investissements');

    if (asset.name === 'Checkings') return t('assets.checkings');
    if (asset.name === 'Savings') return t('assets.savings');
    if (asset.name === 'Pension') return t('assets.pension');
    if (asset.name === 'Investments') return t('assets.investments');

    return asset.name;
  };

  const displayAssets = useMemo(() => {
    const combinedAssets: AssetRow[] = [...assets.filter((asset) => !asset.isDebt), ...accountAssets];
    const childAssets = new Map<number, AssetRow[]>();

    for (const asset of combinedAssets) {
      if (asset.parentAssetId !== null) {
        if (!childAssets.has(asset.parentAssetId)) {
          childAssets.set(asset.parentAssetId, []);
        }
        childAssets.get(asset.parentAssetId)!.push(asset);
      }
    }

    const sortByOrder = (a: AssetRow, b: AssetRow) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.id - b.id;
    };

    const orderedAssets: AssetRow[] = [];
    const includedIds = new Set<number>();

    const addAsset = (asset: AssetRow) => {
      if (!includedIds.has(asset.id)) {
        orderedAssets.push(asset);
        includedIds.add(asset.id);
      }
    };

    const topLevelSystem = combinedAssets
      .filter((asset) => asset.isSystem && asset.parentAssetId === null)
      .sort(sortByOrder);
    const topLevelCustom = combinedAssets
      .filter((asset) => !asset.isSystem && asset.parentAssetId === null)
      .sort(sortByOrder);

    for (const parent of topLevelSystem) {
      addAsset(parent);
      const children = childAssets.get(parent.id)?.filter((asset) => asset.isSystem);
      if (children) {
        children.sort(sortByOrder).forEach(addAsset);
      }
    }

    const systemParentIds = new Set(topLevelSystem.map((asset) => asset.id));
    const systemOrphans = combinedAssets
      .filter((asset) => asset.isSystem && asset.parentAssetId !== null && !systemParentIds.has(asset.parentAssetId))
      .sort(sortByOrder);
    systemOrphans.forEach(addAsset);

    for (const parent of topLevelCustom) {
      addAsset(parent);
      const children = childAssets.get(parent.id)?.filter((asset) => !asset.isSystem);
      if (children) {
        children.sort(sortByOrder).forEach(addAsset);
      }
    }

    const customParentIds = new Set(topLevelCustom.map((asset) => asset.id));
    const customOrphans = combinedAssets
      .filter(
        (asset) =>
          !asset.isSystem &&
          asset.parentAssetId !== null &&
          !customParentIds.has(asset.parentAssetId) &&
          !systemParentIds.has(asset.parentAssetId)
      )
      .sort(sortByOrder);
    customOrphans.forEach(addAsset);

    return orderedAssets;
  }, [assets, accountAssets]);

  // Calculate totals for each year
  const calculateYearTotals = () => {
    const topLevelAssets = assets.filter((asset) => !asset.isDebt && asset.parentAssetId === null);
    const totals: Record<number, number> = {};
    for (const year of years) {
      totals[year] = topLevelAssets.reduce((sum, asset) => sum + (asset.yearlyValues[year] || 0), 0);
    }
    return totals;
  };

  const yearTotals = calculateYearTotals();
  const debtTotals = useMemo(() => {
    const topLevelDebts = assets.filter((asset) => asset.isDebt && asset.parentAssetId === null);
    const totals: Record<number, number> = {};
    for (const year of years) {
      totals[year] = topLevelDebts.reduce((sum, asset) => sum + (asset.yearlyValues[year] || 0), 0);
    }
    return totals;
  }, [years, assets]);
  const netWorthTotals = useMemo(() => {
    const totals: Record<number, number> = {};
    for (const year of years) {
      totals[year] = (yearTotals[year] || 0) - (debtTotals[year] || 0);
    }
    return totals;
  }, [years, yearTotals, debtTotals]);

  const orderedDebtAssets = useMemo(() => {
    const debtAssets = assets.filter((asset) => asset.isDebt);
    return [...debtAssets].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.id - b.id;
    });
  }, [assets]);

  const renderAssetRows = (assetRows: AssetRow[]) =>
    assetRows.map((asset) => {
      const isChildAsset = asset.parentAssetId !== null;
      const isAccountAsset = asset.isAccountAsset === true;
      const displayName = isAccountAsset
        ? getAccountDisplayName(asset.name, asset.institution)
        : getAssetDisplayName(asset);

      return (
        <tr key={asset.id} className={isChildAsset ? 'asset-child' : undefined}>
          <td className={`account-name${isChildAsset ? ' asset-child-name' : ''}`}>
            {isAccountAsset ? (
              <div className="asset-card-group">
                <span>{displayName}</span>
                {asset.institution && (
                  <span className="asset-card asset-card-institution">{asset.institution}</span>
                )}
              </div>
            ) : (
              displayName
            )}
            {!asset.isSystem && (
              <button
                className="btn-icon"
                onClick={() => handleDeleteAsset(asset)}
                title={t('assets.deleteAsset')}
                type="button"
                style={{ color: '#ef4444', padding: '2px', marginLeft: '0.5rem' }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </td>
          {years.map((year) => {
            const value = asset.yearlyValues[year] || 0;
            const isEditing = editingCell?.assetId === asset.id && editingCell?.year === year;
            const isCurrentYearSystemAsset = asset.isSystem && year === currentYear;
            const isEditable = isAccountAsset
              ? year !== currentYear
              : !isCurrentYearSystemAsset && !(asset.isSystem && isChildAsset);

            return (
              <td key={year} className="account-month-cell">
                {!isEditable || !isEditing ? (
                  <span
                    className={`balance-value ${isEditable ? 'editable' : ''}`}
                    onClick={() => {
                      if (isEditable) {
                        startEditCell(asset.id, year, value);
                      }
                    }}
                    title={isEditable ? t('assets.clickToEdit') : t('assets.autoCalculated')}
                    style={{ cursor: isEditable ? 'pointer' : 'default' }}
                  >
                    {formatCurrency(value, true)}
                  </span>
                ) : (
                  <div className="inline-edit">
                    <input
                      type="number"
                      step="0.01"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveValue(asset, year);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      className="balance-input"
                      // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                      autoFocus
                    />
                    <button
                      className="btn-icon save"
                      onClick={() => saveValue(asset, year)}
                      disabled={isSubmitting}
                      type="button"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </td>
            );
          })}
        </tr>
      );
    });

  if (loading) {
    return (
      <div className="accounts-loading">
        <div className="loading-spinner" />
        <p>{t('assets.loading')}</p>
      </div>
    );
  }

  return (
    <div className="accounts-view">
      <div className="accounts-header">
        <div className="accounts-header-top">
          <div>
            <h2>{t('assets.title')}</h2>
            <p className="accounts-subtitle">{t('assets.subtitle')}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="form-error" style={{ marginBottom: '1rem' }}>
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ marginLeft: '1rem', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            Dismiss
          </button>
        </div>
      )}


      {displayAssets.length === 0 && orderedDebtAssets.length === 0 ? (
        <div className="accounts-empty">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <h3>{t('assets.noAssets')}</h3>
          <p>{t('assets.noAssetsSubtitle')}</p>
        </div>
      ) : (
        <>
          <div className="accounts-section">
            <div className="accounts-section-title-row">
              <h3 className="accounts-section-title">{t('assets.sectionAssets')}</h3>
            <button
              type="button"
              className="btn-icon add-inline"
              onClick={() => {
                setNewAssetIsDebt(false);
                setShowAddAsset(true);
              }}
              title={t('assets.addAsset')}
            >
              +
            </button>
            </div>
            {showAddAsset && !newAssetIsDebt && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label htmlFor="assetName" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                      {t('assets.assetName')}
                    </label>
                    <input
                      id="assetName"
                      type="text"
                      value={newAssetName}
                      onChange={(e) => setNewAssetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateAsset();
                        if (e.key === 'Escape') {
                          setShowAddAsset(false);
                          setNewAssetName('');
                          setNewAssetIsDebt(false);
                        }
                      }}
                      placeholder={t('assets.assetNamePlaceholder')}
                      className="balance-input"
                      style={{ width: '100%' }}
                      // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on create
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleCreateAsset}
                    disabled={!newAssetName.trim() || isCreating}
                  >
                    {isCreating ? t('assets.creating') : t('assets.createAsset')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setShowAddAsset(false);
                      setNewAssetName('');
                      setNewAssetIsDebt(false);
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
            <div className="accounts-table-container">
              <table className="accounts-table assets-table">
              <thead>
                <tr>
                  <th className="account-name-col" />
                    {years.map((year) => (
                      <th key={year} className="account-month-col">
                        {year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                {renderAssetRows(displayAssets)}
              </tbody>
                <tfoot>
                  <tr className="total-row">
                    <td className="account-name total-label">{t('assets.totalAssets')}</td>
                    {years.map((year) => (
                      <td key={year} className="account-month-cell total-value">
                        <span className="balance-value">{formatCurrency(yearTotals[year] || 0, true)}</span>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="accounts-section">
            <div className="accounts-section-title-row">
              <h3 className="accounts-section-title">{t('assets.sectionDebt')}</h3>
            <button
              type="button"
              className="btn-icon add-inline"
              onClick={() => {
                setNewAssetIsDebt(true);
                setShowAddAsset(true);
              }}
              title={t('assets.addDebt')}
            >
              +
            </button>
            </div>
            {showAddAsset && newAssetIsDebt && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label htmlFor="debtName" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                      {t('assets.debtName')}
                    </label>
                    <input
                      id="debtName"
                      type="text"
                      value={newAssetName}
                      onChange={(e) => setNewAssetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateAsset();
                        if (e.key === 'Escape') {
                          setShowAddAsset(false);
                          setNewAssetName('');
                          setNewAssetIsDebt(false);
                        }
                      }}
                      placeholder={t('assets.debtNamePlaceholder')}
                      className="balance-input"
                      style={{ width: '100%' }}
                      // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on create
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleCreateAsset}
                    disabled={!newAssetName.trim() || isCreating}
                  >
                    {isCreating ? t('assets.creating') : t('assets.createDebt')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setShowAddAsset(false);
                      setNewAssetName('');
                      setNewAssetIsDebt(false);
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
            <div className="accounts-table-container">
              <table className="accounts-table assets-table">
                <thead>
                  <tr>
                    <th className="account-name-col" />
                    {years.map((year) => (
                      <th key={year} className="account-month-col">
                        {year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{renderAssetRows(orderedDebtAssets)}</tbody>
                <tfoot>
                  <tr className="total-row">
                    <td className="account-name total-label">{t('assets.totalDebt')}</td>
                    {years.map((year) => (
                      <td key={year} className="account-month-cell total-value">
                        <span className="balance-value">{formatCurrency(debtTotals[year] || 0, true)}</span>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="accounts-section">
            <h3 className="accounts-section-title">{t('assets.netWorth')}</h3>
            <div className="accounts-table-container">
              <table className="accounts-table assets-table">
                <thead>
                  <tr>
                    <th className="account-name-col" />
                    {years.map((year) => (
                      <th key={year} className="account-month-col">
                        {year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody />
                <tfoot>
                  <tr className="grand-total-row net-worth-row">
                    <td className="account-name grand-total">{t('assets.netWorth')}</td>
                    {years.map((year) => (
                      <td key={year} className="account-month-cell grand-total">
                        <span className="balance-value">{formatCurrency(netWorthTotals[year] || 0, true)}</span>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p style={{ marginTop: '1rem', fontSize: '0.875rem', opacity: 0.7 }}>
              {t('assets.currentYearNote')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
