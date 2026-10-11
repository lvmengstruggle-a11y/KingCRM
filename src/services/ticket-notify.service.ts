import { execute } from '../support/db.js';
import { nextId } from '../support/id.js';

export interface TicketNotice {
  operation: string;
  receivers: string[];
  subject: string;
  content: string;
}

/** 事务提交后调用。失败只记日志，不影响工单。 */
export async function notifyTicket(input: {
  organizationId: string;
  ticketId: string;
  title: string;
  operatorId: string;
  notices: TicketNotice[];
}): Promise<void> {
  try {
    const now = Date.now();
    const sent = new Set<string>();
    for (const notice of input.notices) {
      for (const receiver of notice.receivers) {
        if (!receiver || receiver === 'public' || receiver === input.operatorId || sent.has(receiver)) {
          continue;
        }
        sent.add(receiver);
        await execute(
          `INSERT INTO sys_notification
            (id, type, receiver, subject, status, operator, operation, organization_id, resource_id, resource_type,
             resource_name, content, create_time, update_time, create_user, update_user)
           VALUES (?, 'TICKET', ?, ?, 'UNREAD', ?, ?, ?, ?, 'TICKET', ?, ?, ?, ?, ?, ?)`,
          [
            nextId(),
            receiver,
            notice.subject,
            input.operatorId,
            notice.operation,
            input.organizationId,
            input.ticketId,
            input.title,
            Buffer.from(JSON.stringify({ content: notice.content })),
            now,
            now,
            input.operatorId,
            input.operatorId,
          ],
        );
      }
    }
  } catch (error) {
    console.error('工单通知写入失败', error);
  }
}
