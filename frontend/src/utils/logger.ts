/**
 * Simple frontend logger utility
 * In production, this could be extended to send errors to a monitoring service
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const isDev = import.meta.env.DEV;

function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (isDev) {
      console.debug(formatMessage('debug', message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    if (isDev) {
      console.info(formatMessage('info', message, context));
    }
  },

  warn(message: string, context?: LogContext): void {
    console.warn(formatMessage('warn', message, context));
  },

  error(message: string, error?: unknown, context?: LogContext): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorContext = {
      ...context,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    };
    console.error(formatMessage('error', message, errorContext));
    
    // In production, you could send this to a monitoring service like Sentry
    // if (!isDev) {
    //   sendToMonitoringService({ message, error, context });
    // }
  },
};
