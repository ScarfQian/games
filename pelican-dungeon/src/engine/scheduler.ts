/*
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * TypeScript 移植：ScarfQian，2026-10-30。
 * 来源：SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0 / core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/actors/Actor.java
 */

export interface TimedActor { id: number; time: number; priority: number }
export const PRIORITY = { hero: 0, blob: -10, mob: -20, buff: -30 } as const;

export function nextActor<T extends TimedActor>(actors: readonly T[]): T | undefined {
  let next: T | undefined;
  for (const actor of actors) {
    if (!next || actor.time < next.time ||
      (actor.time === next.time && (actor.priority > next.priority ||
        (actor.priority === next.priority && actor.id < next.id)))) next = actor;
  }
  return next;
}

/** 与 spendConstant 保持相同的 float 加法及接近整回合时的修正。 */
export function spend(actor: TimedActor, amount: number): void {
  actor.time = Math.fround(actor.time + Math.fround(amount));
  if (Math.abs(actor.time % 1) < 0.001) actor.time = Math.floor(actor.time + 0.5);
}

