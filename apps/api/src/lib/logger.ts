const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Structured single-line JSON logging. Enough to be greppable and to survive a container log
 * driver, without taking on a logging framework for an application this size.
 */
export function createLogger(level: LogLevel = 'info'): Logger {
  const threshold = LEVELS[level];

  function write(logLevel: Exclude<LogLevel, 'silent'>, message: string, meta?: Record<string, unknown>): void {
    if (LEVELS[logLevel] < threshold) return;
    const line = JSON.stringify({
      level: logLevel,
      time: new Date().toISOString(),
      message,
      ...meta,
    });
    if (logLevel === 'error' || logLevel === 'warn') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}
