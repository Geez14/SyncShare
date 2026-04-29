type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeLevel(value: string | undefined): LogLevel {
  const next = (value || '').toLowerCase();
  if (next === 'debug' || next === 'info' || next === 'warn' || next === 'error') {
    return next;
  }
  return 'info';
}

const minimumLevel = normalizeLevel(process.env.LOG_LEVEL);

function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (levelOrder[level] < levelOrder[minimumLevel]) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, serializeError(v)])) : {})
  };

  const line = `${JSON.stringify(payload)}\n`;
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta)
};
