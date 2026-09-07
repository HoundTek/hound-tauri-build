// 绘制树形结构，返回行数组

import { textWidth } from '../utils/text-width.mjs';

const G = '\x1b[36m';
const R = '\x1b[39m';

const ARROW_EXPAND  = G + '\u25BC ' + R;  // ▼ 展开
const ARROW_COLLAPSE = G + '\u25B6 ' + R;  // ▶ 折叠

/** 默认节点内容渲染 */
function defaultRender(node) {
  return '[' + node.description + ']';
}

/** 切换节点折叠状态 */
export function toggleNode(node) {
  node.collapsed = !node.collapsed;
}

/** 收集线性链节点（唯一子节点的单向链） */
export function collectChain(node) {
  const chain = [node];
  let cur = node;
  while (!cur.collapsed && cur.children.length === 1) {
    cur = cur.children[0];
    chain.push(cur);
  }
  return chain;
}

// ── 单一遍历：同时产出 lines / nodeAtLine / markers ──

/**
 * 遍历树，产出渲染行、行→节点映射、行→可点击标记列表。
 * 三个调用方（drawTree / drawTreeWithMap / treeClick）共享此遍历。
 * @returns {{ lines: string[], nodeAtLine: object[], markers: (null|{node, col, width}[])[] }}
 */
export function walkTree(node, opts = {}) {
  const render = opts.renderNode || defaultRender;
  const lines = [];
  const nodeAtLine = [];
  const markers = [];

  function walk(n, prefix, isLast, showConnector) {
    const isRoot = prefix === '' && !showConnector;
    const conn = showConnector ? (isLast ? G + '\u2514\u2500\u2500 ' + R : G + '\u251C\u2500\u2500 ' + R) : '';
    const hasKids = n.children && n.children.length > 0;

    // 折叠或无子节点：单行，可能有 toggle 标记
    if (!hasKids || n.collapsed) {
      const marker = hasKids ? (n.collapsed ? ARROW_COLLAPSE : ARROW_EXPAND) : '';
      const line = prefix + conn + marker + render(n);
      lines.push(line);
      nodeAtLine.push(n);
      if (hasKids) {
        const col = textWidth(prefix) + textWidth(conn);
        markers.push([{ node: n, col, width: 2 }]);
      } else {
        markers.push(null);
      }
      return;
    }

    // 链压缩
    const chain = collectChain(n);
    if (chain.length > 1) {
      // 折叠单链：只显示最左侧一个展开/折叠按钮，其余节点纯文本
      const tail = chain[chain.length - 1];
      const tailIsLeaf = !tail.children || tail.children.length === 0;

      const parts = chain.map((cn, i) => {
        const m = i === 0 ? (cn.collapsed ? ARROW_COLLAPSE : ARROW_EXPAND) : '';
        return m + render(cn);
      });
      const line = prefix + conn + parts.join(` ${G}/${R} `);
      lines.push(line);
      nodeAtLine.push(chain[0]);

      // 仅链首节点收集 toggle 标记
      const first = chain[0];
      const hasSub = first.children && first.children.length > 0;
      const fm = hasSub ? (first.collapsed ? ARROW_COLLAPSE : ARROW_EXPAND) : '';
      const lineMarkers = fm
        ? [{ node: first, col: textWidth(prefix) + textWidth(conn), width: textWidth(fm) }]
        : [];
      markers.push(lineMarkers.length > 0 ? lineMarkers : null);

      // 展开尾部子节点（叶子则跳过）
      if (!tailIsLeaf && !tail.collapsed && tail.children.length > 0) {
        const indent = isRoot ? '' : prefix + (isLast ? '    ' : G + '\u2502' + R + '   ');
        for (let i = 0; i < tail.children.length; i++) {
          walk(tail.children[i], indent, i === tail.children.length - 1, true);
        }
      }
      return;
    }

    // 展开的普通节点
    const marker = ARROW_EXPAND;
    const line = prefix + conn + marker + render(n);
    lines.push(line);
    nodeAtLine.push(n);
    const col = textWidth(prefix) + textWidth(conn);
    markers.push([{ node: n, col, width: 2 }]);

    const indent = isRoot ? '' : prefix + (isLast ? '    ' : G + '\u2502' + R + '   ');
    for (let i = 0; i < n.children.length; i++) {
      walk(n.children[i], indent, i === n.children.length - 1, true);
    }
  }

  walk(node, '', true, false);

  // 左侧 1 字符缩进，给焦点高亮的前置空格留空间
  for (let i = 0; i < lines.length; i++) {
    lines[i] = ' ' + lines[i];
  }
  for (const m of markers) {
    if (m) {
      for (const mk of m) {
        mk.col += 1;
      }
    }
  }

  return { lines, nodeAtLine, markers };
}

// ── 公开 API ──

/**
 * @param {{ description: string, children: Array }} node
 * @param {{ renderNode?: (node) => string }} [opts]
 * @returns {string[]}
 */
export function drawTree(node, opts = {}) {
  return walkTree(node, opts).lines;
}

/**
 * 同 drawTree，额外返回 nodeAtLine[i] = 第 i 行对应的树节点。
 * 链压缩行映射到链首节点。
 */
export function drawTreeWithMap(node, opts = {}) {
  const { lines, nodeAtLine, markers } = walkTree(node, opts);
  return { lines, nodeAtLine, markers };
}

/**
 * 处理树区域点击：找到 ▶/▼ 标记被点击的节点并切换折叠状态。
 * 使用 walkTree 预计算的数据，不需要重新遍历树。
 *
 * @param {number} lineIdx - 目标行索引（0-based）
 * @param {number} targetCol - 点击列号（0-based）
 * @param {object[]} nodeAtLine - walkTree 产出的行→节点映射
 * @param {(null|{node, col, width}[])[]} markers - walkTree 产出的行→标记映射
 * @returns {object|null} 被切换的节点，或 null
 */
export function treeClick(lineIdx, targetCol, nodeAtLine, markers) {
  if (lineIdx < 0 || lineIdx >= markers.length) return null;
  const lineMarkers = markers[lineIdx];
  if (!lineMarkers) return null;

  for (const m of lineMarkers) {
    if (targetCol >= m.col && targetCol < m.col + m.width) {
      toggleNode(m.node);
      return m.node;
    }
  }
  return null;
}
