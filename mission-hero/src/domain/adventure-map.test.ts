import { describe, expect, it } from 'vitest';
import { buildAdventurePath } from './adventure-map';

describe('buildAdventurePath', () => {
  it('always puts a child who has started on the map', () => {
    const path = buildAdventurePath(0, 20);
    expect(path.stops[0]!.reached).toBe(true);
    expect(path.stops[0]!.current).toBe(true);
    expect(path.progress).toBe(0);
  });

  it('moves along the landmarks as missions are approved', () => {
    const path = buildAdventurePath(10, 20);
    const reached = path.stops.filter((stop) => stop.reached);
    expect(reached.length).toBeGreaterThan(1);
    expect(reached.length).toBeLessThan(path.stops.length);
    expect(path.progress).toBeCloseTo(0.5);
  });

  it('reaches the treasure at the end of the week', () => {
    const path = buildAdventurePath(20, 20);
    expect(path.stops.every((stop) => stop.reached)).toBe(true);
    expect(path.stops[path.stops.length - 1]!.name).toBe('Treasure');
    expect(path.nextStopName).toBeNull();
    expect(path.stepsToNextStop).toBe(0);
  });

  it('marks exactly one stop as current', () => {
    for (const steps of [0, 3, 7, 12, 20]) {
      const path = buildAdventurePath(steps, 20);
      expect(path.stops.filter((stop) => stop.current)).toHaveLength(1);
    }
  });

  it('names the next landmark and how far it is', () => {
    // Eight landmarks over 21 missions puts one every three steps.
    const path = buildAdventurePath(1, 21);
    expect(path.nextStopName).toBe('Meadow');
    expect(path.stepsToNextStop).toBe(2);

    const further = buildAdventurePath(4, 21);
    expect(further.nextStopName).toBe('Forest');
    expect(further.stepsToNextStop).toBe(2);
  });

  it('never runs past the end of the path or below the start', () => {
    expect(buildAdventurePath(99, 20).progress).toBe(1);
    expect(buildAdventurePath(-5, 20).steps).toBe(0);
    expect(buildAdventurePath(-5, 20).progress).toBe(0);
  });

  it('survives a zero or negative target without dividing by zero', () => {
    expect(buildAdventurePath(0, 0).totalSteps).toBe(1);
    expect(Number.isFinite(buildAdventurePath(3, -2).progress)).toBe(true);
  });

  it('is monotonic: more missions never move a child backwards', () => {
    let previous = -1;
    for (let steps = 0; steps <= 25; steps += 1) {
      const reached = buildAdventurePath(steps, 25).stops.filter((s) => s.reached).length;
      expect(reached).toBeGreaterThanOrEqual(previous);
      previous = reached;
    }
  });
});
