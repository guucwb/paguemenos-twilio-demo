import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../config';
import { logger, maskPhone } from '../logger';
import { buildSummary, buildNextBestAction, EscalationContext } from '../core/engine';

const router = Router();

function getTwilioClient() {
  return twilio(config.twilio.accountSid, config.twilio.authToken);
}

/**
 * POST /api/flex/escalate
 *
 * Cria uma Task no Flex TaskRouter na fila "Farmacia_Demo".
 * Chamado tanto pelo ConversationRelay handler (voz) quanto pelo Studio (texto).
 *
 * Body:
 * {
 *   channel: "whatsapp_call" | "whatsapp_text",
 *   phoneNumber: string,
 *   authStatus: "pending" | "approved" | "failed",
 *   authChannel: "whatsapp" | "sms",
 *   authAttempts: number,
 *   orderId?: string,
 *   issueType?: string,
 *   summary?: string,
 *   handoffReason?: string,
 *   nextBestAction?: string,
 * }
 */
router.post('/api/flex/escalate', async (req: Request, res: Response) => {
  const {
    channel,
    phoneNumber,
    authStatus,
    authChannel,
    authAttempts,
    orderId,
    issueType,
    handoffReason,
  } = req.body as {
    channel: 'whatsapp_call' | 'whatsapp_text';
    phoneNumber: string;
    authStatus: 'pending' | 'approved' | 'failed';
    authChannel: 'whatsapp' | 'sms';
    authAttempts: number;
    orderId?: string;
    issueType?: string;
    handoffReason?: string;
  };

  if (!phoneNumber || !channel) {
    return res.status(400).json({ error: 'phoneNumber e channel são obrigatórios' });
  }

  const ctx: EscalationContext = {
    channel,
    phoneNumber,
    authStatus,
    authChannel: authChannel ?? 'whatsapp',
    authAttempts: authAttempts ?? 0,
    orderId,
    issueType: issueType as EscalationContext['issueType'],
    postAuthTurns: 0,
    misunderstandCount: 0,
    handoffReason,
  };

  const summary = req.body.summary ?? buildSummary(ctx);
  const nextBestAction = req.body.nextBestAction ?? buildNextBestAction(ctx);

  const taskAttributes = {
    channel,
    customerPhone: maskPhone(phoneNumber), // PII mascarado nos atributos públicos
    customerPhoneFull: phoneNumber,         // campo para o agente (separado)
    authStatus,
    authChannel,
    authAttempts,
    orderId: orderId ?? null,
    issueType: issueType ?? null,
    handoffReason: handoffReason ?? 'agent_request',
    summary,
    nextBestAction,
    taskType: 'farmacia_demo',
    // Para Flex UI — exibe no painel do agente
    name: `PagueMenos — ${maskPhone(phoneNumber)}`,
    from: phoneNumber,
  };

  const workspaceSid = config.twilio.flexWorkspaceSid;
  const workflowSid = config.twilio.flexWorkflowSid;

  if (!workspaceSid || !workflowSid) {
    logger.warn('flex_config_missing', { workspaceSid: !!workspaceSid, workflowSid: !!workflowSid });
    // Em ambiente de dev/demo sem Flex configurado: retorna mock
    const mockTaskSid = `TASK_MOCK_${Date.now()}`;
    logger.info('escalated', {
      phone: maskPhone(phoneNumber),
      channel,
      issueType,
      handoffReason,
      taskSid: mockTaskSid,
      mock: true,
    });
    return res.json({ taskSid: mockTaskSid, mock: true });
  }

  try {
    const client = getTwilioClient();
    const task = await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks.create({
        workflowSid,
        taskChannel: channel === 'whatsapp_call' ? 'voice' : 'chat',
        attributes: JSON.stringify(taskAttributes),
        priority: handoffReason === 'urgency_detected' ? 10 : 5,
        timeout: 3600,
      });

    logger.info('escalated', {
      phone: maskPhone(phoneNumber),
      channel,
      issueType,
      handoffReason,
      taskSid: task.sid,
    });

    return res.json({ taskSid: task.sid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('flex_escalate_error', { error: message, phone: maskPhone(phoneNumber) });
    return res.status(500).json({ error: 'Erro ao criar task no Flex', detail: message });
  }
});

export default router;
