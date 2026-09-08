/**
 * @file 帧计数器
 * @description 提供全局帧计数器，供组件动画使用.
 * @module tick
 * @author hound-builder
 */

/**
 * 当前帧计数，每调用 advanceTick 自增 1
 * @type {number}
 */
export let tick = 0;

/**
 * 推进一帧，将 tick 计数器加 1
 * @returns {void}
 */
export function advanceTick() { tick++; }
