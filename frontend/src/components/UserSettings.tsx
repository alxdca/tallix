import React, { type FormEvent, useMemo, useState } from 'react';
import { type AccessibleBudget, changePassword, updateUserSettings } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { getErrorMessage } from '../utils/errorMessages';
import { logger } from '../utils/logger';
import ConfirmDialog from './ConfirmDialog';

const COUNTRY_LIST = ['', 'CH', 'FR', 'DE', 'IT', 'AT', 'BE', 'NL', 'LU', 'ES', 'PT', 'GB', 'US', 'CA'];

function sortedBudgetYears(years: number[]) {
  return [...years].sort((a, b) => a - b);
}

function nextBudgetYear(years: number[]) {
  const sortedYears = sortedBudgetYears(years);
  const nextYear = sortedYears.length > 0 ? Math.max(...sortedYears) + 1 : new Date().getFullYear() + 1;
  return String(Math.min(nextYear, 9999));
}

interface UserSettingsProps {
  budgets: AccessibleBudget[];
  activeBudgetId: number | null;
  onCreateBudget: (year: number, description: string, parentBudgetId: number | null) => Promise<void>;
  onCreateYear: (year: number) => Promise<void>;
  onDeleteBudget: (budgetId: number) => Promise<void>;
}

export default function UserSettings({
  budgets,
  activeBudgetId,
  onCreateBudget,
  onCreateYear,
  onDeleteBudget,
}: UserSettingsProps) {
  const { user, updateUser } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const [language, setLanguage] = useState(user?.language || 'fr');
  const [country, setCountry] = useState(user?.country || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [budgetToDelete, setBudgetToDelete] = useState<AccessibleBudget | null>(null);
  const [deletingBudgetId, setDeletingBudgetId] = useState<number | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSuccess, setBudgetSuccess] = useState<string | null>(null);
  const [newBudgetYear, setNewBudgetYear] = useState(String(new Date().getFullYear()));
  const [newBudgetDescription, setNewBudgetDescription] = useState('');
  const [isCreatingBudget, setIsCreatingBudget] = useState(false);
  const [createBudgetError, setCreateBudgetError] = useState<string | null>(null);
  const [newYear, setNewYear] = useState('');
  const [isCreatingYear, setIsCreatingYear] = useState(false);
  const [createYearError, setCreateYearError] = useState<string | null>(null);
  const ownedBudgets = budgets
    .filter((budget) => budget.role === 'owner')
    .sort((a, b) => budgetName(a).localeCompare(budgetName(b)) || a.id - b.id);
  const activeBudget = budgets.find((budget) => budget.id === activeBudgetId) ?? null;
  const canAddYear = activeBudget?.role === 'owner' || activeBudget?.role === 'write';
  const nextYearForActiveBudget = nextBudgetYear(activeBudget?.years ?? []);

  function budgetName(budget: AccessibleBudget) {
    return budget.description || t('userSettings.unnamedBudget', { id: budget.id });
  }

  const budgetLabel = (budget: AccessibleBudget) =>
    `${budgetName(budget)} — ${sortedBudgetYears(budget.years).join(', ')}`;

  const languageOptions = useMemo(
    () => [
      { code: 'en', label: t('language.en') },
      { code: 'fr', label: t('language.fr') },
    ],
    [t]
  );

  const countryLabels = useMemo(() => {
    try {
      const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
      return COUNTRY_LIST.map((code) => ({
        code,
        label: code ? displayNames.of(code) || code : t('countries.none'),
      }));
    } catch {
      return COUNTRY_LIST.map((code) => ({ code, label: code || t('countries.none') }));
    }
  }, [locale, t]);

  // Update local state when user changes
  React.useEffect(() => {
    if (user) {
      setLanguage(user.language || 'fr');
      setCountry(user.country || '');
    }
  }, [user]);

  React.useEffect(() => {
    setNewYear(nextYearForActiveBudget);
    setCreateYearError(null);
  }, [nextYearForActiveBudget]);

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setError(null);
    try {
      const updatedUser = await updateUserSettings({
        language,
        country,
      });
      updateUser({
        language: updatedUser.language,
        country: updatedUser.country,
      });
      if (updatedUser.language === 'en' || updatedUser.language === 'fr') {
        setLocale(updatedUser.language);
      }
      setSuccess(t('userSettings.settingsUpdated'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      logger.error('Failed to update settings', err);
      setError(getErrorMessage(err, t));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError(t('userSettings.passwordMismatch'));
      return;
    }

    if (newPassword.length < 6) {
      setError(t('userSettings.passwordMinLength'));
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(t('userSettings.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      logger.error('Failed to change password', err);
      setError(getErrorMessage(err, t));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBudget = async () => {
    if (!budgetToDelete || deletingBudgetId !== null) return;
    const budget = budgetToDelete;
    setBudgetToDelete(null);
    setDeletingBudgetId(budget.id);
    setBudgetError(null);
    setBudgetSuccess(null);
    try {
      await onDeleteBudget(budget.id);
      setBudgetSuccess(t('userSettings.budgetDeleted', { budget: budgetLabel(budget) }));
    } catch (err) {
      logger.error('Failed to delete budget', err);
      setBudgetError(getErrorMessage(err, t));
    } finally {
      setDeletingBudgetId(null);
    }
  };

  const handleCreateBudget = async (event: FormEvent) => {
    event.preventDefault();
    if (isCreatingBudget) return;
    const year = Number(newBudgetYear);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      setCreateBudgetError(t('sharing.invalidYear'));
      return;
    }

    setCreateBudgetError(null);
    setIsCreatingBudget(true);
    try {
      await onCreateBudget(year, newBudgetDescription.trim(), null);
      setNewBudgetDescription('');
    } catch (err) {
      logger.error('Failed to create budget', err);
      setCreateBudgetError(getErrorMessage(err, t));
    } finally {
      setIsCreatingBudget(false);
    }
  };

  const handleCreateYear = async (event: FormEvent) => {
    event.preventDefault();
    if (isCreatingYear || !activeBudget || !canAddYear) return;
    const year = Number(newYear);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      setCreateYearError(t('sharing.invalidYear'));
      return;
    }
    if (activeBudget.years.includes(year)) {
      setCreateYearError(t('userSettings.yearAlreadyExists', { year }));
      return;
    }

    setCreateYearError(null);
    setIsCreatingYear(true);
    try {
      await onCreateYear(year);
      setNewYear(String(Math.min(year + 1, 9999)));
    } catch (err) {
      logger.error('Failed to add budget year', err);
      setCreateYearError(getErrorMessage(err, t));
    } finally {
      setIsCreatingYear(false);
    }
  };

  return (
    <div className="user-settings-container">
      <div className="user-settings-header">
        <h2>{t('userSettings.title')}</h2>
        <p className="user-settings-subtitle">{t('userSettings.subtitle')}</p>
      </div>

      <div className="user-settings-content">
        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            {t('userSettings.info')}
          </h3>
          <div className="user-info-card">
            <div className="user-info-row">
              <span className="user-info-label">{t('userSettings.email')}</span>
              <span className="user-info-value">{user?.email}</span>
            </div>
            {user?.name && (
              <div className="user-info-row">
                <span className="user-info-label">{t('userSettings.name')}</span>
                <span className="user-info-value">{user.name}</span>
              </div>
            )}
            <div className="user-info-row">
              <span className="user-info-label">{t('userSettings.language')}</span>
              <select
                className="language-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isSavingSettings}
              >
                {languageOptions.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="user-info-row">
              <span className="user-info-label">{t('userSettings.country')}</span>
              <select
                className="language-select"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={isSavingSettings}
              >
                {countryLabels.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ display: 'flex', margin: '20px auto 0', padding: '12px 32px' }}
            onClick={handleSaveSettings}
            disabled={isSavingSettings}
          >
            {isSavingSettings ? t('userSettings.saving') : t('userSettings.saveChanges')}
          </button>
        </div>

        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            {t('userSettings.passwordTitle')}
          </h3>
          <form onSubmit={handleChangePassword} className="password-form">
            {error && <div className="form-error">{error}</div>}
            {success && <div className="form-success">{success}</div>}
            <div className="form-group">
              <label htmlFor="currentPassword">{t('userSettings.currentPassword')}</label>
              <input
                type="password"
                id="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPassword">{t('userSettings.newPassword')}</label>
              <input
                type="password"
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isSubmitting}
                minLength={6}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">{t('userSettings.confirmNewPassword')}</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isSubmitting}
                minLength={6}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? t('userSettings.changing') : t('userSettings.changePassword')}
            </button>
          </form>
        </div>

        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            {t('sharing.createBudget')}
          </h3>
          <p className="user-settings-budget-help">{t('userSettings.createBudgetHelp')}</p>
          <form className="password-form user-settings-create-form" onSubmit={handleCreateBudget}>
            <div className="form-group">
              <label htmlFor="new-budget-year">{t('userSettings.initialYear')}</label>
              <input
                id="new-budget-year"
                type="number"
                required
                min="1900"
                max="9999"
                step="1"
                value={newBudgetYear}
                onChange={(event) => {
                  setNewBudgetYear(event.target.value);
                  setCreateBudgetError(null);
                }}
                disabled={isCreatingBudget}
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-budget-description">{t('sharing.description')}</label>
              <input
                id="new-budget-description"
                type="text"
                maxLength={255}
                placeholder={t('sharing.descriptionPlaceholder')}
                value={newBudgetDescription}
                onChange={(event) => {
                  setNewBudgetDescription(event.target.value);
                  setCreateBudgetError(null);
                }}
                disabled={isCreatingBudget}
              />
            </div>
            {createBudgetError && (
              <p className="form-error" role="alert">
                {createBudgetError}
              </p>
            )}
            <button type="submit" className="btn-primary" disabled={isCreatingBudget}>
              {t(isCreatingBudget ? 'common.saving' : 'sharing.createBudget')}
            </button>
          </form>
        </div>

        {activeBudget && canAddYear && (
          <div className="user-settings-section">
            <h3 className="section-title">
              <span className="section-indicator"></span>
              {t('userSettings.addYearTitle')}
            </h3>
            <p className="user-settings-budget-help">
              {t('userSettings.addYearHelp', { budget: budgetName(activeBudget) })}
            </p>
            <form className="password-form user-settings-add-year-form" onSubmit={handleCreateYear}>
              <div className="form-group">
                <label htmlFor="new-budget-year-only">{t('sharing.year')}</label>
                <input
                  id="new-budget-year-only"
                  type="number"
                  required
                  min="1900"
                  max="9999"
                  step="1"
                  value={newYear}
                  onChange={(event) => {
                    setNewYear(event.target.value);
                    setCreateYearError(null);
                  }}
                  disabled={isCreatingYear}
                />
              </div>
              {createYearError && (
                <p className="form-error" role="alert">
                  {createYearError}
                </p>
              )}
              <button type="submit" className="btn-primary" disabled={isCreatingYear}>
                {t(isCreatingYear ? 'userSettings.addingYear' : 'userSettings.addYear')}
              </button>
            </form>
          </div>
        )}

        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            {t('userSettings.budgetsTitle')}
          </h3>
          <p className="user-settings-budget-help">{t('userSettings.budgetsHelp')}</p>
          {budgetError && (
            <div className="form-error" role="alert">
              {budgetError}
            </div>
          )}
          {budgetSuccess && (
            <div className="form-success" role="status">
              {budgetSuccess}
            </div>
          )}
          {ownedBudgets.length === 0 && <p>{t('userSettings.noOwnedBudgets')}</p>}
          <ul className="user-settings-budget-list">
            {ownedBudgets.map((budget) => (
              <li key={budget.id} className="user-settings-budget-row">
                <div className="user-settings-budget-details">
                  <span className="user-info-value">{budgetLabel(budget)}</span>
                  {budget.id === activeBudgetId && (
                    <span className="user-settings-budget-current">{t('userSettings.currentBudget')}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-danger"
                  aria-label={t('userSettings.deleteBudgetLabel', { budget: budgetLabel(budget) })}
                  disabled={deletingBudgetId !== null}
                  onClick={() => setBudgetToDelete(budget)}
                >
                  {t(deletingBudgetId === budget.id ? 'userSettings.deletingBudget' : 'common.delete')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <ConfirmDialog
        isOpen={budgetToDelete !== null}
        title={t('userSettings.deleteBudgetTitle')}
        message={
          budgetToDelete
            ? t('userSettings.deleteBudgetConfirm', { budget: budgetLabel(budgetToDelete) }) +
              (ownedBudgets.length === 1 ? ` ${t('userSettings.lastBudgetWarning')}` : '')
            : ''
        }
        confirmLabel={t('userSettings.deleteBudgetTitle')}
        onConfirm={handleDeleteBudget}
        onCancel={() => setBudgetToDelete(null)}
      />
    </div>
  );
}
