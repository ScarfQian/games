/*
 * Pixel Dungeon © 2012–2015 Oleg Dolya; Shattered Pixel Dungeon © 2014–2026 Evan Debenham.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * TypeScript 移植：ScarfQian，2026-10-30。
 * 来源：SPD v4.0.2 / 57a4e06a4caf162446d1c28caa7983f0493fecf0 / SPD-classes/src/main/java/com/watabou/utils/Random.java
 */

const MASK48 = (1n << 48n) - 1n;
const MULTIPLIER = 0x5deece66dn;
const MASK64 = (1n << 64n) - 1n;
const f = Math.fround;

/** 保留 java.util.Random 的 48 位 LCG；64 位种子不能经过 JS number。 */
export class JavaRandom {
  private state: bigint;
  constructor(seed: bigint) { this.state = (seed ^ MULTIPLIER) & MASK48; }
  static restore(state: string): JavaRandom {
    const random = new JavaRandom(0n);
    random.state = BigInt(state);
    if (random.state < 0n || random.state > MASK48) throw new Error('随机状态无效');
    return random;
  }
  snapshot(): string { return this.state.toString(); }
  next(bits: number): number {
    this.state = (this.state * MULTIPLIER + 11n) & MASK48;
    return Number(this.state >> BigInt(48 - bits));
  }
  float(): number { return this.next(24) / 16777216; }
  int(bound?: number): number {
    if (bound === undefined) return this.next(32) | 0;
    if (bound <= 0) return 0;
    if (!Number.isSafeInteger(bound) || bound > 2147483647) throw new Error('随机整数边界无效');
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits: number, value: number;
    do { bits = this.next(31); value = bits % bound; }
    while (((bits - value + bound - 1) | 0) < 0);
    return value;
  }
  long(): bigint {
    return BigInt.asIntN(64, (BigInt(this.int()) << 32n) + BigInt(this.int()));
  }
}

export function scrambleSeed(seed: bigint): bigint {
  let value = seed & MASK64;
  value ^= value >> 32n;
  value = (value * 0xbea225f9eb34556dn) & MASK64;
  value ^= value >> 29n;
  value = (value * 0xbea225f9eb34556dn) & MASK64;
  value ^= value >> 32n;
  value = (value * 0xbea225f9eb34556dn) & MASK64;
  value ^= value >> 29n;
  return BigInt.asIntN(64, value);
}

export class Random {
  private generators: JavaRandom[];
  constructor(seed: bigint) { this.generators = [new JavaRandom(scrambleSeed(seed))]; }
  static restore(states: string[]): Random {
    if (states.length === 0) throw new Error('缺少随机状态');
    const random = new Random(0n);
    random.generators = states.map(JavaRandom.restore);
    return random;
  }
  snapshot(): string[] { return this.generators.map(value => value.snapshot()); }
  private get current(): JavaRandom { return this.generators[this.generators.length - 1]!; }
  push(seed: bigint): void { this.generators.push(new JavaRandom(scrambleSeed(seed))); }
  pop(): void { if (this.generators.length > 1) this.generators.pop(); }
  float(max = 1): number { return f(this.current.float() * f(max)); }
  floatRange(min: number, max: number): number {
    const low = f(min), high = f(max);
    return f(low + this.float(f(high - low)));
  }
  int(max?: number): number { return this.current.int(max); }
  range(min: number, max: number): number { return min + this.int(max - min + 1); }
  normalInt(min: number, max: number): number {
    return min + Math.trunc(f(f(f(this.float() + this.float()) * (max - min + 1)) / 2));
  }
  long(): bigint { return this.current.long(); }
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const value of weights) total = f(total + Math.max(0, f(value)));
    if (total <= 0) return -1;
    const roll = this.float(total);
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum = f(sum + Math.max(0, f(weights[i]!)));
      if (roll < sum) return i;
    }
    return -1;
  }
  /** 对应 Random.shuffle(array)，不是 Collections.shuffle(list) 的倒序实现。 */
  shuffle<T>(values: T[]): T[] {
    for (let i = 0; i < values.length - 1; i++) {
      const j = i + this.int(values.length - i);
      [values[i], values[j]] = [values[j]!, values[i]!];
    }
    return values;
  }
  /** Random.shuffle(List) 委托 Collections.shuffle，使用倒序 Fisher–Yates。 */
  shuffleList<T>(values: T[]): T[] {
    for (let i = values.length; i > 1; i--) {
      const j = this.int(i);
      [values[i - 1], values[j]] = [values[j]!, values[i - 1]!];
    }
    return values;
  }
  choose<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error('候选为空');
    return values[this.int(values.length)]!;
  }
}

