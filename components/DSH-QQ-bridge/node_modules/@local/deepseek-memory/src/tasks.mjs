// 待办管理：她自己（qq_memory_todo）与工作台共用的一套只读/收尾操作。
//
// 待办就是长期事实里 task:true 且有 dueAt 的那些条目（不是 DSH 的 dtodo，
// 也不是另一份清单）；「做完 / 取消」不改历史，只追加 ev:'update'，
// 把 task 置 false 并留下 taskStatus/doneAt/doneBy，随时可以从事件流里追溯。
import * as lt from './longterm.mjs';
import { calendarDaysUntil, dueWording } from './timeparse.mjs';

const DAY_MS = 86400e3;

export function listTasks(dir, { now = Date.now(), limit = 20, includeDone = false } = {}) {
  const facts = lt.materialize(lt.readEvents(dir).rows, lt.readInvalidated(dir), now);
  const rows = facts
    .filter((f) => (f.status || 'active') === 'active' && f.task && Number(f.dueAt))
    .filter((f) => includeDone || !f.taskStatus || f.taskStatus === 'pending')
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  return {
    total: rows.length,
    items: rows.slice(0, Math.max(1, Math.min(50, Number(limit) || 20))).map((f) => {
      const dueAt = Number(f.dueAt);
      const days = calendarDaysUntil(dueAt, now);
      return {
        id: f.id,
        value: f.value,
        text: f.text || '',
        due: f.due || '',
        dueAt,
        duePhrase: f.duePhrase || '',
        days,
        overdue: dueAt < now,
        topicId: f.topicId || '',
        slot: f.slot || '',
        author: f.author || 'extract',
        taskStatus: f.taskStatus || 'pending',
        saidAt: f.saidAt || f.createdAt || f.at || 0
      };
    })
  };
}

export function finishTask(dir, id, { status = 'done', by = 'owner' } = {}) {
  if (!id) return { ok: false, code: 'no-id', message: '要指定是哪条待办' };
  if (!['done', 'cancelled'].includes(status)) return { ok: false, code: 'bad-status', message: '只能标记完成或取消' };
  const facts = lt.materialize(lt.readEvents(dir).rows, lt.readInvalidated(dir));
  const fact = facts.find((f) => f.id === id && (f.status || 'active') === 'active');
  if (!fact) return { ok: false, code: 'not-found', message: `没有找到待办 ${id}` };
  if (fact.taskStatus && fact.taskStatus !== 'pending') {
    return { ok: true, action: 'noop', message: '这条待办已经处理过了', taskStatus: fact.taskStatus };
  }
  if (!fact.task || !Number(fact.dueAt)) return { ok: false, code: 'not-task', message: '这条不是带日期的待办' };
  const at = Date.now();
  lt.appendEvent({
    ev: 'update',
    id,
    key: fact.key || '',
    task: false,
    taskStatus: status,
    doneAt: at,
    doneBy: by,
    note: status === 'done' ? '已标记完成' : '已取消'
  }, dir);
  return { ok: true, action: status, id, taskStatus: status, doneAt: at, value: fact.value, due: fact.due || '' };
}

export function taskSummaryLine(task, now = Date.now()) {
  const days = calendarDaysUntil(Number(task.dueAt), now);
  const when = `${task.due || ''} 到期 · ${dueWording(days)}`;
  return `· ${task.value}（${when}）`;
}

export function tasksText(tasks, { now = Date.now(), label = '' } = {}) {
  if (!tasks.items.length) return label ? `${label}：没有待办` : '没有待办';
  const head = label ? `${label}（${tasks.total} 条，按到期日排）：` : `待办（${tasks.total} 条，按到期日排）：`;
  return [head, ...tasks.items.map((t) => taskSummaryLine(t, now))].join('\n');
}

