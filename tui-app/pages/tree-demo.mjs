// Tree expand/collapse demo
import { drawTree, toggleNode } from '../components/tree.mjs';

const tree = {
  description: 'build',
  children: [
    { description: 'compile', children: [
      { description: 'rustc', children: [] },
      { description: 'tsc', children: [] },
    ]},
    { description: 'bundle', children: [
      { description: 'webpack', children: [] },
      { description: 'rollup', children: [] },
    ]},
    { description: 'deploy', children: [
      { description: 'package', children: [
        { description: 'archive', children: [
          { description: 'upload', children: [] },
        ]},
      ]},
    ]},
  ],
};

function show(label) {
  console.log(`\n=== ${label} ===`);
  console.log(drawTree(tree).join('\n'));
}

show('全部展开');

// 折叠 compile
toggleNode(tree.children[0]);
show('compile 已折叠');

// 展开 compile
toggleNode(tree.children[0]);
show('compile 已展开');

// 折叠 deploy (链状)
toggleNode(tree.children[2]);
show('deploy 已折叠');
