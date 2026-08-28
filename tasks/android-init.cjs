/**
 * @file android:init 任务
 * @description 初始化 Android 项目。
 * @module scripts/build/tasks/android-init
 */

module.exports = {
  id: 'android:init',
  description: 'android init',
  dependsOn: [],
  conflicts: [
    { resource: 'resource:tauri-cli', mode: 'write' },
    { resource: 'resource:gen-android', mode: 'write' },
  ],
  run: { cmd: 'node -e "require(\'fs\').rmSync(\'src-tauri/gen/android\',{recursive:true,force:true})" && yarn init:android' },
};
