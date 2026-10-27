import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DecodedGift, GiftEvent, Round, GameAction, GameManifest } from '@zhuda/contracts';
import {
  eventsFor,
  themesFor,
  themeFor,
  validateGameRules,
  type GameConfiguration,
} from '@zhuda/contracts';

export class LocalStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observations(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,event_json TEXT NOT NULL,payload BLOB,received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dedup(event_id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS combos(key TEXT PRIMARY KEY,high_water TEXT NOT NULL,partial INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rounds(id TEXT PRIMARY KEY,mode TEXT NOT NULL,round_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS heads(mode TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES rounds(id));
      CREATE TABLE IF NOT EXISTS actions(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,round_id TEXT NOT NULL,action_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS observations_time ON observations(received_at);
      CREATE INDEX IF NOT EXISTS actions_round ON actions(round_id,seq);
      PRAGMA foreign_keys=ON; PRAGMA user_version=1;`);
  }
  close() {
    this.db.close();
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? (JSON.parse(String(row.value)) as T) : fallback;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  round(mode: 'live' | 'demo'): Round | null {
    const row = this.db
      .prepare('SELECT r.round_json FROM heads h JOIN rounds r ON r.id=h.round_id WHERE h.mode=?')
      .get(mode);
    return row ? (JSON.parse(String(row.round_json)) as Round) : null;
  }
  private saveRound(round: Round) {
    this.db
      .prepare(
        'INSERT INTO rounds VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET round_json=excluded.round_json',
      )
      .run(round.id, round.mode, JSON.stringify(round));
    this.db
      .prepare(
        'INSERT INTO heads VALUES(?,?) ON CONFLICT(mode) DO UPDATE SET round_id=excluded.round_id',
      )
      .run(round.mode, round.id);
  }
  configuration(manifest: GameManifest): GameConfiguration {
    const events = eventsFor(manifest);
    const saved =
      this.get<unknown>(`gift-rules:${manifest.id}:${manifest.version}`, null) ??
      this.get<unknown>(`gift-rules:${manifest.id}`, null);
    let rules;
    try {
      rules = validateGameRules(events, saved ?? manifest.rules);
    } catch {
      rules = validateGameRules(events, manifest.rules);
    }
    const theme = themeFor(
      manifest,
      this.get<string>(
        `theme:${manifest.id}:${manifest.version}`,
        this.get<string>(`theme:${manifest.id}`, ''),
      ),
    );
    return {
      product: manifest.id,
      packageVersion: manifest.version,
      events,
      rules,
      themes: themesFor(manifest),
      theme,
    };
  }
  configureTheme(manifest: GameManifest, theme: string) {
    const themes = themesFor(manifest);
    if (!themes.some((item) => item.id === theme)) throw new Error('此游戏版本不支持所选主题');
    this.transaction(() => {
      this.set(`theme:${manifest.id}:${manifest.version}`, theme);
      this.set(`theme:${manifest.id}`, theme);
      for (const mode of ['live', 'demo'] as const) {
        const round = this.round(mode);
        if (
          round &&
          round.status !== 'stopped' &&
          round.product === manifest.id &&
          round.packageVersion === manifest.version
        ) {
          round.theme = theme;
          round.themes = structuredClone(themes);
          this.saveRound(round);
        }
      }
    });
  }
  configureRules(manifest: GameManifest, input: unknown) {
    const events = eventsFor(manifest);
    const rules = validateGameRules(events, input);
    this.transaction(() => {
      this.set(`gift-rules:${manifest.id}:${manifest.version}`, rules);
      this.set(`gift-rules:${manifest.id}`, rules);
      for (const mode of ['live', 'demo'] as const) {
        const round = this.round(mode);
        if (
          round &&
          round.status !== 'stopped' &&
          round.product === manifest.id &&
          round.packageVersion === manifest.version
        ) {
          round.rules = structuredClone(rules);
          round.events = structuredClone(events);
          this.saveRound(round);
        }
      }
    });
  }
  startRound(manifest: GameManifest, mode: 'live' | 'demo', webId: string, initial: string): Round {
    if (!/^[1-9][0-9]{0,8}$/.test(initial)) throw new Error('起始数量须为 1–999,999,999');
    return this.transaction(() => {
      if (this.round(mode)?.status === 'running') throw new Error('请先结束目前回合');
      const latest = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM observations').get();
      const round: Round = {
        id: randomUUID(),
        product: manifest.id,
        packageVersion: manifest.version,
        mode,
        webId,
        initial,
        remaining: initial,
        status: 'running',
        startedAt: new Date().toISOString(),
        startSeq: String(latest?.seq ?? 0),
        rules: this.configuration(manifest).rules,
        events: structuredClone(eventsFor(manifest)),
        themes: structuredClone(themesFor(manifest)),
        theme: this.configuration(manifest).theme,
      };
      this.saveRound(round);
      return round;
    });
  }
  stopRound(mode: 'live' | 'demo') {
    this.transaction(() => {
      const r = this.round(mode);
      if (r && r.status !== 'stopped') {
        r.status = 'stopped';
        this.saveRound(r);
      }
    });
  }
  ingest(
    decoded: DecodedGift,
    payload: Uint8Array,
    route?: (gift: GiftEvent) => void,
  ): { gift: GiftEvent; action: GameAction | null } {
    return this.transaction(() => {
      const e = structuredClone(decoded);
      if (e.id && this.db.prepare('SELECT 1 FROM dedup WHERE event_id=?').get(e.id)) {
        e.delta = '0';
        e.quality = 'duplicate';
        e.note = '重送已排除';
      } else if (e.countMode && e.count && e.comboKey) {
        const old = this.db
          .prepare('SELECT high_water,partial FROM combos WHERE key=?')
          .get(e.comboKey);
        const count = BigInt(e.count);
        const partial = old
          ? Boolean(old.partial)
          : e.countMode === 'cumulative' && count > 1n && !e.startsCombo;
        const previous = old ? BigInt(String(old.high_water)) : partial ? count : 0n;
        e.delta = (count > previous ? count - previous : 0n).toString();
        if (partial) {
          e.quality = 'partial';
          e.note = '连击中途观测，只计后续添加';
        }
        this.db
          .prepare(
            'INSERT INTO combos VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET high_water=excluded.high_water,partial=excluded.partial,updated_at=excluded.updated_at',
          )
          .run(
            e.comboKey,
            (count > previous ? count : previous).toString(),
            partial ? 1 : 0,
            e.receivedAt,
          );
        this.db.prepare('INSERT INTO dedup VALUES(?,?)').run(e.id, e.receivedAt);
      }
      delete e.countMode;
      delete e.count;
      delete e.comboKey;
      delete e.startsCombo;
      const result = this.db
        .prepare('INSERT INTO observations(run_id,event_json,payload,received_at) VALUES(?,?,?,?)')
        .run(e.runId, '{}', payload, e.receivedAt);
      e.seq = String(result.lastInsertRowid);
      this.db
        .prepare('UPDATE observations SET event_json=? WHERE seq=?')
        .run(JSON.stringify(e), result.lastInsertRowid);
      let action: GameAction | null = null;
      const round = route ? null : this.round(e.source);
      if (route) route(e);
      if (
        round &&
        round.status !== 'stopped' &&
        e.delta &&
        BigInt(e.delta) > 0n &&
        e.quality !== 'duplicate' &&
        round.webId === e.webId &&
        BigInt(e.seq) > BigInt(round.startSeq) &&
        Date.parse(e.receivedAt) >= Date.parse(round.startedAt)
      ) {
        action = this.apply(round, e.id, e.giftId, e.giftName, e.senderName, e.delta);
      }
      return { gift: e, action };
    });
  }
  private apply(
    round: Round,
    eventId: string,
    giftId: string,
    giftName: string,
    senderName: string,
    quantity: string,
  ): GameAction | null {
    if (this.db.prepare('SELECT 1 FROM actions WHERE event_id=?').get(eventId)) return null;
    const rule = round.rules.find((r) => r.giftId === giftId);
    if (!rule) return null;
    const before = BigInt(round.remaining),
      requested = BigInt(quantity) * BigInt(rule.delta);
    const after = before + requested < 0n ? 0n : before + requested;
    const a: GameAction = {
      id: randomUUID(),
      roundId: round.id,
      giftId,
      giftName,
      senderName,
      quantity,
      delta: (after - before).toString(),
      eventId: rule.eventId,
      eventName: round.events?.find((event) => event.id === rule.eventId)?.label,
      value: (BigInt(quantity) * BigInt(rule.amount ?? (Math.abs(rule.delta) || 1))).toString(),
      before: before.toString(),
      after: after.toString(),
      won: before > 0n && after === 0n,
      at: new Date().toISOString(),
    };
    round.remaining = after.toString();
    round.status = after === 0n ? 'won' : 'running';
    this.saveRound(round);
    this.db
      .prepare('INSERT INTO actions(event_id,round_id,action_json) VALUES(?,?,?)')
      .run(eventId, round.id, JSON.stringify(a));
    return a;
  }
  simulate(giftId: string, quantity: string, requestId: string = randomUUID()): GameAction {
    if (!/^[1-9][0-9]{0,5}$/.test(quantity)) throw new Error('试送数量须为 1–999,999');
    return this.transaction(() => {
      const round = this.round('demo');
      if (!round) throw new Error('请先开始试玩回合');
      const prior = this.db
        .prepare('SELECT action_json FROM actions WHERE event_id=?')
        .get(`demo:${round.id}:${requestId}`);
      if (prior) {
        const saved = JSON.parse(String(prior.action_json)) as GameAction;
        if (saved.giftId !== giftId || saved.quantity !== quantity)
          throw new Error('试送请求 ID 已用于其他内容');
        return saved;
      }
      if (round.status === 'stopped') throw new Error('试玩回合已结束');
      const action = this.apply(
        round,
        `demo:${round.id}:${requestId}`,
        giftId,
        round.rules.find((r) => r.giftId === giftId)?.giftName ?? giftId,
        '试玩观众',
        quantity,
      );
      if (!action) throw new Error('此礼物没有激活规则');
      return action;
    });
  }
  gifts(limit = 100): GiftEvent[] {
    return this.db
      .prepare('SELECT event_json FROM observations ORDER BY seq DESC LIMIT ?')
      .all(limit)
      .map((r) => JSON.parse(String(r.event_json)) as GiftEvent);
  }
  actions(roundId: string | undefined): GameAction[] {
    if (!roundId) return [];
    return this.db
      .prepare('SELECT action_json FROM actions WHERE round_id=? ORDER BY seq DESC LIMIT 30')
      .all(roundId)
      .map((r) => JSON.parse(String(r.action_json)) as GameAction);
  }
  retain(now = Date.now()) {
    this.transaction(() => {
      this.db
        .prepare('UPDATE observations SET payload=NULL WHERE received_at<?')
        .run(new Date(now - 7 * 86400_000).toISOString());
      this.db
        .prepare('DELETE FROM observations WHERE received_at<?')
        .run(new Date(now - 30 * 86400_000).toISOString());
      this.db
        .prepare('DELETE FROM dedup WHERE created_at<?')
        .run(new Date(now - 30 * 86400_000).toISOString());
      this.db
        .prepare('DELETE FROM combos WHERE updated_at<?')
        .run(new Date(now - 30 * 86400_000).toISOString());
      // Game action identities deliberately outlive observation retention.
    });
  }
}
