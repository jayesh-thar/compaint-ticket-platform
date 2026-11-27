import { EventEmitter } from 'node:events';

/**
 * In-process event bus for live updates (D-27). Services call `publish` AFTER
 * their transaction committed; the SSE endpoint forwards events to the
 * browsers of that organization, which then refetch what they show.
 * Events carry no ticket content - only "what kind of thing changed".
 */

export type LiveEventKind = 'tickets' | 'structure';
export interface LiveEvent {
  kind: LiveEventKind;
  at: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open browser tab

export const publish = (organizationId: string, kind: LiveEventKind) => {
  bus.emit(organizationId, { kind, at: new Date().toISOString() } satisfies LiveEvent);
};

export const subscribe = (organizationId: string, listener: (e: LiveEvent) => void) => {
  bus.on(organizationId, listener);
  return () => {
    bus.off(organizationId, listener);
  };
};
