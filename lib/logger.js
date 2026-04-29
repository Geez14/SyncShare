const levelOrder = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeLevel(value) {
  const next = String(value || '').toLowerCase();
  if (next === 'debug' || next === 'info' || next === 'warn' || next === 'error') {
    return next;
  }
  return 'info';
}

const minimumLevel = normalizeLevel(process.env.LOG_LEVEL);

function serializeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function emit(level, message, meta) {
  if (levelOrder[level] < levelOrder[minimumLevel]) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta
      ? Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, serializeError(value)]))
      : {})
  };

  const line = `${JSON.stringify(payload)}\n`;
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

const logger = {
  debug: (message, meta) => emit('debug', message, meta),
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta)
};

module.exports = { logger };
