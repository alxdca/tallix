import { ApiError } from '../api';

export function getErrorMessage(
  error: unknown,
  t: (key: string, params?: Record<string, any>) => string
): string {
  if (error instanceof ApiError) {
    if (error.code) {
      const translated = t(`errors.${error.code}`, error.params || {});
      if (translated !== `errors.${error.code}`) {
        return translated;
      }
    }
    return t('errors.UNKNOWN');
  }

  return t('errors.UNKNOWN');
}
