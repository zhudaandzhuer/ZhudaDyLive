import type {
  CollectorEvent,
  CollectorStatus,
  StreamMessage,
  StreamObservations,
} from '@zhuda/contracts';
import type { IncomingMessage } from '@zhuda/core';

const limit = 100;

// Keep a bounded, in-memory view of this app session, without copying packet bodies to the UI.
export class ObservationJournal {
  private sequence = 0;
  private runId = '';
  private messages: StreamMessage[] = [];
  private events: CollectorEvent[] = [];
  private errors: CollectorEvent[] = [];
  private errorCount = 0;
  private previous: CollectorStatus | null = null;

  recordMessage(message: IncomingMessage, context: { runId: string; webId: string }) {
    if (context.runId !== this.runId) {
      this.runId = context.runId;
      this.messages = [];
    }
    this.messages.unshift({
      id: String(++this.sequence),
      receivedAt: new Date().toISOString(),
      webId: context.webId,
      method: message.method.slice(0, 160),
      messageId: message.messageId.slice(0, 64),
      bytes: message.payload.byteLength,
    });
    this.messages.length = Math.min(this.messages.length, limit);
  }

  recordStatus(status: CollectorStatus) {
    const previous = this.previous;
    if (
      !previous ||
      ['state', 'webId', 'loggedIn', 'message'].some(
        (key) => status[key as keyof CollectorStatus] !== previous[key as keyof CollectorStatus],
      )
    ) {
      const level =
        status.state === 'error' || /失败|无法/.test(status.message)
          ? 'error'
          : status.state === 'reconnecting'
            ? 'warning'
            : 'info';
      this.addEvent(status, level, status.message);
    }
    const addedErrors = status.parseErrors - (previous?.parseErrors ?? 0);
    if (addedErrors > 0) this.addEvent(status, 'error', `添加 ${addedErrors} 笔消息解析异常`);
    this.previous = { ...status };
  }

  private addEvent(status: CollectorStatus, level: CollectorEvent['level'], message: string) {
    const event: CollectorEvent = {
      id: String(++this.sequence),
      receivedAt: new Date().toISOString(),
      webId: status.webId,
      state: status.state,
      level,
      message,
    };
    this.events.unshift(event);
    this.events.length = Math.min(this.events.length, limit);
    if (level !== 'info') {
      this.errorCount++;
      this.errors.unshift(event);
      this.errors.length = Math.min(this.errors.length, limit);
    }
  }

  snapshot(runId: string): StreamObservations {
    return {
      runId,
      messages: runId === this.runId ? this.messages.slice() : [],
      events: this.events.slice(),
      errors: this.errors.slice(),
      errorCount: this.errorCount,
    };
  }
}
