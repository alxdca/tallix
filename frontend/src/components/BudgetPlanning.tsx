import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { updateItem, updateMonthlyValue } from '../api';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { BudgetGroup, GroupType } from '../types';

interface BudgetPlanningProps {
  year: number;
  groups: BudgetGroup[];
  months: string[];
  onDataChanged: () => void;
}

interface Section {
  type: GroupType;
  name: string;
  groups: BudgetGroup[];
}

// Organize groups into sections
function organizeSections(groups: BudgetGroup[]): Section[] {
  const sections: Section[] = [
    { type: 'income', name: 'Revenus', groups: [] },
    { type: 'expense', name: 'Dépenses', groups: [] },
  ];

  groups.forEach((group) => {
    const section = sections.find((s) => s.type === group.type);
    if (section) {
      section.groups.push(group);
    }
  });

  return sections.filter((s) => s.groups.length > 0);
}

export default function BudgetPlanning({ year, groups, months, onDataChanged }: BudgetPlanningProps) {
  const formatCurrency = useFormatCurrency();
  const [editingCell, setEditingCell] = useState<{ itemId: number; month: number } | null>(null);
  const [editingYearlyBudget, setEditingYearlyBudget] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<GroupType>>(new Set(['income', 'expense']));
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set(groups.map((g) => g.id)));
  const [quickFillItemId, setQuickFillItemId] = useState<number | null>(null);
  const [quickFillValue, setQuickFillValue] = useState('');
  const [quickFillMonths, setQuickFillMonths] = useState<Set<number>>(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));

  const sections = useMemo(() => organizeSections(groups), [groups]);

  // Expand new groups when they're added
  useEffect(() => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      for (const g of groups) {
        newSet.add(g.id);
      }
      return newSet;
    });
  }, [groups]);

  const toggleSection = (type: GroupType) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleGroup = (groupId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleCellClick = (itemId: number, month: number, currentValue: number) => {
    setEditingYearlyBudget(null); // Close any yearly budget editing
    setEditingCell({ itemId, month });
    setEditValue(currentValue === 0 ? '' : currentValue.toString());
  };

  const handleYearlyBudgetClick = (itemId: number, currentValue: number) => {
    setEditingCell(null); // Close any monthly cell editing
    setEditingYearlyBudget(itemId);
    setEditValue(currentValue === 0 ? '' : currentValue.toString());
  };

  const handleSave = useCallback(async () => {
    if (!editingCell && editingYearlyBudget === null) return;

    const newValue = editValue === '' ? 0 : parseFloat(editValue);
    if (Number.isNaN(newValue)) {
      setEditingCell(null);
      setEditingYearlyBudget(null);
      return;
    }

    setSaving(true);
    try {
      if (editingCell) {
        await updateMonthlyValue(editingCell.itemId, editingCell.month, { budget: newValue });
      } else if (editingYearlyBudget !== null) {
        await updateItem(editingYearlyBudget, { yearlyBudget: newValue });
      }
      onDataChanged();
    } catch (error) {
      console.error('Failed to update budget:', error);
    } finally {
      setSaving(false);
      setEditingCell(null);
      setEditingYearlyBudget(null);
    }
  }, [editingCell, editingYearlyBudget, editValue, onDataChanged]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditingYearlyBudget(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleSave();
      // Move to next cell (only for monthly cells)
      if (editingCell) {
        const nextMonth = editingCell.month < 12 ? editingCell.month + 1 : 1;
        // Find the item to get its current value
        for (const section of sections) {
          for (const group of section.groups) {
            const item = group.items.find((i) => i.id === editingCell.itemId);
            if (item) {
              const nextValue = item.months[nextMonth - 1]?.budget || 0;
              handleCellClick(editingCell.itemId, nextMonth, nextValue);
              return;
            }
          }
        }
      }
    }
  };

  const handleQuickFill = useCallback(
    async (itemId: number) => {
      const value = parseFloat(quickFillValue);
      if (Number.isNaN(value)) return;

      setSaving(true);
      try {
        // Update all selected months
        const promises = Array.from(quickFillMonths).map((month) =>
          updateMonthlyValue(itemId, month, { budget: value })
        );
        await Promise.all(promises);
        onDataChanged();
        setQuickFillItemId(null);
        setQuickFillValue('');
        setQuickFillMonths(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      } catch (error) {
        console.error('Failed to quick fill:', error);
      } finally {
        setSaving(false);
      }
    },
    [quickFillValue, quickFillMonths, onDataChanged]
  );

  const toggleQuickFillMonth = (month: number) => {
    setQuickFillMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  };

  const getSectionColor = (type: GroupType) => {
    switch (type) {
      case 'income':
        return '#10b981';
      case 'expense':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  // Calculate totals for a section (monthly + yearly budgets)
  const calculateSectionTotal = (section: Section): { monthly: number; yearly: number } => {
    let monthly = 0;
    let yearly = 0;
    section.groups.forEach((group) => {
      group.items.forEach((item) => {
        yearly += item.yearlyBudget || 0;
        monthly += item.months.reduce((sum, m) => sum + m.budget, 0);
      });
    });
    return { monthly, yearly };
  };

  // Calculate yearly budget total for a section
  const calculateSectionYearlyBudget = (section: Section): number => {
    return section.groups.reduce((total, group) => {
      return (
        total +
        group.items.reduce((itemTotal, item) => {
          return itemTotal + (item.yearlyBudget || 0);
        }, 0)
      );
    }, 0);
  };

  // Calculate remaining yearly budget for a section (yearly budget - actual spent)
  const calculateSectionRemainingBudget = (section: Section): number => {
    return section.groups.reduce((total, group) => {
      return (
        total +
        group.items.reduce((itemTotal, item) => {
          const yearlyBudget = item.yearlyBudget || 0;
          if (yearlyBudget === 0) return itemTotal;
          const actualSpent = item.months.reduce((sum, m) => sum + m.actual, 0);
          return itemTotal + (yearlyBudget - actualSpent);
        }, 0)
      );
    }, 0);
  };

  // Calculate monthly totals for a section
  const calculateSectionMonthlyTotals = (section: Section): number[] => {
    return Array(12)
      .fill(0)
      .map((_, i) => {
        return section.groups.reduce((total, group) => {
          return (
            total +
            group.items.reduce((itemTotal, item) => {
              return itemTotal + (item.months[i]?.budget || 0);
            }, 0)
          );
        }, 0);
      });
  };

  return (
    <div className="budget-planning-container">
      <div className="budget-planning-header">
        <h2>Planification du Budget {year}</h2>
        <p className="budget-planning-subtitle">
          Configurez vos prévisions de dépenses mensuelles pour chaque catégorie
        </p>
      </div>

      <div className="budget-planning-content">
        <div className="budget-planning-table-container">
          <table className="budget-planning-table">
            <thead>
              <tr>
                <th className="col-category sticky-col">Catégorie</th>
                <th className="col-actions">Actions</th>
                <th className="col-annual">Total Annuel</th>
                <th className="col-yearly">Variable</th>
                <th className="col-remaining">Restant</th>
                {months.map((month, i) => (
                  <th key={i} className="col-month">
                    {month.slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const isExpanded = expandedSections.has(section.type);
                const sectionTotals = calculateSectionTotal(section);
                const sectionYearlyBudget = calculateSectionYearlyBudget(section);
                const sectionRemainingBudget = calculateSectionRemainingBudget(section);
                const sectionMonthlyTotals = calculateSectionMonthlyTotals(section);
                const sectionColor = getSectionColor(section.type);
                const sectionGrandTotal = sectionTotals.monthly + sectionTotals.yearly;

                return (
                  <React.Fragment key={section.type}>
                    {/* Section Header */}
                    <tr
                      className={`section-row section-${section.type}`}
                      style={{ '--section-color': sectionColor } as React.CSSProperties}
                    >
                      <td className="category-cell sticky-col section-name" onClick={() => toggleSection(section.type)}>
                        <span className={`chevron ${!isExpanded ? 'collapsed' : ''}`}>▼</span>
                        {section.name}
                      </td>
                      <td className="actions-cell"></td>
                      <td className="annual-total">{formatCurrency(sectionGrandTotal, true)}</td>
                      <td className="yearly-budget-total">{formatCurrency(sectionYearlyBudget)}</td>
                      <td className="remaining-budget-total">{formatCurrency(sectionRemainingBudget)}</td>
                      {sectionMonthlyTotals.map((total, i) => (
                        <td key={i} className="month-total">
                          {formatCurrency(total)}
                        </td>
                      ))}
                    </tr>

                    {/* Groups and Items */}
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
                        const groupRemainingBudget = group.items.reduce((total, item) => {
                          const yearlyBudget = item.yearlyBudget || 0;
                          if (yearlyBudget === 0) return total;
                          const actualSpent = item.months.reduce((sum, m) => sum + m.actual, 0);
                          return total + (yearlyBudget - actualSpent);
                        }, 0);
                        const groupGrandTotal = groupMonthlyTotal + groupYearlyBudget;
                        const groupMonthlyTotals = Array(12)
                          .fill(0)
                          .map((_, i) => group.items.reduce((total, item) => total + (item.months[i]?.budget || 0), 0));

                        return (
                          <React.Fragment key={group.id}>
                            {/* Group Header */}
                            <tr className="group-row">
                              <td className="category-cell sticky-col group-name" onClick={() => toggleGroup(group.id)}>
                                <span className={`chevron ${!isGroupExpanded ? 'collapsed' : ''}`}>▼</span>
                                {group.name}
                              </td>
                              <td className="actions-cell"></td>
                              <td className="annual-total group-total">{formatCurrency(groupGrandTotal, true)}</td>
                              <td className="yearly-budget-total group-total">{formatCurrency(groupYearlyBudget)}</td>
                              <td className="remaining-budget-total group-total">
                                {formatCurrency(groupRemainingBudget)}
                              </td>
                              {groupMonthlyTotals.map((total, i) => (
                                <td key={i} className="month-total group-total">
                                  {formatCurrency(total)}
                                </td>
                              ))}
                            </tr>

                            {/* Items */}
                            {isGroupExpanded &&
                              group.items.map((item) => {
                                const itemMonthlyTotal = item.months.reduce((m, v) => m + v.budget, 0);
                                const itemGrandTotal = itemMonthlyTotal + (item.yearlyBudget || 0);
                                const itemActualSpent = item.months.reduce((sum, m) => sum + m.actual, 0);
                                const itemYearlyBudget = item.yearlyBudget || 0;
                                const itemRemainingBudget =
                                  itemYearlyBudget > 0 ? itemYearlyBudget - itemActualSpent : 0;
                                const itemRemainingPercent =
                                  itemYearlyBudget > 0 ? Math.round((itemRemainingBudget / itemYearlyBudget) * 100) : 0;
                                const isQuickFilling = quickFillItemId === item.id;
                                const isEditingYearly = editingYearlyBudget === item.id;

                                // Color class based on remaining budget percentage
                                let remainingColorClass = '';
                                if (itemYearlyBudget > 0) {
                                  if (itemRemainingPercent > 50) {
                                    remainingColorClass = 'healthy';
                                  } else if (itemRemainingPercent >= 20) {
                                    remainingColorClass = 'warning';
                                  } else {
                                    remainingColorClass = 'critical';
                                  }
                                }

                                return (
                                  <tr key={item.id} className="item-row">
                                    <td className="category-cell sticky-col item-name">{item.name}</td>
                                    <td className="actions-cell">
                                      {isQuickFilling ? (
                                        <div className="quick-fill-inline">
                                          <button
                                            className="btn-icon cancel"
                                            onClick={() => setQuickFillItemId(null)}
                                            title="Annuler"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          className="btn-icon quick-fill"
                                          onClick={() => {
                                            setQuickFillItemId(item.id);
                                            // Pre-fill with current first non-zero value or empty
                                            const firstNonZero = item.months.find((m) => m.budget > 0);
                                            setQuickFillValue(firstNonZero ? firstNonZero.budget.toString() : '');
                                          }}
                                          title="Remplissage rapide"
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
                                          disabled={saving}
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
                                    <td className={`remaining-budget-cell ${remainingColorClass}`}>
                                      {itemYearlyBudget > 0 ? (
                                        <div className="remaining-content">
                                          <span className="remaining-percent-badge">{itemRemainingPercent}%</span>
                                          <span className="remaining-amount">
                                            {formatCurrency(itemRemainingBudget)}
                                          </span>
                                        </div>
                                      ) : (
                                        '–'
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
                                              disabled={saving}
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
              <h3>Remplissage rapide</h3>
              <button className="btn-close" onClick={() => setQuickFillItemId(null)}>
                ✕
              </button>
            </div>
            <div className="quick-fill-body">
              <div className="quick-fill-amount">
                <label>Montant mensuel</label>
                <input
                  type="number"
                  value={quickFillValue}
                  onChange={(e) => setQuickFillValue(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="quick-fill-months">
                <label>Mois concernés</label>
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
                    Tous
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set())}>
                    Aucun
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set([1, 2, 3, 4, 5, 6]))}>
                    S1
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set([7, 8, 9, 10, 11, 12]))}>
                    S2
                  </button>
                  <button className="preset-btn" onClick={() => setQuickFillMonths(new Set([1, 4, 7, 10]))}>
                    Trim.
                  </button>
                </div>
              </div>
            </div>
            <div className="quick-fill-footer">
              <button className="btn-secondary" onClick={() => setQuickFillItemId(null)}>
                Annuler
              </button>
              <button
                className="btn-primary"
                onClick={() => handleQuickFill(quickFillItemId)}
                disabled={saving || !quickFillValue || quickFillMonths.size === 0}
              >
                {saving ? 'Application...' : 'Appliquer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
