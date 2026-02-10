import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { BudgetGroup, BudgetItem, GroupType } from '../types';
import ConfirmDialog from './ConfirmDialog';

interface BudgetPlaygroundProps {
  year: number;
  groups: BudgetGroup[];
  months: string[];
  paymentAccountsInitialBalance: number;
}

interface Section {
  type: GroupType;
  name: string;
  groups: BudgetGroup[];
}

function deepCloneGroups(groups: BudgetGroup[]): BudgetGroup[] {
  return groups.map((g) => ({
    ...g,
    items: g.items.map((item) => ({
      ...item,
      months: item.months.map((m) => ({ ...m })),
    })),
  }));
}

const SESSION_KEY_PREFIX = 'playground-';

interface SessionData {
  groups: BudgetGroup[];
  initialBalance?: number;
}

function loadSession(year: number): SessionData | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${year}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Support legacy format (plain array)
    if (Array.isArray(parsed)) return { groups: parsed };
    return parsed as SessionData;
  } catch {
    return null;
  }
}

function saveSession(year: number, data: SessionData): void {
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${year}`, JSON.stringify(data));
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
}

function organizeSections(
  groups: BudgetGroup[],
  labels: { income: string; expense: string; savings: string }
): Section[] {
  const sections: Section[] = [
    { type: 'income', name: labels.income, groups: [] },
    { type: 'expense', name: labels.expense, groups: [] },
    { type: 'savings', name: labels.savings, groups: [] },
  ];

  for (const group of groups) {
    const section = sections.find((s) => s.type === group.type);
    if (section) {
      section.groups.push(group);
    }
  }

  return sections.filter((s) => s.groups.length > 0);
}

export default function BudgetPlayground({
  year,
  groups,
  months,
  paymentAccountsInitialBalance,
}: BudgetPlaygroundProps) {
  const { t } = useI18n();
  const formatCurrency = useFormatCurrency();
  const { dialogProps, confirm } = useConfirmDialog();
  const initialGroupsRef = useRef<BudgetGroup[]>(deepCloneGroups(groups));
  const sessionData = useRef(loadSession(year));
  const [playgroundGroups, setPlaygroundGroups] = useState<BudgetGroup[]>(() => sessionData.current?.groups ?? deepCloneGroups(groups));
  const [localInitialBalance, setLocalInitialBalance] = useState<number>(() => sessionData.current?.initialBalance ?? paymentAccountsInitialBalance);
  const [editingInitialBalance, setEditingInitialBalance] = useState(false);

  useEffect(() => {
    saveSession(year, { groups: playgroundGroups, initialBalance: localInitialBalance });
  }, [year, playgroundGroups, localInitialBalance]);

  const [editingCell, setEditingCell] = useState<{ itemId: number; month: number } | null>(null);
  const [editingYearlyBudget, setEditingYearlyBudget] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<GroupType>>(new Set(['income', 'expense', 'savings']));
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set(groups.map((g) => g.id)));
  const [quickFillItemId, setQuickFillItemId] = useState<number | null>(null);
  const [quickFillValue, setQuickFillValue] = useState('');
  const [quickFillMonths, setQuickFillMonths] = useState<Set<number>>(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));

  const sections = useMemo(
    () =>
      organizeSections(playgroundGroups, {
        income: t('budget.income'),
        expense: t('budget.expenses'),
        savings: t('budget.savings'),
      }),
    [playgroundGroups, t]
  );

  const toggleSection = (type: GroupType) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleGroup = (groupId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleCellClick = (itemId: number, month: number, currentValue: number) => {
    setEditingYearlyBudget(null);
    setEditingCell({ itemId, month });
    setEditValue(currentValue === 0 ? '' : currentValue.toString());
  };

  const handleYearlyBudgetClick = (itemId: number, currentValue: number) => {
    setEditingCell(null);
    setEditingYearlyBudget(itemId);
    setEditValue(currentValue === 0 ? '' : currentValue.toString());
  };

  const updateLocalValue = useCallback((itemId: number, month: number, value: number) => {
    setPlaygroundGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((item) => {
          if (item.id !== itemId) return item;
          const newMonths = [...item.months];
          newMonths[month - 1] = { ...newMonths[month - 1], budget: value };
          return { ...item, months: newMonths };
        }),
      }))
    );
  }, []);

  const updateLocalYearlyBudget = useCallback((itemId: number, value: number) => {
    setPlaygroundGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((item) => (item.id === itemId ? { ...item, yearlyBudget: value } : item)),
      }))
    );
  }, []);

  const handleSave = useCallback(() => {
    if (!editingCell && editingYearlyBudget === null) return;
    const newValue = editValue === '' ? 0 : parseFloat(editValue);
    if (!Number.isNaN(newValue)) {
      if (editingCell) {
        updateLocalValue(editingCell.itemId, editingCell.month, newValue);
      } else if (editingYearlyBudget !== null) {
        updateLocalYearlyBudget(editingYearlyBudget, newValue);
      }
    }
    setEditingCell(null);
    setEditingYearlyBudget(null);
  }, [editingCell, editingYearlyBudget, editValue, updateLocalValue, updateLocalYearlyBudget]);

  const findItem = useCallback(
    (itemId: number): BudgetItem | undefined => {
      for (const section of sections) {
        for (const group of section.groups) {
          const item = group.items.find((i) => i.id === itemId);
          if (item) return item;
        }
      }
      return undefined;
    },
    [sections]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleSave();
      if (editingCell) {
        const nextMonth = editingCell.month < 12 ? editingCell.month + 1 : 1;
        const item = findItem(editingCell.itemId);
        if (item) {
          const nextValue = item.months[nextMonth - 1]?.budget || 0;
          // Use setTimeout to allow the save to process first
          setTimeout(() => handleCellClick(editingCell.itemId, nextMonth, nextValue), 0);
        }
      }
    }
  };

  const handleQuickFill = useCallback(
    (itemId: number) => {
      const value = parseFloat(quickFillValue);
      if (Number.isNaN(value)) return;

      setPlaygroundGroups((prev) =>
        prev.map((g) => ({
          ...g,
          items: g.items.map((item) => {
            if (item.id !== itemId) return item;
            const newMonths = item.months.map((m, i) => (quickFillMonths.has(i + 1) ? { ...m, budget: value } : m));
            return { ...item, months: newMonths };
          }),
        }))
      );
      setQuickFillItemId(null);
      setQuickFillValue('');
      setQuickFillMonths(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    },
    [quickFillValue, quickFillMonths]
  );

  const handleClearRow = useCallback((itemId: number) => {
    setPlaygroundGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((item) =>
          item.id === itemId ? { ...item, yearlyBudget: 0, months: item.months.map((m) => ({ ...m, budget: 0 })) } : item
        ),
      }))
    );
  }, []);

  const toggleQuickFillMonth = (month: number) => {
    setQuickFillMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  const handleResetToInitial = async () => {
    const confirmed = await confirm({
      title: t('playground.resetToInitial'),
      message: t('playground.resetConfirm'),
      variant: 'warning',
    });
    if (!confirmed) return;
    setPlaygroundGroups(deepCloneGroups(initialGroupsRef.current));
    setLocalInitialBalance(paymentAccountsInitialBalance);
  };

  const handleSetAllToZero = async () => {
    const confirmed = await confirm({
      title: t('playground.setAllToZero'),
      message: t('playground.zeroConfirm'),
      variant: 'warning',
    });
    if (!confirmed) return;
    setPlaygroundGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((item) => ({
          ...item,
          yearlyBudget: 0,
          months: item.months.map((m) => ({ ...m, budget: 0 })),
        })),
      }))
    );
  };

  const handleImportActuals = async () => {
    const now = new Date();
    const currentMonth = now.getFullYear() === year ? now.getMonth() : -1; // 0-indexed
    if (currentMonth < 0) return;

    const confirmed = await confirm({
      title: t('playground.importActuals'),
      message: t('playground.importActualsConfirm', { count: currentMonth + 1 }),
      variant: 'default',
    });
    if (!confirmed) return;

    const original = initialGroupsRef.current;
    const originalItemMap = new Map<number, BudgetItem>();
    for (const g of original) {
      for (const item of g.items) {
        originalItemMap.set(item.id, item);
      }
    }

    setPlaygroundGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((item) => {
          const orig = originalItemMap.get(item.id);
          if (!orig) return item;
          const newMonths = item.months.map((m, i) => {
            if (i <= currentMonth) {
              return { ...m, budget: orig.months[i]?.actual || 0 };
            }
            return m;
          });
          return { ...item, months: newMonths };
        }),
      }))
    );
  };

  const getSectionColor = (type: GroupType) => {
    switch (type) {
      case 'income':
        return '#10b981';
      case 'expense':
        return '#ef4444';
      case 'savings':
        return '#3b82f6';
      default:
        return '#6b7280';
    }
  };

  const calculateSectionTotal = (section: Section): number => {
    let total = 0;
    for (const group of section.groups) {
      for (const item of group.items) {
        total += item.yearlyBudget || 0;
        total += item.months.reduce((sum, m) => sum + m.budget, 0);
      }
    }
    return total;
  };

  const calculateSectionYearlyBudget = (section: Section): number => {
    return section.groups.reduce(
      (total, group) => total + group.items.reduce((itemTotal, item) => itemTotal + (item.yearlyBudget || 0), 0),
      0
    );
  };

  const calculateSectionMonthlyTotals = (section: Section): number[] => {
    return Array(12)
      .fill(0)
      .map((_, i) =>
        section.groups.reduce(
          (total, group) =>
            total + group.items.reduce((itemTotal, item) => itemTotal + (item.months[i]?.budget || 0), 0),
          0
        )
      );
  };

  // Calculate funds available (running balance projection)
  const fundsSummary = useMemo(() => {
    const incomeSection = sections.find((s) => s.type === 'income');
    const expenseSection = sections.find((s) => s.type === 'expense');
    const savingsSection = sections.find((s) => s.type === 'savings');

    const getMonthlyTotal = (section: Section | undefined, monthIndex: number): number => {
      if (!section) return 0;
      return section.groups.reduce(
        (total, group) =>
          total + group.items.reduce((itemTotal, item) => itemTotal + (item.months[monthIndex]?.budget || 0), 0),
        0
      );
    };

    // Calculate remaining yearly budgets for December projection
    // Use original actuals to subtract variable spending that already happened
    const initialItemMap = new Map<number, BudgetItem>();
    for (const g of initialGroupsRef.current) {
      for (const item of g.items) {
        initialItemMap.set(item.id, item);
      }
    }

    const getRemainingYearlyBudget = (section: Section | undefined): number => {
      if (!section) return 0;
      return section.groups.reduce(
        (total, group) =>
          total +
          group.items.reduce((itemTotal, item) => {
            const yearlyBudget = item.yearlyBudget || 0;
            if (yearlyBudget === 0) return itemTotal;
            const orig = initialItemMap.get(item.id);
            const actualSpent = orig ? orig.months.reduce((sum, m) => sum + m.actual, 0) : 0;
            return itemTotal + Math.max(0, yearlyBudget - actualSpent);
          }, 0),
        0
      );
    };

    const startOfMonth: number[] = [];
    const endOfMonth: number[] = [];

    for (let i = 0; i < 12; i++) {
      const start = i === 0 ? localInitialBalance : endOfMonth[i - 1];
      startOfMonth.push(start);

      const income = getMonthlyTotal(incomeSection, i);
      const expense = getMonthlyTotal(expenseSection, i);
      const savings = getMonthlyTotal(savingsSection, i);

      let end = start + income - expense - savings;

      // In December, add remaining yearly budgets
      if (i === 11) {
        end +=
          getRemainingYearlyBudget(incomeSection) -
          getRemainingYearlyBudget(expenseSection) -
          getRemainingYearlyBudget(savingsSection);
      }

      endOfMonth.push(end);
    }

    return { startOfMonth, endOfMonth };
  }, [sections, localInitialBalance]);

  return (
    <div className="budget-planning-container">
      <div
        className="budget-planning-header"
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}
      >
        <div>
          <h2>{t('playground.title', { year })}</h2>
          <p className="budget-planning-subtitle">{t('playground.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('playground.unsavedNote')}</span>
          <button type="button" className="btn" onClick={handleImportActuals}>
            {t('playground.importActuals')}
          </button>
          <button type="button" className="btn" onClick={handleResetToInitial}>
            {t('playground.resetToInitial')}
          </button>
          <button type="button" className="btn" onClick={handleSetAllToZero}>
            {t('playground.setAllToZero')}
          </button>
        </div>
      </div>

      <div className="budget-planning-content">
        <div className="budget-planning-table-container">
          <table className="budget-planning-table">
            <thead>
              <tr>
                <th className="col-category sticky-col">{t('planning.category')}</th>
                <th className="col-actions">{t('planning.actions')}</th>
                <th className="col-annual">{t('planning.annualTotal')}</th>
                <th className="col-yearly">{t('planning.variable')}</th>
                {months.map((month, i) => (
                  <th key={i} className="col-month">
                    {month.slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Funds Available Section */}
              <tr className="funds-header-row">
                <td colSpan={4 + months.length}>{t('spreadsheet.fundsAvailable')}</td>
              </tr>
              <tr className="funds-row funds-start">
                <td className="funds-label sticky-col">{t('spreadsheet.startOfMonth')}</td>
                <td className="funds-dash" />
                <td className="funds-dash">–</td>
                <td className="funds-dash">–</td>
                {fundsSummary.startOfMonth.map((value, i) => (
                  <td key={i} className={`funds-value ${value < 0 ? 'negative' : ''}`}>
                    {i === 0 && editingInitialBalance ? (
                      <input
                        type="number"
                        className="budget-input"
                        style={{ display: 'block', marginLeft: 'auto' }}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                          const v = parseFloat(editValue);
                          if (!Number.isNaN(v)) setLocalInitialBalance(v);
                          setEditingInitialBalance(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = parseFloat(editValue);
                            if (!Number.isNaN(v)) setLocalInitialBalance(v);
                            setEditingInitialBalance(false);
                          } else if (e.key === 'Escape') {
                            setEditingInitialBalance(false);
                          }
                        }}
                        // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                        autoFocus
                      />
                    ) : (
                      <span
                        style={i === 0 ? { cursor: 'pointer' } : undefined}
                        onClick={i === 0 ? () => {
                          setEditingInitialBalance(true);
                          setEditValue(localInitialBalance === 0 ? '' : parseFloat(localInitialBalance.toFixed(2)).toString());
                        } : undefined}
                      >
                        {formatCurrency(value, true)}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
              <tr className="funds-row funds-end">
                <td className="funds-label sticky-col">{t('spreadsheet.endOfMonth')}</td>
                <td className="funds-dash" />
                <td className="funds-dash">–</td>
                <td className="funds-dash">–</td>
                {fundsSummary.endOfMonth.map((value, i) => (
                  <td key={i} className={`funds-value ${value < 0 ? 'negative' : ''}`}>
                    {formatCurrency(value, true)}
                  </td>
                ))}
              </tr>
              <tr className="funds-spacer-row">
                <td colSpan={4 + months.length} />
              </tr>

              {sections.map((section) => {
                const isExpanded = expandedSections.has(section.type);
                const sectionGrandTotal = calculateSectionTotal(section);
                const sectionYearlyBudget = calculateSectionYearlyBudget(section);
                const sectionMonthlyTotals = calculateSectionMonthlyTotals(section);
                const sectionColor = getSectionColor(section.type);

                return (
                  <React.Fragment key={section.type}>
                    <tr
                      className={`section-row section-${section.type}`}
                      style={{ '--section-color': sectionColor } as React.CSSProperties}
                    >
                      <td className="category-cell sticky-col section-name" onClick={() => toggleSection(section.type)}>
                        <span className={`chevron ${!isExpanded ? 'collapsed' : ''}`}>&#9660;</span>
                        {section.name}
                      </td>
                      <td className="actions-cell" />
                      <td className="annual-total">{formatCurrency(sectionGrandTotal, true)}</td>
                      <td className="yearly-budget-total">{formatCurrency(sectionYearlyBudget)}</td>
                      {sectionMonthlyTotals.map((total, i) => (
                        <td key={i} className="month-total">
                          {formatCurrency(total)}
                        </td>
                      ))}
                    </tr>

                    {isExpanded &&
                      section.groups.map((group) => {
                        const isGroupExpanded = expandedGroups.has(group.id);
                        const groupMonthlyTotal = group.items.reduce(
                          (total, item) => total + item.months.reduce((m, v) => m + v.budget, 0),
                          0
                        );
                        const groupYearlyBudget = group.items.reduce(
                          (total, item) => total + (item.yearlyBudget || 0),
                          0
                        );
                        const groupGrandTotal = groupMonthlyTotal + groupYearlyBudget;
                        const groupMonthlyTotals = Array(12)
                          .fill(0)
                          .map((_, i) => group.items.reduce((total, item) => total + (item.months[i]?.budget || 0), 0));

                        return (
                          <React.Fragment key={group.id}>
                            <tr className="group-row">
                              <td className="category-cell sticky-col group-name" onClick={() => toggleGroup(group.id)}>
                                <span className={`chevron ${!isGroupExpanded ? 'collapsed' : ''}`}>&#9660;</span>
                                {group.name}
                              </td>
                              <td className="actions-cell" />
                              <td className="annual-total group-total">{formatCurrency(groupGrandTotal, true)}</td>
                              <td className="yearly-budget-total group-total">{formatCurrency(groupYearlyBudget)}</td>
                              {groupMonthlyTotals.map((total, i) => (
                                <td key={i} className="month-total group-total">
                                  {formatCurrency(total)}
                                </td>
                              ))}
                            </tr>

                            {isGroupExpanded &&
                              group.items.map((item) => {
                                const itemMonthlyTotal = item.months.reduce((m, v) => m + v.budget, 0);
                                const itemGrandTotal = itemMonthlyTotal + (item.yearlyBudget || 0);
                                const isQuickFilling = quickFillItemId === item.id;
                                const isEditingYearly = editingYearlyBudget === item.id;

                                return (
                                  <tr key={item.id} className="item-row">
                                    <td className="category-cell sticky-col item-name">{item.name}</td>
                                    <td className="actions-cell">
                                      {isQuickFilling ? (
                                        <div className="quick-fill-inline">
                                          <button
                                            className="btn-icon cancel"
                                            onClick={() => setQuickFillItemId(null)}
                                            title={t('common.cancel')}
                                          >
                                            &#10005;
                                          </button>
                                        </div>
                                      ) : (
                                        <>
                                          <button
                                            className="btn-icon quick-fill"
                                            onClick={() => {
                                              setQuickFillItemId(item.id);
                                              const firstNonZero = item.months.find((m) => m.budget > 0);
                                              setQuickFillValue(firstNonZero ? firstNonZero.budget.toString() : '');
                                            }}
                                            title={t('planning.quickFill')}
                                          >
                                            <svg
                                              width="16"
                                              height="16"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                            >
                                              <path d="M12 5v14M5 12h14" />
                                            </svg>
                                          </button>
                                          <button
                                            className="btn-icon clear-row"
                                            onClick={() => handleClearRow(item.id)}
                                            title={t('playground.clearRow')}
                                          >
                                            <svg
                                              width="16"
                                              height="16"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                            >
                                              <path d="M18 6L6 18M6 6l12 12" />
                                            </svg>
                                          </button>
                                        </>
                                      )}
                                    </td>
                                    <td className="annual-total item-total">{formatCurrency(itemGrandTotal)}</td>
                                    <td className="yearly-budget-cell">
                                      {isEditingYearly ? (
                                        <input
                                          type="number"
                                          className="budget-input yearly"
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          onBlur={handleSave}
                                          onKeyDown={handleKeyDown}
                                          // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                                          autoFocus
                                        />
                                      ) : (
                                        <span
                                          className={`budget-value yearly ${(item.yearlyBudget || 0) === 0 ? 'zero' : ''}`}
                                          onClick={() => handleYearlyBudgetClick(item.id, item.yearlyBudget || 0)}
                                        >
                                          {formatCurrency(item.yearlyBudget || 0)}
                                        </span>
                                      )}
                                    </td>
                                    {item.months.map((monthValue, i) => {
                                      const isEditing = editingCell?.itemId === item.id && editingCell?.month === i + 1;

                                      return (
                                        <td key={i} className="month-cell">
                                          {isEditing ? (
                                            <input
                                              type="number"
                                              className="budget-input"
                                              value={editValue}
                                              onChange={(e) => setEditValue(e.target.value)}
                                              onBlur={handleSave}
                                              onKeyDown={handleKeyDown}
                                              // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                                              autoFocus
                                            />
                                          ) : (
                                            <span
                                              className={`budget-value ${monthValue.budget === 0 ? 'zero' : ''}`}
                                              onClick={() => handleCellClick(item.id, i + 1, monthValue.budget)}
                                            >
                                              {formatCurrency(monthValue.budget)}
                                            </span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                          </React.Fragment>
                        );
                      })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Fill Modal */}
      {quickFillItemId && (
        <div className="quick-fill-modal-overlay" onClick={() => setQuickFillItemId(null)}>
          <div className="quick-fill-modal" onClick={(e) => e.stopPropagation()}>
            <div className="quick-fill-header">
              <h3>{t('planning.quickFillTitle')}</h3>
              <button className="btn-close" onClick={() => setQuickFillItemId(null)}>
                &#10005;
              </button>
            </div>
            <div className="quick-fill-body">
              <div className="quick-fill-amount">
                <label>{t('planning.monthlyAmount')}</label>
                <input
                  type="number"
                  value={quickFillValue}
                  onChange={(e) => setQuickFillValue(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="quick-fill-months">
                <label>{t('planning.months')}</label>
                <div className="month-toggles">
                  {months.map((month, i) => (
                    <button
                      key={i}
                      className={`month-toggle ${quickFillMonths.has(i + 1) ? 'active' : ''}`}
                      onClick={() => toggleQuickFillMonth(i + 1)}
                    >
                      {month.slice(0, 3)}
                    </button>
                  ))}
                </div>
                <div className="month-presets">
                  <button
                    className="preset-btn"
                    onClick={() => setQuickFillMonths(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))}
                  >
                    {t('planning.all')}
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set())}>
                    {t('planning.none')}
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set([1, 2, 3, 4, 5, 6]))}>
                    {t('planning.semester1')}
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set([7, 8, 9, 10, 11, 12]))}>
                    {t('planning.semester2')}
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set([1, 4, 7, 10]))}>
                    {t('planning.quarter')}
                  </button>
                </div>
              </div>
            </div>
            <div className="quick-fill-footer">
              <button className="btn-secondary" onClick={() => setQuickFillItemId(null)}>
                {t('planning.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={() => handleQuickFill(quickFillItemId)}
                disabled={!quickFillValue || quickFillMonths.size === 0}
              >
                {t('planning.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
