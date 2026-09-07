// 事件系统 demo

import { initEvents, on, destroyEvents } from '../utils/events.mjs';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

const log = [];

function draw() {
  process.stdout.write('\x1b[H\x1b[2J');
  for (let i = 0; i < 20; i++) {
    const line = log[log.length - 1 - i] || '';
    process.stdout.write(line + '\x1b[K\n');
  }
}

process.stdout.write(ALT_ON + HIDE);
draw();

on('key', (k) => {
  log.push(`KEY: name=${k.name} seq=${JSON.stringify(k.sequence)} ctrl=${k.ctrl}`);
  draw();
  if (k.name === 'q' && k.ctrl) exit();
});

on('click', (m) => {
  log.push(`CLICK: btn=${m.btn} x=${m.x} y=${m.y}`);
  draw();
});

on('scroll', (m) => {
  log.push(`SCROLL: dir=${m.dir} x=${m.x} y=${m.y}`);
  draw();
});

on('mouse', (m) => {
  // raw mouse (too noisy, skip drawing)
});

on('resize', (s) => {
  log.push(`RESIZE: rows=${s.rows} columns=${s.columns}`);
  draw();
});

function exit() {
  destroyEvents();
  process.stdout.write(ALT_OFF + SHOW);
  process.stdout.write(log.join('\n') + '\n');
  process.exit(0);
}

// fallback exit: Enter
on('key', (k) => {
  if (k.name === 'return') exit();
});

initEvents();
