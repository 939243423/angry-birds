/* ============================================================
 * levels.js — 关卡构建（自底向上堆叠，坐标自动计算）
 * ============================================================ */
'use strict';

const D2R = Math.PI / 180;

/** 在一列上自底向上堆叠，返回顶部 y */
function stack(out, cx, list, baseY) {
  let y = baseY === undefined ? GROUND_Y : baseY;
  for (const it of list) {
    const mat = it[0], w = it[1], h = it[2], extra = it[3];
    const o = { mat, x: cx, y: y - h / 2, w, h };
    if (extra) Object.assign(o, extra);
    out.push(o);
    y -= h;
  }
  return y;
}
/** 在指定顶部高度架一根横梁，返回新的顶部 y（extra 可传 { static:true } 做悬空固定平台） */
function beam(out, mat, cx, topY, w, h, extra) {
  const o = { mat, x: cx, y: topY - h / 2, w, h };
  if (extra) Object.assign(o, extra);
  out.push(o);
  return topY - h;
}
const pigOn = (topY, type) => ({ type, x: 0, y: topY - PIG_TYPES[type].r });

/* 星级门槛说明（stars: [1星, 2星, 3星]）
 * 1 星门槛必须 **低于「最低通关分」**（= 全场猪分 + 全部砖块分，即用尽所有鸟才通关也能拿到的分数）。
 * 否则会出现"打通了却是 0 星"的挫败感 —— L1 就踩过：最低通关 9500 而门槛设成 13000。
 * 分数公式见 game.js finishLevel()：猪分 + 砖块分 + 剩余小鸟 ×10000。
 * 分值表见 entities.js：猪 small3000 / normal5000 / helmet7000 / king12000；
 *                      砖 wood500 / stone700 / ice400 / glass450 / tnt1500
 * 各关最低通关分（改关卡结构后**必须**用 tools/levelcheck.py 重新核对）：
 *   L1 9500 / L2 16000 / L3 16500 / L4 22400 / L5 18800
 *   L6 26000 / L7 22350 / L8 43000 / L9 24200 / L10 30900
 */

function L1() {
  const B = [], P = [];
  const t1 = stack(B, 1105, [['wood', 26, 110]]);
  const t2 = stack(B, 1235, [['wood', 26, 110]]);
  const top = beam(B, 'wood', 1170, t1, 180, 26);
  P.push({ type: 'normal', x: 1150, y: top - 26 });
  P.push({ type: 'small', x: 1330, y: GROUND_Y - 19 });
  return { name: '初次试飞', tip: '拖动小鸟蓄力，松手发射', decor: 'day', wind: 0, birds: ['red', 'red', 'red'], stars: [8500, 19000, 24000], blocks: B, pigs: P };
}

function L2() {
  const B = [], P = [];
  const t1 = stack(B, 1090, [['stone', 44, 44], ['stone', 44, 44]]);
  const t2 = stack(B, 1250, [['stone', 44, 44], ['stone', 44, 44]]);
  const t3 = beam(B, 'wood', 1170, t1, 210, 26);
  const t4 = stack(B, 1116, [['wood', 26, 84]], t3);
  const t5 = stack(B, 1226, [['wood', 26, 84]], t3);
  const t6 = beam(B, 'stone', 1171, t4, 160, 24);
  P.push({ type: 'normal', x: 1171, y: t6 - 26 });
  P.push({ type: 'small', x: 1420, y: GROUND_Y - 19 });
  P.push({ type: 'small', x: 985, y: GROUND_Y - 19 });
  return { name: '木石之塔', tip: '黄鸟的超音冲刺能穿透木头', decor: 'day', wind: 0, birds: ['red', 'yellow', 'red'], stars: [14000, 23000, 29000], blocks: B, pigs: P };
}

function L3() {
  const B = [], P = [];
  const a1 = stack(B, 1110, [['wood', 30, 110]]);
  const a2 = stack(B, 1290, [['wood', 30, 110]]);
  const a3 = beam(B, 'wood', 1200, a1, 230, 28);
  const tntTop = beam(B, 'tnt', 1200, a3, 66, 66);
  const a4 = stack(B, 1110, [['wood', 26, 72]], a3);
  const a5 = stack(B, 1290, [['wood', 26, 72]], a3);
  const a6 = beam(B, 'wood', 1200, Math.min(a4, a5), 210, 26);
  P.push({ type: 'normal', x: 1200, y: a6 - 26 });
  const h1 = stack(B, 990, [['wood', 30, 92]]);
  const h2 = beam(B, 'wood', 990, h1, 130, 24);
  P.push({ type: 'small', x: 990, y: h2 - 19 });
  P.push({ type: 'small', x: 1430, y: GROUND_Y - 19 });
  return { name: '烈焰引爆', tip: '打爆 TNT 可引发连锁爆炸', decor: 'sunset', wind: 0, birds: ['red', 'black', 'yellow'], stars: [14500, 24000, 30000], blocks: B, pigs: P };
}

