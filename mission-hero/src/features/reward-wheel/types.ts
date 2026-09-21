import type { IneligibleReason } from '@/domain/wheel';

export interface WheelSegmentView {
  id: string;
  label: string;
  iconKey: string;
  colorKey: string;
  segmentIndex: number;
}

export interface WheelView {
  wheelId: string;
  name: string;
  segments: WheelSegmentView[];
  pointThreshold: number;
  deductPoints: boolean;
  pointsCost: number;
  balance: number;
  eligible: boolean;
  reason: IneligibleReason | null;
  pointsNeeded: number;
  availableAt: Date | null;
  spinsToday: number;
  spinsPerDay: number;
}

/**
 * The result of a spin, decided and persisted by the server before the wheel
 * starts turning. `segmentIndex` is where the animation must land (BR-46).
 */
export interface SpinResult {
  spinId: string;
  segmentIndex: string | number;
  label: string;
  iconKey: string;
  pointsSpent: number;
  balanceAfter: number;
}
