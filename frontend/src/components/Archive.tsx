import { useEffect, useState } from 'react';
import { type BudgetYear, fetchYears } from '../api';
import { useI18n } from '../contexts/I18nContext';
import { logger } from '../utils/logger';

interface ArchiveProps {
  selectedYear: number;
  onYearSelected: (year: number) => void;
}

export default function Archive({ selectedYear, onYearSelected }: ArchiveProps) {
  const { t } = useI18n();
  const [years, setYears] = useState<BudgetYear[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadYears = async () => {
      try {
        const data = await fetchYears();
        setYears(data);
      } catch (error) {
        logger.error('Failed to load years', error);
      } finally {
        setLoading(false);
      }
    };

    loadYears();
  }, []);

  if (loading) {
    return (
      <div className="content-loading">
        <div className="loading-spinner" />
        <p>{t('app.loading')}</p>
      </div>
    );
  }

  const currentYear = new Date().getFullYear();
  const pastYears = years.filter((y) => y.year < currentYear);
  const currentYearData = years.find((y) => y.year === currentYear);

  return (
    <div className="archive-container">
      <div className="archive-header">
        <h2>{t('archive.title')}</h2>
        <p>{t('archive.subtitle')}</p>
      </div>

      <div className="archive-content">
        {currentYearData && (
          <div className="archive-section">
            <h3 className="archive-section-title">{t('archive.currentYear')}</h3>
            <div className="years-grid">
              <button
                type="button"
                className={`year-card ${selectedYear === currentYearData.year ? 'selected' : ''}`}
                onClick={() => onYearSelected(currentYearData.year)}
              >
                <div className="year-card-year">{currentYearData.year}</div>
                <div className="year-card-label">{t('archive.current')}</div>
              </button>
            </div>
          </div>
        )}

        {pastYears.length > 0 && (
          <div className="archive-section">
            <h3 className="archive-section-title">{t('archive.pastYears')}</h3>
            <div className="years-grid">
              {pastYears
                .sort((a, b) => b.year - a.year)
                .map((yearData) => (
                  <button
                    key={yearData.id}
                    type="button"
                    className={`year-card ${selectedYear === yearData.year ? 'selected' : ''}`}
                    onClick={() => onYearSelected(yearData.year)}
                  >
                    <div className="year-card-year">{yearData.year}</div>
                  </button>
                ))}
            </div>
          </div>
        )}

        {years.length === 0 && (
          <div className="archive-empty">
            <p>{t('archive.noYears')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