function L4() {
  const B = [], P = [];
  const w1 = stack(B, 1180, [['wood', 32, 160], ['wood', 32, 90]]);
  const t1 = stack(B, 1300, [['stone', 46, 46], ['stone', 46, 46], ['stone', 46, 46], ['stone', 46, 46]]);
  const t2 = beam(B, 'wood', 1300, t1, 170, 26);
  // 戴钢盔猪首次登场：站在 4 层石塔顶的横梁上 —— 正常平射够不到它，
  // 必须借助左侧弹簧板弹高、从上方砸落才能造成足够伤害（对应本关主题）
  P.push({ type: 'helmet', x: 1286, y: t2 - 28 });
  P.push({ type: 'small', x: 1352, y: t2 - 19 });
  const t3 = stack(B, 1470, [['stone', 44, 44], ['stone', 44, 44], ['stone', 44, 44]]);
  P.push({ type: 'small', x: 1470, y: t3 - 19 });
  P.push({ type: 'small', x: 1240, y: GROUND_Y - 19 });
  return {
    name: '弹簧蹦床', tip: '踩上弹簧板可以高高弹起，从上方砸穿钢盔猪', decor: 'day', wind: 0,
    birds: ['red', 'blue', 'yellow', 'red'], stars: [19000, 35000, 44000],
    blocks: B, pigs: P, springs: [[1050, GROUND_Y - 10, 'up']]
  };
}

function L5() {
  const B = [], P = [];
  const f1 = stack(B, 1290, [['stone', 40, 170]]);
  const f2 = stack(B, 1530, [['stone', 40, 170]]);
  const roof = beam(B, 'wood', 1410, f1, 280, 26);
  P.push({ type: 'normal', x: 1360, y: GROUND_Y - 26 });
  P.push({ type: 'small', x: 1470, y: GROUND_Y - 19 });
  P.push({ type: 'normal', x: 1410, y: roof - 26 });
  const g1 = stack(B, 980, [['wood', 30, 120]]);
  const g2 = beam(B, 'ice', 980, g1, 150, 30);
  P.push({ type: 'small', x: 980, y: g2 - 19 });
  return {
    name: '空间传送', tip: '飞进蓝色门，会从橙色门射出', decor: 'night', wind: 0,
    birds: ['red', 'yellow', 'blue', 'red'], stars: [17000, 31500, 39500],
    blocks: B, pigs: P,
    portals: [[840, 520, 180 * D2R, 1410, 300, 90 * D2R]]
  };
}

function L6() {
  const B = [], P = [];
  P.push({ type: 'normal', x: 1210, y: 360, balloon: true });
  P.push({ type: 'small', x: 1340, y: 268, balloon: true });
  P.push({ type: 'small', x: 1465, y: 430, balloon: true });
  const b1 = stack(B, 1180, [['wood', 30, 100]]);
  const b2 = stack(B, 1330, [['wood', 30, 100]]);
  const b3 = beam(B, 'wood', 1255, b1, 210, 26);
  const b4 = beam(B, 'tnt', 1255, b3, 60, 60);
  P.push({ type: 'normal', x: 1255, y: b4 - 26 });
  P.push({ type: 'helmet', x: 1470, y: GROUND_Y - 28 });
  return {
    name: '气球猪与风', tip: '打爆气球让猪摔下来，注意风向', decor: 'sunset', wind: -210,
    birds: ['red', 'blue', 'yellow', 'black'], stars: [24000, 36500, 46000],
    blocks: B, pigs: P
  };
}

function L7() {
  const B = [], P = [];
  const i1 = stack(B, 1230, [['ice', 60, 40], ['ice', 60, 40], ['ice', 60, 40]]);
  const i2 = beam(B, 'ice', 1230, i1, 210, 32);
  P.push({ type: 'normal', x: 1230, y: i2 - 26 });
  const g1 = stack(B, 1080, [['glass', 40, 130]]);
  const g2 = stack(B, 1400, [['glass', 40, 130]]);
  const g3 = beam(B, 'glass', 1240, g1, 380, 26);
  P.push({ type: 'small', x: 1160, y: g3 - 19 });
  P.push({ type: 'small', x: 1320, y: g3 - 19 });
  const s1 = stack(B, 1500, [['stone', 44, 44], ['stone', 44, 44]]);
  P.push({ type: 'helmet', x: 1500, y: s1 - 28 });
  return {
    name: '冰川裂隙', tip: '蓝鸟专破冰块，上升气流能托住飞行物', decor: 'snow', wind: 160,
    birds: ['blue', 'black', 'blue', 'yellow'], stars: [20000, 33500, 42500],
    blocks: B, pigs: P, fans: [[1000, 520, 220, 420, 'up', 1600]]
  };
}

