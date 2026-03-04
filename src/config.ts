import path from 'path';

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.warn(`[config] AVISO: variável de ambiente ${key} não definida`);
    return '';
  }
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  // URLs públicas do backend (configuradas via env, sem trailing slash)
  baseUrl: optional('BASE_URL', 'http://localhost:3000'),
  wsPublicUrl: optional('WS_PUBLIC_URL', 'ws://localhost:3000/ws/conversationrelay'),

  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    verifyServiceSid: required('VERIFY_SERVICE_SID'),
    flexWorkspaceSid: required('FLEX_WORKSPACE_SID'),
    flexQueueSid: required('FLEX_QUEUE_SID'),
    flexWorkflowSid: required('FLEX_WORKFLOW_SID'),
    whatsappNumber: optional('TWILIO_WHATSAPP_NUMBER'),
    flexTransferNumber: optional('FLEX_TRANSFER_NUMBER'),
  },

  dataDir: path.resolve(process.cwd(), 'data'),

  isDev: optional('NODE_ENV', 'development') !== 'production',
} as const;
