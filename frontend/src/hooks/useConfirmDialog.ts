import { useState, useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
}

export function useConfirmDialog() {
  const { t } = useI18n();
  const defaultConfirmLabel = t('common.confirm');
  const defaultCancelLabel = t('common.cancel');
  const [state, setState] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: defaultConfirmLabel,
    cancelLabel: defaultCancelLabel,
    variant: 'danger',
    onConfirm: () => {},
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel || defaultConfirmLabel,
        cancelLabel: options.cancelLabel || defaultCancelLabel,
        variant: options.variant || 'danger',
        onConfirm: () => {
          setState((prev) => ({ ...prev, isOpen: false }));
          resolve(true);
        },
      });
    });
  }, [defaultConfirmLabel, defaultCancelLabel]);

  const cancel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return {
    dialogProps: {
      isOpen: state.isOpen,
      title: state.title,
      message: state.message,
      confirmLabel: state.confirmLabel,
      cancelLabel: state.cancelLabel,
      variant: state.variant,
      onConfirm: state.onConfirm,
      onCancel: cancel,
    },
    confirm,
  };
}
