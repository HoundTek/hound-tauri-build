import net from 'net';
import configModule from '../../config.cjs';

const tuiConfig = configModule.getConfig().tui;

/*
 * 连接到构建 TCP 服务，返回指定任务的状态和日志
 */
export function getTaskStatus(port, taskName) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: tuiConfig.host });
    sock.setEncoding('utf8');

    let buf = '';
    let taskIndex = -1;
    let taskStatus = undefined;
    let taskElapsed = undefined;
    const logs = [];

    sock.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          const msg = JSON.parse(l);
          if (msg.type === 'init') {
            const tasks = msg.tasks || [];
            taskIndex = tasks.findIndex((t) =>
              (typeof t === 'string' ? t : t.name)?.includes(taskName));
          }
          if (msg.type === 'status' && msg.index === taskIndex) {
            taskStatus = msg.status;
            taskElapsed = msg.elapsed;
          }
          if (msg.type === 'log') logs.push(msg.text);
        } catch (_) { /* skip */ }
      }
    });

    sock.on('end', () => {
      resolve({ found: taskIndex >= 0, status: taskStatus, elapsed: taskElapsed, logs });
    });

    sock.on('error', (err) => {
      resolve({ found: false, logs, error: err.message });
    });
  });
}