function L8() {
  const B = [], P = [];
  const c1 = stack(B, 1150, [['stone', 46, 46], ['stone', 46, 46], ['stone', 46, 46]]);
  const c2 = stack(B, 1330, [['stone', 46, 46], ['stone', 46, 46], ['stone', 46, 46]]);
  const c3 = stack(B, 1510, [['stone', 46, 46], ['stone', 46, 46], ['stone', 46, 46]]);
  const d1 = beam(B, 'stone', 1240, c1, 240, 28);
  const d2 = beam(B, 'stone', 1420, c2, 240, 28);
  const e1 = stack(B, 1240, [['wood', 30, 60], ['tnt', 62, 62]], d1);
  const e2 = stack(B, 1420, [['wood', 30, 60], ['tnt', 62, 62]], d2);
  const f1 = beam(B, 'wood', 1330, Math.min(e1, e2), 420, 30);
  P.push({ type: 'king', x: 1330, y: f1 - 46 });
  P.push({ type: 'helmet', x: 1240, y: d1 - 28 });
  P.push({ type: 'normal', x: 1420, y: d2 - 26 });
  const h1 = stack(B, 1000, [['ice', 50, 40], ['ice', 50, 40]]);
  P.push({ type: 'small', x: 1000, y: h1 - 19 });
  P.push({ type: 'small', x: 1560, y: GROUND_Y - 19 });
  return {
    name: '末日要塞', tip: '最终决战：先炸掉 TNT 打开缺口', decor: 'night', wind: -140,
    birds: ['red', 'black', 'yellow', 'blue', 'red'], stars: [37500, 53500, 67500],
    blocks: B, pigs: P, springs: [[880, GROUND_Y - 10, 'up']],
    portals: [[760, 430, 180 * D2R, 1330, 250, 90 * D2R]]
  };
}

/* L9：回旋试炼 —— 弹弓后方也有猪，得靠回旋绿折返才打得到 */
function L9() {
  const B = [], P = [];
  // 弹弓（x=306）后方的悬空平台：必须 static，否则会自由落体
  const lp1 = beam(B, 'wood', 140, GROUND_Y - 274, 180, 26, { static: true });
  P.push({ type: 'normal', x: 140, y: lp1 - 26 });
  const lp2 = beam(B, 'wood', 470, GROUND_Y - 224, 150, 26, { static: true });
  P.push({ type: 'small', x: 470, y: lp2 - 19 });
  // 右侧主阵地
  const c1 = stack(B, 1120, [['wood', 40, 120], ['wood', 40, 120]]);
  const c2 = stack(B, 1310, [['wood', 40, 120], ['wood', 40, 120]]);
  const top = beam(B, 'wood', 1215, c1, 280, 26);
  P.push({ type: 'normal', x: 1215, y: top - 26 });
  const s1 = stack(B, 1480, [['stone', 46, 92]]);
  P.push({ type: 'helmet', x: 1480, y: s1 - 28 });
  return {
    name: '回旋峡谷', tip: '回旋绿折返可以打身后的猪，引力紫能把远处目标吸过来',
    decor: 'sunset', wind: 0,
    birds: ['green', 'violet', 'green', 'red'],
    stars: [22000, 37000, 47000],
    blocks: B, pigs: P
  };
}

/* L10：引力奇点 —— 猪分散在三座互不相连的高塔上，适合吸拢后一网打尽 */
function L10() {
  const B = [], P = [];
  const t1 = stack(B, 900, [['stone', 40, 100], ['stone', 40, 100]]);
  const t2 = stack(B, 1160, [['ice', 40, 100], ['ice', 40, 100]]);
  const t3 = stack(B, 1420, [['wood', 40, 100], ['wood', 40, 100]]);
  P.push({ type: 'normal', x: 900, y: t1 - 26 });
  P.push({ type: 'small', x: 1160, y: t2 - 19 });
  P.push({ type: 'helmet', x: 1420, y: t3 - 28 });
  // 顶部横梁架在三座塔顶（t1/t2/t3 同高），猪王站在梁上
  const cap = beam(B, 'stone', 1160, t2, 600, 30);
  P.push({ type: 'king', x: 1160, y: cap - 46 });
  return {
    name: '引力奇点', tip: '猪分散在独立高塔上，用引力紫把它们吸成一堆',
    decor: 'snow', wind: 120,
    birds: ['violet', 'green', 'black', 'violet', 'yellow'],
    stars: [28000, 43000, 55000],
    blocks: B, pigs: P
  };
}

