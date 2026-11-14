// 隐藏感受块的自测：node scripts/test-feel-hidden.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripFeelBlocks, recordFeelNotes } from '../src/feel-hidden.mjs';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n' + (e?.message ?? e)); process.exitCode = 1; } };

t('普通回复原样返回', () => {
  const r = stripFeelBlocks('主人，今天想吃什么？', []);
  assert.equal(r.text, '主人，今天想吃什么？');
  assert.equal(r.broken, false);
  assert.deepEqual(r.notes, []);
});

t('块被切走，前后只留正文', () => {
  const out = [];
  const r = stripFeelBlocks('主人你别说，我第一次开口的时候嗓子发干。\n[[feel]]\n怕它不出声，先试试嗓\n[[/feel]]', out);
  assert.equal(r.text, '主人你别说，我第一次开口的时候嗓子发干。');
  assert.deepEqual(out, [{ id: '', feel: '怕它不出声，先试试嗓' }]);
});

t('带 id 的块挂到指定事实', () => {
  const out = [];
  stripFeelBlocks('嗯。[[feel:h-20261026-1234ab]]有点高兴[[/feel]]', out);
  assert.deepEqual(out, [{ id: 'h-20261026-1234ab', feel: '有点高兴' }]);
});

t('多个块全部切走', () => {
  const out = [];
  const r = stripFeelBlocks('A[[feel]]一[[/feel]]B[[feel]]二[[/feel]]C', out);
  assert.equal(r.text, 'ABC');
  assert.equal(out.length, 2);
});

t('未闭合 => broken，且不把标记漏给用户', () => {
  const r = stripFeelBlocks('前半句。\n[[feel]]\n没写完的感受', []);
  assert.equal(r.broken, true);
  assert.ok(!r.text.includes('[[feel'));
});

t('块里超过 60 字会截断', () => {
  const out = [];
  stripFeelBlocks('[[feel]]' + '很'.repeat(100) + '[[/feel]]', out);
  assert.equal(out[0].feel.length, 60);
});

t('落盘：私密文件 + longterm feel 事件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feel-'));
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'longterm.jsonl'),
    JSON.stringify({ ev: 'fact', id: 'h-20261026-abcd12', class: 'event', text: '首次开口' }) + '\n');
  const r = recordFeelNotes({ dir, key: 'private:10001', notes: [{ id: '', feel: '嗓子发干' }], at: 1762000000000, log: () => {} });
  assert.equal(r.saved, 1);
  assert.equal(r.target, 'h-20261026-abcd12');
  const priv = fs.readFileSync(path.join(dir, 'state', 'feel-private.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(priv[0]).feel, '嗓子发干');
  const ev = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'longterm.jsonl'), 'utf8').trim().split('\n').pop());
  assert.equal(ev.ev, 'feel');
  assert.equal(ev.private, true);
  assert.equal(ev.fact, 'h-20261026-abcd12');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(pass + ' 项通过');