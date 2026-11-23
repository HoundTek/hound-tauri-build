/**
 * @file Screen 渲染出口的页面级集成测试（Phase B）
 * @description makePage 产出的字符串行经 Screen 渲染：首帧全量、稳态零输出、
 *   增量帧只含变化内容。验证「字符串层组件 + Cell 渲染出口」的衔接。
 * @module {tests}/screen-page
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import screenModule from '../../lib/term/screen.cjs';
import { updateTerminalSize } from '../utils/terminal-size.mjs';
import { initFromTasks, onTaskStatus, onLogEntry, makePage } from '../pages/index.mjs';

const { Screen } = screenModule;

const FULL_CAPS = { colorLevel: 3, osc8: true, syncOutput: true, underlineStyles: true, underlineColor: true, blink: true };

function fakeOut(cols, rows) {
  return {
    columns: cols,
    rows,
    writes: [],
    write(s) { this.writes.push(s); },
    text() { return this.writes.join(''); },
  };
}

function renderFrame(screen) {
  const page = makePage();
  screen.frame((buf) => {
    for (let y = 0; y < page.length; y++) buf.write(0, y, page[y]);
  });
}

before(() => {
  updateTerminalSize(24, 80);
  initFromTasks([
    { id: 'build:mac', name: 'build mac', dependsOn: [] },
    { id: 'build:win', name: 'build win', dependsOn: ['build:mac'] },
  ]);
  onTaskStatus('build:mac', 'running', 100);
});

describe('Screen × makePage 集成', () => {
  it('首帧包含任务树内容', () => {
    const out = fakeOut(80, 24);
    const s = new Screen(out, { caps: FULL_CAPS });
    renderFrame(s);
    const text = out.text();
    assert.ok(text.includes('build:mac'), '首帧应包含任务 ID');
    assert.ok(text.includes('\x1b[?2026h'), '应有同步输出包裹');
  });
  it('重复帧输出远小于整帧（差量渲染生效，仅计时器等微变化）', () => {
    const out = fakeOut(80, 24);
    const s = new Screen(out, { caps: FULL_CAPS });
    renderFrame(s);
    const fullSize = out.text().length;
    out.writes.length = 0;
    renderFrame(s);
    const inc = out.text().length;
    assert.ok(inc < fullSize * 0.3, `增量 ${inc}B 应远小于整帧 ${fullSize}B`);
  });
  it('新增日志后增量帧非空且远小于整帧', () => {
    const out = fakeOut(80, 24);
    const s = new Screen(out, { caps: FULL_CAPS });
    renderFrame(s);
    const fullSize = out.text().length;
    out.writes.length = 0;
    onLogEntry('hello incremental line', 'build:mac');
    renderFrame(s);
    const inc = out.text();
    assert.ok(inc.length > 0, '增量帧应有输出');
    assert.ok(inc.includes('hello incremental line'));
    assert.ok(inc.length < fullSize, `增量 ${inc.length}B 应小于整帧 ${fullSize}B`);
  });
  it('页面行数与终端行数一致（无底部溢出）', () => {
    const page = makePage();
    assert.equal(page.length, 24);
  });
});
