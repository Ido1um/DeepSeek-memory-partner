// 单机身份与心跳：一键换机时用来判断「这份数据是不是正被另一台机器使用」。
//
// 存放位置都在记忆目录里，随记忆一起搬走：
//   <记忆根>\machine.json                  机器身份（machineId 第一次用到时生成）
//   <记忆根>\state\machine-heartbeat.json  每 5 分钟一次的心跳（DSMP 巡检里调）
//   <记忆根>\state\machine-history.jsonl   换机 / 收养记录（只追加）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MACHINE_FILE = 'machine.json';
export const HEARTBEAT_FILE = path.join('state', 'machine-heartbeat.json');
export const HISTORY_FILE = path.join('state', 'machine-history.jsonl');
export const HEARTBEAT_MS = 5 * 60 * 1000;

function hostName() {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown';
}

export function machinePath(dir) {
  return path.join(dir, MACHINE_FILE);
}

export function readMachine(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(machinePath(dir), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function machineIdOf(dir) {
  const machine = readMachine(dir);
  return machine && machine.machineId ? String(machine.machineId) : '';
}

/**
 * Read the machine identity, creating it on first use.
 * Only the memory writer should call this; readers use `readMachine`.
 */
export function ensureMachine(dir, info = {}) {
  const existing = readMachine(dir);
  if (existing && existing.machineId) return existing;
  const machine = {
    machineId: crypto.randomUUID(),
    name: info.name || hostName(),
    createdAt: new Date().toISOString(),
    memoryVersion: String(info.memoryVersion || ''),
    dsmpVersion: String(info.dsmpVersion || ''),
    boundSessionId: String(info.boundSessionId || ''),
    cwd: String(info.cwd || '')
  };
  fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(machinePath(dir), machine);
  return machine;
}

export function writeHeartbeat(dir, { at = Date.now(), machineId = '' } = {}) {
  const id = machineId || machineIdOf(dir);
  if (!id) return { ok: false, error: '没有 machine.json，先 ensureMachine' };
  const file = path.join(dir, HEARTBEAT_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { machineId: id, at });
  return { ok: true, file, at };
}

export function readHeartbeat(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, HEARTBEAT_FILE), 'utf8'));
    return { at: Number(data.at) || 0, machineId: String(data.machineId || '') };
  } catch {
    return { at: 0, machineId: '' };
  }
}

/**
 * Is this data set currently "owned" by another live machine?
 * `freshMs` is deliberately generous: a laptop that sleeps for a few minutes
 * must not look like it was abandoned.
 */
export function lockState(dir, { now = Date.now(), freshMs = 10 * 60 * 1000, selfId = '' } = {}) {
  const machine = readMachine(dir);
  const beat = readHeartbeat(dir);
  const machineId = machine?.machineId ? String(machine.machineId) : '';
  const ageMs = beat.at ? Math.max(0, now - beat.at) : Infinity;
  const fresh = Boolean(beat.at) && ageMs <= freshMs;
  return {
    machine: machine || null,
    machineId,
    name: machine?.name || '',
    heartbeatAt: beat.at || 0,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    fresh,
    foreign: Boolean(machineId && selfId && machineId !== selfId && fresh)
  };
}

export function historyOf(dir) {
  try {
    return fs
      .readFileSync(path.join(dir, HISTORY_FILE), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Adopt a pack onto this machine: new machineId, keep the old one in history. */
export function adoptMachine(dir, { importedFrom = '', cwd = '', boundSessionId = '', dsmpVersion = '', memoryVersion = '' } = {}) {
  const previous = readMachine(dir);
  const machine = {
    machineId: crypto.randomUUID(),
    name: hostName(),
    createdAt: new Date().toISOString(),
    memoryVersion: String(memoryVersion || ''),
    dsmpVersion: String(dsmpVersion || ''),
    boundSessionId: String(boundSessionId || ''),
    cwd: String(cwd || ''),
    importedFrom: String(importedFrom || ''),
    previousMachineId: previous?.machineId || ''
  };
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  if (previous?.machineId) {
    fs.appendFileSync(
      path.join(dir, HISTORY_FILE),
      `${JSON.stringify({
        at: machine.createdAt,
        action: 'adopt',
        fromMachineId: previous.machineId,
        fromName: previous.name || '',
        fromMachine: importedFrom,
        toMachineId: machine.machineId,
        cwd: machine.cwd
      })}\n`,
      'utf8'
    );
  }
  writeJsonAtomic(machinePath(dir), machine);
  writeHeartbeat(dir, { machineId: machine.machineId });
  return machine;
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
