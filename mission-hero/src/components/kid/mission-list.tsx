'use client';

import { MissionCard } from './mission-card';
import { submitCompletionAction } from '@/features/tasks/actions';
import type { MissionCard as Mission } from '@/features/tasks/types';

export function MissionList({ missions }: { missions: Mission[] }) {
  return (
    <ul className="space-y-3">
      {missions.map((mission) => (
        <MissionCard
          key={mission.occurrenceId}
          mission={mission}
          onDone={async (occurrenceId, evidenceText) => {
            await submitCompletionAction(occurrenceId, evidenceText);
          }}
        />
      ))}
    </ul>
  );
}
