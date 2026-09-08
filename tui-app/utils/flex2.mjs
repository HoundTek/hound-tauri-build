/**
 * @file 双面板高度弹性分配
 * @description 按对数比例在两个面板之间分配可用高度，保证总量不溢出且满足最小值约束。
 * @module flex2
 * @author hound-builder
 */

/**
 * 按对数比例分配 totHeight，保证 height1+height2 ≤ totHeight
 * 每侧至少保留 min1/min2 高度（若 totHeight 允许）
 * @param {number} totHeight - 可用总高度
 * @param {number} maxHeight1 - 第一面板最大高度
 * @param {number} maxHeight2 - 第二面板最大高度
 * @param {number} [min1=1] - 第一面板最小高度
 * @param {number} [min2=3] - 第二面板最小高度
 * @returns {[number, number]} 分配后的 [height1, height2]
 */
export function flexTwo(totHeight, maxHeight1, maxHeight2, min1 = 1, min2 = 3) {
    const avail = Math.max(0, totHeight);
    const m1 = Math.max(0, maxHeight1);
    const m2 = Math.max(0, maxHeight2);
    if (avail <= min1 + min2) {
        // 极端小：只给最小
        const h1 = Math.min(min1, avail);
        return [h1, avail - h1];
    }
    if (m1 === 0 && m2 === 0) return [avail, 0];
    const log1 = Math.log(1 + m1);
    const log2 = Math.log(1 + m2);
    let height1 = Math.min(m1, Math.floor(avail * log1 / (log1 + log2)));
    let height2 = Math.min(m2, avail - height1);
    // 保证最小
    if (height1 < min1 && avail >= min1 + min2) { height1 = min1; height2 = avail - height1; }
    if (height2 < min2 && avail >= min1 + min2) { height2 = min2; height1 = avail - height2; }
    return [Math.max(0, height1), Math.max(0, height2)];
}
