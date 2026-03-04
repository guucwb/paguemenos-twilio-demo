import { config } from './config';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// ── PII masking ──────────────────────────────────────────────────────────────

/** Mascara telefone: mostra apenas últimos 4 dígitos. Ex.: ****-1234 */
export function maskPhone(phone: string): string {
  if (!phone) return '****';
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `****-${last4}`;
}

/** Remove tokens/códigos de verificação de strings */
function redactToken(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // Redacta sequências numéricas de 6 dígitos (códigos OTP)
  return value.replace(/\b\d{6}\b/g, '[REDACTED]');
}

/** Sanitiza objeto removendo campos sensíveis */
function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (['token', 'code', 'password', 'authToken', 'auth_token'].includes(key)) {
      safe[key] = '[REDACTED]';
    } else if (typeof val === 'string' && /phone|numero|telefone/i.test(key)) {
      safe[key] = maskPhone(val);
    } else {
      safe[key] = redactToken(val);
    }
  }
  return safe;
}

// ── Logger ───────────────────────────────────────────────────────────────────

function log(level: LogLevel, event: string, meta: Record<string, unknown> = {}): void {
  const ts = new Date().toISOString();
  const sanitized = sanitize(meta);
  const line = JSON.stringify({ ts, level, event, ...sanitized });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else if (level === 'debug' && !config.isDev) {
    // Silencia debug em produção
    return;
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (event: string, meta: Record<string, unknown> = {}) => log('info', event, meta),
  warn: (event: string, meta: Record<string, unknown> = {}) => log('warn', event, meta),
  error: (event: string, meta: Record<string, unknown> = {}) => log('error', event, meta),
  debug: (event: string, meta: Record<string, unknown> = {}) => log('debug', event, meta),
};