/* L_TEST：技能测试关（图鉴跳转专用）
 *
 * 不放进 LEVELS 数组 —— 它**不算主线关**，不会出现在关卡选择网格、
 * 不计入存档、不影响解锁与星级。玩家通过 index.html?level=10&bird=<type>
 * 直达；详见 game.js loadLevelTest() / TEST_LEVEL_INDEX。
 *
 * 坐标全部走 stack()/beam()，禁止手算 y。skill-demo.html 第一版的惨痛教训：
 *   stack([], 1000, [...]) 只算了柱顶却没有把柱压入 B，
 *   g.addBlock 又手算 y = GROUND_Y - 55，结果柱悬空 17px → 自由落体 →
 *   顶上的 TNT 受击即爆 → 200ms 内中央塔自爆，凭空 +8400 分。
 *
 * 靶场结构覆盖 9 种技能（每只鸟都有"用武之地"）：
 *   中央 TNT 高塔     — 红鸟爆裂 / 黑鸟炸弹 / 连锁爆炸
 *   左石塔           — 黄鸟穿透 / 泰坦撞击
 *   右冰塔           — 蓝鸟专属（专破冰）
 *   弹弓后悬空高台    — 绿鸟折返 / 紫鸟引力（不用技能碰不到）
 *   地面散落 4 个目标  — 蓝分裂 / 白空投 / 橙膨胀 / 多目标测试
 *   1 只钢盔猪       — 高血量目标（验证伤害量级） */
function L_TEST() {
  const B = [], P = [];
  // ---- 中央 TNT 高塔（红鸟爆裂 / 黑鸟炸弹）----
  const cL = stack(B, 1000, [['wood', 30, 110]]);
  stack(B, 1180, [['wood', 30, 110]]);
  const beamTop = beam(B, 'wood', 1090, cL, 240, 26);
  beam(B, 'tnt', 1090, beamTop, 50, 50);              // TNT 坐梁顶，自动堆叠不会自爆

  // ---- 左石塔（黄鸟穿透 + 普通猪）----
  const ltTop = stack(B, 800, [['stone', 44, 44], ['stone', 44, 44]]);
  const ltBeam = beam(B, 'wood', 800, ltTop, 110, 22);
  P.push({ type: 'normal', x: 800, y: ltBeam - 26 });

  // ---- 右冰塔（蓝鸟专属）----
  const riTop = stack(B, 1380, [['ice', 44, 44], ['ice', 44, 44]]);
  const riBeam = beam(B, 'ice', 1380, riTop, 110, 22);
  P.push({ type: 'normal', x: 1380, y: riBeam - 26 });

  // ---- 弹弓后方悬空高台（绿折返 / 紫引力专属，static 永不下落）----
  beam(B, 'stone', 600, GROUND_Y - 380, 200, 26, { static: true });
  P.push({ type: 'small', x: 580, y: GROUND_Y - 380 - 13 - 19 });
  P.push({ type: 'small', x: 660, y: GROUND_Y - 380 - 13 - 19 });

  // ---- 地面散落小目标（蓝分裂 / 白空投 / 橙膨胀）----
  P.push({ type: 'small', x: 940,  y: GROUND_Y - 19 });
  P.push({ type: 'small', x: 1100, y: GROUND_Y - 19 });
  P.push({ type: 'small', x: 1280, y: GROUND_Y - 19 });
  P.push({ type: 'helmet', x: 1450, y: GROUND_Y - 28 });

  return {
    name: '技能测试关', tip: '图鉴专用：拖弓发射，飞行中点屏放技能，HUD ↻ 重置队列',
    decor: 'day', wind: 0,
    // 9 只鸟固定顺序循环（图鉴跳转的指定 type 会前置到第 0 位）
    birds: ['red', 'yellow', 'blue', 'black', 'green', 'violet', 'orange', 'white', 'giant'],
    stars: [0, 0, 0],       // 测试关不评星（finishLevel 见到 isTest 直接短路）
    blocks: B, pigs: P, isTest: true
  };
}

// 测试关在关卡选择 / 存档体系里的"虚拟索引"。URL ?level=10 命中这个常量。
// 不进 LEVELS 数组 —— 否则会被误当 11 关解锁、关卡网格多出第 11 个红格、存档被污染。
const TEST_LEVEL_INDEX = 10;

// 测试关里 9 只鸟的固定循环顺序（nextBird 用）。
// 写常量避免每次重 new 一份数组，也方便 ui.js 在 HUD 里按相同顺序渲染剩余队列。
const L_TEST_BIRDS = ['red', 'yellow', 'blue', 'black', 'green', 'violet', 'orange', 'white', 'giant'];

const LEVELS = [L1, L2, L3, L4, L5, L6, L7, L8, L9, L10];

function buildLevel(index) {
  const def = LEVELS[index]();
  def.index = index;
  def.springs = def.springs || [];
  def.portals = def.portals || [];
  def.fans = def.fans || [];
  return def;
}
