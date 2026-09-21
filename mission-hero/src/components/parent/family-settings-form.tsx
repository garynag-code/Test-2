'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { NumberRow, ToggleRow } from '@/components/parent/toggle-row';
import { updateFamilySettingsAction } from '@/features/families/actions';

interface Setting {
  mediaUploadsEnabled: boolean;
  photoEvidenceEnabled: boolean;
  voiceNotesEnabled: boolean;
  wheelEnabled: boolean;
  secretMissionsEnabled: boolean;
  hiddenObjectsEnabled: boolean;
  soundEnabled: boolean;
  characterVerificationRequired: boolean;
  characterXpPerStar: number;
  checkInXp: number;
  checkInPoints: number;
  weeklyGoalTarget: number;
  parentGateTimeoutMinutes: number;
}

export function FamilySettingsForm({ setting }: { setting: Setting }) {
  const [state, action] = useActionState(updateFamilySettingsAction, undefined);

  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold uppercase tracking-wide text-muted">
          Photos &amp; voice
        </legend>
        <ToggleRow
          name="mediaUploadsEnabled"
          label="Allow photos and voice notes"
          hint="Off by default. With this off, missions asking for a photo fall back to a written note."
          defaultChecked={setting.mediaUploadsEnabled}
        />
        <ToggleRow
          name="photoEvidenceEnabled"
          label="Photo evidence"
          hint="Only takes effect while the switch above is on."
          defaultChecked={setting.photoEvidenceEnabled}
        />
        <ToggleRow
          name="voiceNotesEnabled"
          label="Voice notes"
          defaultChecked={setting.voiceNotesEnabled}
        />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold uppercase tracking-wide text-muted">Features</legend>
        <ToggleRow
          name="wheelEnabled"
          label="Reward wheel"
          hint="Pausing hides it entirely; nothing already won is affected."
          defaultChecked={setting.wheelEnabled}
        />
        <ToggleRow
          name="secretMissionsEnabled"
          label="Secret missions"
          defaultChecked={setting.secretMissionsEnabled}
        />
        <ToggleRow
          name="hiddenObjectsEnabled"
          label="Hidden objects"
          hint="The little things children find around the app."
          defaultChecked={setting.hiddenObjectsEnabled}
        />
        <ToggleRow name="soundEnabled" label="Sound" defaultChecked={setting.soundEnabled} />
        <ToggleRow
          name="characterVerificationRequired"
          label="Character moments need your confirmation"
          hint="Strongly recommended. With this off, a child's claim awards a star on its own."
          defaultChecked={setting.characterVerificationRequired}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-bold uppercase tracking-wide text-muted">Values</legend>
        <NumberRow
          name="characterXpPerStar"
          label="XP alongside each character star"
          defaultValue={setting.characterXpPerStar}
          max={100}
        />
        <NumberRow
          name="checkInXp"
          label="XP for the daily check-in"
          defaultValue={setting.checkInXp}
          max={100}
        />
        <NumberRow
          name="checkInPoints"
          label="Reward points for the daily check-in"
          defaultValue={setting.checkInPoints}
          max={100}
        />
        <NumberRow
          name="weeklyGoalTarget"
          label="Weekly goal"
          hint="Used only when no missions are scheduled — otherwise the bar fills to what is actually due."
          defaultValue={setting.weeklyGoalTarget}
          min={1}
          max={200}
        />
        <NumberRow
          name="parentGateTimeoutMinutes"
          label="Ask for your password again after (minutes)"
          defaultValue={setting.parentGateTimeoutMinutes}
          min={1}
          max={1440}
        />
      </fieldset>

      {state?.error ? (
        <p
          role="alert"
          className="rounded-xl2 bg-star/10 px-4 py-3 text-sm font-semibold text-star"
        >
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p
          role="status"
          className="rounded-xl2 bg-success/10 px-4 py-3 text-sm font-semibold text-success"
        >
          Settings saved.
        </p>
      ) : null}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? 'Saving…' : 'Save settings'}
    </Button>
  );
}
