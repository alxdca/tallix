import React, { type FormEvent, useMemo, useState } from 'react';
import { type AccessibleBudget, changePassword, updateUserSettings } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { getErrorMessage } from '../utils/errorMessages';
import { logger } from '../utils/logger';
import ConfirmDialog from './ConfirmDialog';

const COUNTRY_LIST = ['', 'CH', 'FR', 'DE', 'IT', 'AT', 'BE', 'NL', 'LU', 'ES', 'PT', 'GB', 'US', 'CA'];

interface UserSettingsProps {
  budgets: AccessibleBudget[];
  activeBudgetId: number | null;
  onCreateBudget: (year: number, description: string, parentBudgetId: number | null) => Promise<void>;
  onDeleteBudget: (budgetId: number) => Promise<void>;
}

export default function UserSettings({ budgets, activeBudgetId, onCreateBudget, onDeleteBudget }: UserSettingsProps) {
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
  const [newBudgetYear, setNewBudgetYear] = useState(String(Math.min(new Date().getFullYear() + 1, 9999)));
  const [newBudgetDescription, setNewBudgetDescription] = useState('');
  const [parentBudgetId, setParentBudgetId] = useState('');
  const [isCreatingBudget, setIsCreatingBudget] = useState(false);
  const [createBudgetError, setCreateBudgetError] = useState<string | null>(null);
  const ownedBudgets = budgets
    .filter((budget) => budget.role === 'owner')
    .sort((a, b) => b.year - a.year || a.id - b.id);
  const eligibleParentBudgets = ownedBudgets.filter((budget) => budget.year < 9999);
  const budgetLabel = (budget: AccessibleBudget) =>
    `${budget.year} — ${budget.description || t('userSettings.unnamedBudget', { id: budget.id })}`;

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
    const parent = parentBudgetId ? eligibleParentBudgets.find((budget) => budget.id === Number(parentBudgetId)) : null;
    if (parentBudgetId && !parent) {
      setCreateBudgetError(t('userSettings.invalidParentBudget'));
      return;
    }
    if (parent && year !== parent.year + 1) {
      setCreateBudgetError(t('userSettings.parentYearMismatch', { year: parent.year + 1 }));
      return;
    }

    setCreateBudgetError(null);
    setIsCreatingBudget(true);
    try {
      await onCreateBudget(year, newBudgetDescription.trim(), parent?.id ?? null);
      setNewBudgetDescription('');
      setParentBudgetId('');
    } catch (err) {
      logger.error('Failed to create budget', err);
      setCreateBudgetError(getErrorMessage(err, t));
    } finally {
      setIsCreatingBudget(false);
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
              <label htmlFor="new-budget-parent">{t('userSettings.parentBudget')}</label>
              <select
                id="new-budget-parent"
                className="language-select"
                value={parentBudgetId}
                onChange={(event) => {
                  const id = event.target.value;
                  setParentBudgetId(id);
                  const parent = eligibleParentBudgets.find((budget) => budget.id === Number(id));
                  if (parent) setNewBudgetYear(String(parent.year + 1));
                  setCreateBudgetError(null);
                }}
                disabled={isCreatingBudget}
              >
                <option value="">{t('userSettings.noParentBudget')}</option>
                {eligibleParentBudgets.map((budget) => (
                  <option key={budget.id} value={budget.id}>
                    {budgetLabel(budget)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="new-budget-year">{t('sharing.newBudgetYear')}</label>
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
