import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { type DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  type Account,
  type Asset,
  createAsset,
  deleteAsset,
  fetchAccounts,
  fetchAssets,
  fetchPaymentMethods,
  type PaymentMethod,
  renameAsset,
  reorderAssets,
  reorderPaymentMethods,
  setAccountBalance,
  updateAssetValue,
} from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { logger } from '../utils/logger';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

type AssetsTab = 'table' | 'chart';

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
  const [newAssetParentId, setNewAssetParentId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedAsset, setDraggedAsset] = useState<{ id: number; peerGroup: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [activeTab, setActiveTab] = useState<AssetsTab>('table');
  const currentYear = new Date().getFullYear();

  const buildAccountAssets = useCallback(
    (
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
    },
    []
  );

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
        setAccountAssets((prev) =>
          prev.map((a) =>
            a.id === asset.id
              ? {
                  ...a,
                  yearlyValues: { ...a.yearlyValues, [year]: newValue },
                  accountInitialBalances: { ...a.accountInitialBalances, [year]: newInitialBalance },
                }
              : a
          )
        );
      } else {
        await updateAssetValue(asset.id, year, newValue);
        setAssets((prev) =>
          prev.map((a) => (a.id === asset.id ? { ...a, yearlyValues: { ...a.yearlyValues, [year]: newValue } } : a))
        );
      }
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
      const created = await createAsset(newAssetName.trim(), newAssetIsDebt, newAssetParentId);
      if (newAssetParentId) {
        // Ensure sortOrder places it after all siblings (including account assets)
        const allSiblings = [
          ...assets.filter((a) => a.parentAssetId === newAssetParentId),
          ...accountAssets.filter((a) => a.parentAssetId === newAssetParentId),
        ];
        const maxSiblingOrder = allSiblings.reduce((m, a) => Math.max(m, a.sortOrder), -1);
        const adjusted = { ...created, sortOrder: Math.max(created.sortOrder, maxSiblingOrder + 1) };
        setAssets((prev) => [...prev, adjusted]);
      } else {
        await loadAssets();
      }
      onDataChanged();
      setNewAssetName('');
      setNewAssetIsDebt(false);
      setNewAssetParentId(null);
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

  const startEditName = (asset: AssetRow) => {
    if (asset.isSystem || asset.isAccountAsset) return;
    setEditingNameId(asset.id);
    setEditNameValue(asset.name);
  };

  const cancelEditName = () => {
    setEditingNameId(null);
    setEditNameValue('');
  };

  const saveAssetName = async (assetId: number) => {
    const trimmed = editNameValue.trim();
    if (!trimmed || isSubmitting) {
      cancelEditName();
      return;
    }

    setIsSubmitting(true);
    try {
      await renameAsset(assetId, trimmed);
      setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, name: trimmed } : a)));
      onDataChanged();
      cancelEditName();
    } catch (err) {
      logger.error('Failed to rename asset', err);
      const msg = err instanceof Error ? err.message : 'Failed to rename';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSection = (assetId: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  };

  const handleAssetDragStart = (e: DragEvent, asset: AssetRow, peerGroup: string) => {
    setDraggedAsset({ id: asset.id, peerGroup });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', asset.id.toString());
  };

  const handleAssetDragEnd = () => {
    setDraggedAsset(null);
    setDropTargetId(null);
  };

  const handleAssetDragOver = (e: DragEvent, targetId: number, peerGroup: string) => {
    if (!draggedAsset || draggedAsset.peerGroup !== peerGroup || draggedAsset.id === targetId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(targetId);
  };

  const handleAssetDragLeave = () => {
    setDropTargetId(null);
  };

  const handleAssetDrop = async (e: DragEvent, targetId: number, peers: AssetRow[], peerGroup: string) => {
    e.preventDefault();
    setDropTargetId(null);

    if (!draggedAsset || draggedAsset.peerGroup !== peerGroup || isSubmitting) {
      setDraggedAsset(null);
      return;
    }

    const draggedIndex = peers.findIndex((a) => a.id === draggedAsset.id);
    const targetIndex = peers.findIndex((a) => a.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
      setDraggedAsset(null);
      return;
    }

    const reordered = [...peers];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, removed);

    // Optimistic update — assign new sort orders
    const accountItems = reordered.filter((a) => a.isAccountAsset);
    const regularItems = reordered.filter((a) => !a.isAccountAsset);

    setAccountAssets((prev) => {
      const updated = [...prev];
      for (let i = 0; i < reordered.length; i++) {
        const item = reordered[i];
        if (item.isAccountAsset) {
          const idx = updated.findIndex((a) => a.id === item.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], sortOrder: i };
        }
      }
      return updated;
    });
    setAssets((prev) => {
      const updated = [...prev];
      for (let i = 0; i < reordered.length; i++) {
        const item = reordered[i];
        if (!item.isAccountAsset) {
          const idx = updated.findIndex((a) => a.id === item.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], sortOrder: i };
        }
      }
      return updated;
    });

    setDraggedAsset(null);
    setIsSubmitting(true);
    try {
      const promises: Promise<void>[] = [];
      if (accountItems.length > 0) {
        promises.push(
          reorderPaymentMethods(accountItems.map((a) => ({ id: a.accountId!, sortOrder: reordered.indexOf(a) })))
        );
      }
      if (regularItems.length > 0) {
        promises.push(reorderAssets(regularItems.map((a) => ({ id: a.id, sortOrder: reordered.indexOf(a) }))));
      }
      await Promise.all(promises);
    } catch (error) {
      logger.error('Failed to reorder assets', error);
      await loadAssets();
    } finally {
      setIsSubmitting(false);
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

  const getAssetDisplayName = useCallback(
    (asset: Asset): string => {
      if (!asset.isSystem) return asset.name;

      if (asset.savingsType === 'epargne') return t('settings.savingsType.epargne');
      if (asset.savingsType === 'prevoyance') return t('settings.savingsType.prevoyance');
      if (asset.savingsType === 'investissements') return t('settings.savingsType.investissements');

      if (asset.name === 'Checkings') return t('assets.checkings');
      if (asset.name === 'Savings') return t('assets.savings');
      if (asset.name === 'Pension') return t('assets.pension');
      if (asset.name === 'Investments') return t('assets.investments');

      return asset.name;
    },
    [t]
  );

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
      const children = childAssets.get(parent.id);
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

  const parentSums = useMemo(() => {
    const sums = new Map<number, Record<number, number>>();
    const allChildren: AssetRow[] = [...assets.filter((a) => a.parentAssetId !== null), ...accountAssets];

    for (const child of allChildren) {
      if (child.parentAssetId === null) continue;
      if (!sums.has(child.parentAssetId)) {
        sums.set(child.parentAssetId, {});
      }
      const totals = sums.get(child.parentAssetId)!;
      for (const year of years) {
        totals[year] = (totals[year] || 0) + (child.yearlyValues[year] || 0);
      }
    }

    return sums;
  }, [assets, accountAssets, years]);

  // Calculate totals for each year
  const calculateYearTotals = () => {
    const topLevelAssets = assets.filter((asset) => !asset.isDebt && asset.parentAssetId === null);
    const totals: Record<number, number> = {};
    for (const year of years) {
      totals[year] = topLevelAssets.reduce((sum, asset) => {
        const value = parentSums.has(asset.id) ? parentSums.get(asset.id)?.[year] || 0 : asset.yearlyValues[year] || 0;
        return sum + value;
      }, 0);
    }
    return totals;
  };

  const yearTotals = calculateYearTotals();
  const debtTotals = useMemo(() => {
    const topLevelDebts = assets.filter((asset) => asset.isDebt && asset.parentAssetId === null);
    const totals: Record<number, number> = {};
    for (const year of years) {
      totals[year] = topLevelDebts.reduce((sum, asset) => {
        const value = parentSums.has(asset.id) ? parentSums.get(asset.id)?.[year] || 0 : asset.yearlyValues[year] || 0;
        return sum + value;
      }, 0);
    }
    return totals;
  }, [years, assets, parentSums]);
  const netWorthTotals = useMemo(() => {
    const totals: Record<number, number> = {};
    for (const year of years) {
      totals[year] = (yearTotals[year] || 0) - (debtTotals[year] || 0);
    }
    return totals;
  }, [years, yearTotals, debtTotals]);

  const chartColors = [
    { border: 'rgb(59, 130, 246)', background: 'rgba(59, 130, 246, 0.1)' },
    { border: 'rgb(16, 185, 129)', background: 'rgba(16, 185, 129, 0.1)' },
    { border: 'rgb(139, 92, 246)', background: 'rgba(139, 92, 246, 0.1)' },
    { border: 'rgb(245, 158, 11)', background: 'rgba(245, 158, 11, 0.1)' },
    { border: 'rgb(236, 72, 153)', background: 'rgba(236, 72, 153, 0.1)' },
    { border: 'rgb(20, 184, 166)', background: 'rgba(20, 184, 166, 0.1)' },
  ];

  const chartData = useMemo(() => {
    const labels = years.map(String);
    const datasets: {
      label: string;
      data: (number | null)[];
      borderColor: string;
      backgroundColor: string;
      fill: boolean;
      tension: number;
      pointRadius: number;
      pointHoverRadius: number;
      borderDash?: number[];
    }[] = [];

    // Asset sections (top-level non-debt assets)
    const assetSections = assets.filter((a) => !a.isDebt && a.parentAssetId === null);
    let colorIdx = 0;
    for (const section of assetSections) {
      const color = chartColors[colorIdx % chartColors.length];
      colorIdx++;
      datasets.push({
        label: getAssetDisplayName(section),
        data: years.map((year) => {
          const val = parentSums.has(section.id)
            ? parentSums.get(section.id)?.[year] || 0
            : section.yearlyValues[year] || 0;
          return val || null;
        }),
        borderColor: color.border,
        backgroundColor: color.background,
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      });
    }

    // Debt sections (top-level debt assets) — shown as negative
    const debtSections = assets.filter((a) => a.isDebt && a.parentAssetId === null);
    for (const section of debtSections) {
      const color = chartColors[colorIdx % chartColors.length];
      colorIdx++;
      datasets.push({
        label: `${getAssetDisplayName(section)} (${t('assets.sectionDebt').toLowerCase()})`,
        data: years.map((year) => {
          const val = parentSums.has(section.id)
            ? parentSums.get(section.id)?.[year] || 0
            : section.yearlyValues[year] || 0;
          return val ? -val : null;
        }),
        borderColor: color.border,
        backgroundColor: color.background,
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderDash: [5, 5],
      });
    }

    // Net worth line
    datasets.push({
      label: t('assets.netWorth'),
      data: years.map((year) => netWorthTotals[year] || null),
      borderColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      fill: false,
      tension: 0.3,
      pointRadius: 5,
      pointHoverRadius: 7,
    });

    return { labels, datasets };
  }, [years, assets, parentSums, netWorthTotals, t, getAssetDisplayName]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top' as const,
          labels: {
            color: 'rgb(148, 163, 184)',
            usePointStyle: true,
            padding: 20,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: 'rgb(241, 245, 249)',
          bodyColor: 'rgb(148, 163, 184)',
          borderColor: 'rgb(45, 58, 82)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (context: { dataset: { label?: string }; parsed: { y: number | null } }) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y;
              return `${label}: ${formatCurrency(value ?? 0, true)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(45, 58, 82, 0.5)' },
          ticks: { color: 'rgb(148, 163, 184)' },
        },
        y: {
          grid: { color: 'rgba(45, 58, 82, 0.5)' },
          ticks: {
            color: 'rgb(148, 163, 184)',
            callback: (value: number | string) => {
              if (typeof value === 'number') return formatCurrency(value, true);
              return value;
            },
          },
        },
      },
    }),
    [formatCurrency]
  );

  const orderedDebtAssets = useMemo(() => {
    const debtAssets = assets.filter((asset) => asset.isDebt);
    const sortByOrder = (a: AssetRow, b: AssetRow) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.id - b.id;
    };

    const parents = debtAssets.filter((a) => a.parentAssetId === null).sort(sortByOrder);
    const childrenByParent = new Map<number, AssetRow[]>();
    for (const a of debtAssets) {
      if (a.parentAssetId !== null) {
        if (!childrenByParent.has(a.parentAssetId)) {
          childrenByParent.set(a.parentAssetId, []);
        }
        childrenByParent.get(a.parentAssetId)!.push(a);
      }
    }

    const ordered: AssetRow[] = [];
    for (const parent of parents) {
      ordered.push(parent);
      const children = childrenByParent.get(parent.id);
      if (children) {
        children.sort(sortByOrder).forEach((c) => {
          ordered.push(c);
        });
      }
    }
    return ordered;
  }, [assets]);

  const renderAssetRows = (assetRows: AssetRow[]) => {
    // Find the index of the last child for each parent, so we can insert the add-row after it
    const lastChildIndex = new Map<number, number>();
    for (let i = 0; i < assetRows.length; i++) {
      const asset = assetRows[i];
      if (asset.parentAssetId !== null) {
        lastChildIndex.set(asset.parentAssetId, i);
      }
    }

    // Build peer groups for reordering — all children of a parent form one group
    const topLevelPeers = assetRows.filter((a) => a.parentAssetId === null);
    const childrenByParent = new Map<number, AssetRow[]>();

    for (const a of assetRows) {
      if (a.parentAssetId !== null) {
        if (!childrenByParent.has(a.parentAssetId)) {
          childrenByParent.set(a.parentAssetId, []);
        }
        childrenByParent.get(a.parentAssetId)!.push(a);
      }
    }

    const rows: React.ReactNode[] = [];

    for (let i = 0; i < assetRows.length; i++) {
      const asset = assetRows[i];
      const isChildAsset = asset.parentAssetId !== null;
      const isAccountAsset = asset.isAccountAsset === true;
      const isSectionHeader = !isChildAsset;

      // Skip children of collapsed sections
      if (isChildAsset && asset.parentAssetId !== null && collapsedSections.has(asset.parentAssetId)) {
        continue;
      }
      const displayName = isAccountAsset
        ? getAccountDisplayName(asset.name, asset.institution)
        : getAssetDisplayName(asset);

      // Determine reorder peers and peer group key
      let peers: AssetRow[] | null = null;
      let peerGroup = '';
      if (isSectionHeader) {
        peers = topLevelPeers;
        peerGroup = 'top-level';
      } else if (isChildAsset && asset.parentAssetId !== null) {
        peers = childrenByParent.get(asset.parentAssetId) ?? null;
        peerGroup = `children-${asset.parentAssetId}`;
      }
      const canReorder = peers !== null && peers.length > 1;
      const isDragging = draggedAsset?.id === asset.id;
      const isDropTarget = dropTargetId === asset.id;

      rows.push(
        <tr
          key={asset.id}
          className={`${isSectionHeader ? 'asset-section-header' : ''}${isChildAsset ? 'asset-child' : ''}${isDragging ? ' dragging' : ''}${isDropTarget ? ' drop-target-item' : ''}`}
          draggable={canReorder}
          onDragStart={canReorder ? (e) => handleAssetDragStart(e, asset, peerGroup) : undefined}
          onDragEnd={canReorder ? handleAssetDragEnd : undefined}
          onDragOver={canReorder ? (e) => handleAssetDragOver(e, asset.id, peerGroup) : undefined}
          onDragLeave={canReorder ? handleAssetDragLeave : undefined}
          onDrop={canReorder ? (e) => handleAssetDrop(e, asset.id, peers!, peerGroup) : undefined}
        >
          <td className={`account-name${isChildAsset ? ' asset-child-name' : ''}`}>
            <div className="asset-name-inner">
              {isSectionHeader && (
                <button
                  type="button"
                  className="btn-icon section-toggle"
                  onClick={() => toggleSection(asset.id)}
                  title={collapsedSections.has(asset.id) ? t('common.expand') : t('common.collapse')}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`chevron ${collapsedSections.has(asset.id) ? 'collapsed' : ''}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
              {canReorder && (
                <div className="asset-drag-handle">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="2" />
                    <circle cx="15" cy="6" r="2" />
                    <circle cx="9" cy="12" r="2" />
                    <circle cx="15" cy="12" r="2" />
                    <circle cx="9" cy="18" r="2" />
                    <circle cx="15" cy="18" r="2" />
                  </svg>
                </div>
              )}
              {isAccountAsset ? (
                <div className="asset-card-group">
                  <span>{displayName}</span>
                  {asset.institution && <span className="asset-card asset-card-institution">{asset.institution}</span>}
                </div>
              ) : editingNameId === asset.id ? (
                <input
                  type="text"
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveAssetName(asset.id);
                    if (e.key === 'Escape') cancelEditName();
                  }}
                  onBlur={() => saveAssetName(asset.id)}
                  className="balance-input asset-name-input"
                  // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                  autoFocus
                />
              ) : (
                <span className={!asset.isSystem ? 'editable-name' : ''} onDoubleClick={() => startEditName(asset)}>
                  {displayName}
                </span>
              )}
              {isSectionHeader && (
                <button
                  className="btn-icon add-inline"
                  onClick={() => {
                    setNewAssetParentId(asset.id);
                    setNewAssetIsDebt(asset.isDebt);
                    setNewAssetName('');
                    setShowAddAsset(true);
                  }}
                  title={t('assets.addAsset')}
                  type="button"
                  style={{ padding: '2px', marginLeft: '0.5rem' }}
                >
                  +
                </button>
              )}
              {!asset.isSystem && (
                <button
                  className="btn-icon"
                  onClick={() => handleDeleteAsset(asset)}
                  title={t('assets.deleteAsset')}
                  type="button"
                  style={{ color: '#ef4444', padding: '2px', marginLeft: '0.5rem' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          </td>
          {years.map((year, yearIndex) => {
            const hasChildren = parentSums.has(asset.id);
            const value = hasChildren ? parentSums.get(asset.id)?.[year] || 0 : asset.yearlyValues[year] || 0;
            const isEditing = editingCell?.assetId === asset.id && editingCell?.year === year;
            const isEditable = isAccountAsset ? year !== currentYear : !hasChildren && !asset.isSystem;

            // Year-over-year variation
            const prevYear = years[yearIndex - 1];
            const prevValue =
              prevYear !== undefined
                ? hasChildren
                  ? parentSums.get(asset.id)?.[prevYear] || 0
                  : asset.yearlyValues[prevYear] || 0
                : null;
            const variation =
              prevValue !== null && prevValue !== 0
                ? Math.round(((value - prevValue) / Math.abs(prevValue)) * 100)
                : null;

            return (
              <td key={year} className="account-month-cell">
                {!isEditable || !isEditing ? (
                  <>
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
                    {variation !== null && (
                      <span
                        className={`variation-badge ${variation > 0 ? 'positive' : variation < 0 ? 'negative' : ''}`}
                      >
                        {variation > 0 ? '+' : ''}
                        {variation}%
                      </span>
                    )}
                  </>
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

      // After the last child of a parent, insert the add form row
      const parentId = asset.parentAssetId;
      if (
        parentId !== null &&
        lastChildIndex.get(parentId) === i &&
        showAddAsset &&
        newAssetParentId === parentId &&
        !collapsedSections.has(parentId)
      ) {
        rows.push(
          <tr key={`add-${parentId}`} className="asset-child">
            <td className="account-name asset-child-name" colSpan={years.length + 1}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.25rem 0' }}>
                <input
                  type="text"
                  value={newAssetName}
                  onChange={(e) => setNewAssetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateAsset();
                    if (e.key === 'Escape') {
                      setShowAddAsset(false);
                      setNewAssetName('');
                      setNewAssetParentId(null);
                    }
                  }}
                  placeholder={t('assets.assetNamePlaceholder')}
                  className="balance-input"
                  style={{ width: '200px' }}
                  // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on create
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreateAsset}
                  disabled={!newAssetName.trim() || isCreating}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                >
                  {isCreating ? t('assets.creating') : t('assets.createAsset')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowAddAsset(false);
                    setNewAssetName('');
                    setNewAssetParentId(null);
                  }}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </td>
          </tr>
        );
      }

      // If parent has no children yet, insert form right after the parent row
      if (
        isSectionHeader &&
        !lastChildIndex.has(asset.id) &&
        showAddAsset &&
        newAssetParentId === asset.id &&
        !collapsedSections.has(asset.id)
      ) {
        rows.push(
          <tr key={`add-${asset.id}`} className="asset-child">
            <td className="account-name asset-child-name" colSpan={years.length + 1}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.25rem 0' }}>
                <input
                  type="text"
                  value={newAssetName}
                  onChange={(e) => setNewAssetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateAsset();
                    if (e.key === 'Escape') {
                      setShowAddAsset(false);
                      setNewAssetName('');
                      setNewAssetParentId(null);
                    }
                  }}
                  placeholder={t('assets.assetNamePlaceholder')}
                  className="balance-input"
                  style={{ width: '200px' }}
                  // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on create
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreateAsset}
                  disabled={!newAssetName.trim() || isCreating}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                >
                  {isCreating ? t('assets.creating') : t('assets.createAsset')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowAddAsset(false);
                    setNewAssetName('');
                    setNewAssetParentId(null);
                  }}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </td>
          </tr>
        );
      }
    }

    return rows;
  };

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

        {(displayAssets.length > 0 || orderedDebtAssets.length > 0) && (
          <div className="accounts-tabs">
            <button
              type="button"
              className={`accounts-tab ${activeTab === 'table' ? 'active' : ''}`}
              onClick={() => setActiveTab('table')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
              {t('assets.table')}
            </button>
            <button
              type="button"
              className={`accounts-tab ${activeTab === 'chart' ? 'active' : ''}`}
              onClick={() => setActiveTab('chart')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              {t('assets.chart')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="form-error" style={{ marginBottom: '1rem' }}>
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              marginLeft: '1rem',
              textDecoration: 'underline',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
            }}
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
          {activeTab === 'chart' && (
            <div className="accounts-chart-container">
              <div className="accounts-chart">
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          )}
          {activeTab === 'table' && (
            <>
              <div className="accounts-section">
                <div className="accounts-section-title-row">
                  <h3 className="accounts-section-title">{t('assets.sectionAssets')}</h3>
                  <button
                    type="button"
                    className="btn-icon add-inline"
                    onClick={() => {
                      setNewAssetIsDebt(false);
                      setNewAssetParentId(null);
                      setShowAddAsset(true);
                    }}
                    title={t('assets.addSection')}
                  >
                    +
                  </button>
                </div>
                {showAddAsset && !newAssetIsDebt && newAssetParentId === null && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label
                          htmlFor="assetName"
                          style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}
                        >
                          {t('assets.sectionName')}
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
                          placeholder={t('assets.sectionNamePlaceholder')}
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
                        {isCreating ? t('assets.creating') : t('assets.createSection')}
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
                    <tbody>{renderAssetRows(displayAssets)}</tbody>
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
                      setNewAssetParentId(null);
                      setShowAddAsset(true);
                    }}
                    title={t('assets.addDebtSection')}
                  >
                    +
                  </button>
                </div>
                {showAddAsset && newAssetIsDebt && newAssetParentId === null && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label
                          htmlFor="debtName"
                          style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}
                        >
                          {t('assets.sectionName')}
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
                          placeholder={t('assets.debtSectionNamePlaceholder')}
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
                        {isCreating ? t('assets.creating') : t('assets.createSection')}
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
                <p style={{ marginTop: '1rem', fontSize: '0.875rem', opacity: 0.7 }}>{t('assets.currentYearNote')}</p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
