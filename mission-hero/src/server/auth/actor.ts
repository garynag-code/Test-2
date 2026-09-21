/**
 * The actor model (docs/03 §2).
 *
 * Services take an Actor rather than reading cookies, which is what makes the
 * whole authorization test list expressible without spinning up HTTP.
 */

export interface ParentActor {
  type: 'parent';
  userId: string;
  familyId: string;
  role: 'OWNER' | 'PARENT' | 'GUARDIAN';
  /** When the parent last fully authenticated — drives the Parent Gate. */
  authenticatedAt: Date;
}

export interface ChildActor {
  type: 'child';
  childId: string;
  familyId: string;
}

/** Seeds, migrations and opt-in auto-approval. Never reachable from HTTP. */
export interface SystemActor {
  type: 'system';
  familyId: string;
}

export type Actor = ParentActor | ChildActor | SystemActor;

export const isParent = (actor: Actor): actor is ParentActor => actor.type === 'parent';
export const isChild = (actor: Actor): actor is ChildActor => actor.type === 'child';
export const isSystem = (actor: Actor): actor is SystemActor => actor.type === 'system';

/** Who to record in an audit row for this actor. */
export function auditActor(actor: Actor): {
  actorType: 'PARENT' | 'CHILD' | 'SYSTEM';
  actorUserId: string | null;
  actorChildId: string | null;
} {
  switch (actor.type) {
    case 'parent':
      return { actorType: 'PARENT', actorUserId: actor.userId, actorChildId: null };
    case 'child':
      return { actorType: 'CHILD', actorUserId: null, actorChildId: actor.childId };
    case 'system':
      return { actorType: 'SYSTEM', actorUserId: null, actorChildId: null };
  }
}

export function systemActor(familyId: string): SystemActor {
  return { type: 'system', familyId };
}
