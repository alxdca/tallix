import React, { useState } from 'react';
import type { BudgetSection } from '../types';
import { formatCurrency, calculateAnnualTotals, calculateGroupTotals, calculateSectionTotals } from '../utils';

interface BudgetSpreadsheetProps {
  sections: BudgetSection[];
  months: string[];
}

export default function BudgetSpreadsheet({ sections, months }: BudgetSpreadsheetProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());

  const toggleSection = (sectionType: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionType)) {
        next.delete(sectionType);
      } else {
        next.add(sectionType);
      }
      return next;
    });
  };

  const toggleGroup = (groupId: number) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const getSectionColor = (type: string) => {
    switch (type) {
      case 'income': return '#10b981';
      case 'expense': return '#ef4444';
      case 'savings': return '#3b82f6';
      default: return '#64748b';
    }
  };

  return (
    <div className="spreadsheet-container">
      <div className="spreadsheet-wrapper">
        <table className="spreadsheet">
          <thead>
            <tr>
              <th className="col-category">Catégorie</th>
              <th className="col-annual" colSpan={2}>Annuel</th>
              {months.map(month => (
                <th key={month} className="col-month" colSpan={2}>{month}</th>
              ))}
            </tr>
            <tr className="sub-header">
              <th></th>
              <th className="budget">Budget</th>
              <th className="actual">Réel</th>
              {months.map(month => (
                <React.Fragment key={month}>
                  <th className="budget">B</th>
                  <th className="actual">R</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(section => {
              const sectionTotals = calculateSectionTotals(section.groups);
              const isCollapsed = collapsedSections.has(section.type);
              const color = getSectionColor(section.type);

              return (
                <React.Fragment key={section.type}>
                  {/* Section Header Row */}
                  <tr className="section-row" style={{ '--section-color': color } as React.CSSProperties}>
                    <td className="category-name section-name" onClick={() => toggleSection(section.type)}>
                      <span className={`chevron ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
                      {section.name}
                    </td>
                    <td className="cell budget">{formatCurrency(sectionTotals.annual.budget, true)}</td>
                    <td className="cell actual">{formatCurrency(sectionTotals.annual.actual, true)}</td>
                    {sectionTotals.months.map((m, i) => (
                      <React.Fragment key={i}>
                        <td className="cell budget">{formatCurrency(m.budget)}</td>
                        <td className="cell actual">{formatCurrency(m.actual)}</td>
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* Groups and Items */}
                  {!isCollapsed && section.groups.map(group => {
                    const groupTotals = calculateGroupTotals(group.items);
                    const isGroupCollapsed = collapsedGroups.has(group.id);

                    return (
                      <React.Fragment key={group.id}>
                        {/* Group Row */}
                        <tr className="group-row">
                          <td className="category-name group-name" onClick={() => toggleGroup(group.id)}>
                            <span className={`chevron ${isGroupCollapsed ? 'collapsed' : ''}`}>▼</span>
                            {group.name}
                          </td>
                          <td className="cell budget">{formatCurrency(groupTotals.annual.budget, true)}</td>
                          <td className="cell actual">{formatCurrency(groupTotals.annual.actual, true)}</td>
                          {groupTotals.months.map((m, i) => (
                            <React.Fragment key={i}>
                              <td className="cell budget">{formatCurrency(m.budget)}</td>
                              <td className="cell actual">{formatCurrency(m.actual)}</td>
                            </React.Fragment>
                          ))}
                        </tr>

                        {/* Item Rows */}
                        {!isGroupCollapsed && group.items.map(item => {
                          const annual = calculateAnnualTotals(item.months);
                          return (
                            <tr key={item.id} className="item-row">
                              <td className="category-name item-name">{item.name}</td>
                              <td className="cell budget">{formatCurrency(annual.budget)}</td>
                              <td className="cell actual">{formatCurrency(annual.actual)}</td>
                              {item.months.map((m, i) => (
                                <React.Fragment key={i}>
                                  <td className="cell budget">{formatCurrency(m.budget)}</td>
                                  <td className="cell actual">{formatCurrency(m.actual)}</td>
                                </React.Fragment>
                              ))}
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
  );
}
