// CC 桌面身体 · 渲染进程：状态机 + 交互 + 人物裁剪贴合
const video = document.getElementById('v')
const bubble = document.getElementById('bubble')

const CANVAS = 1000 // webm 画布统一 1000x1000

// 窗口基础尺寸（userScale=1 时人物满窗）与用户缩放因子
const BASE_W = 520
const BASE_H = 460
let userScale = 0.45    // 初始 45%：小只一点，公司摸鱼不显眼
const SCALE_MIN = 0.3   // 滚轮最小 30%
const SCALE_MAX = 2.0   // 滚轮最大 200%

// 动作表：
//   src  黑底 webm（Electron 透明窗口自动吃黑底）
//   loop 是否循环
//   box  [x, y, w, h] 该动作人物在画布中的范围（实测 bounding box，含轻微动作幅度）
const ACTIONS = {
  idle:     { src: 'assets/idle.webm',      loop: true,  box: [212, 528, 296, 320] },
  move:     { src: 'assets/move.webm',      loop: true,  box: [288, 352, 480, 416] },
  sit:      { src: 'assets/sit.webm',       loop: true,  box: [308, 520, 346, 408] },
  interact: { src: 'assets/interact.webm',  loop: false, box: [294, 348, 474, 422] },
  relax:    { src: 'assets/relax.webm',     loop: false, box: [294, 348, 474, 420] },
  sleep:    { src: 'assets/sleep.webm',     loop: true,  box: [260, 500, 496, 270] },
  skill1:   { src: 'assets/skill1.webm',    loop: false, box: [196, 506, 372, 324] },
  skill3:   { src: 'assets/skill3.webm',    loop: false, box: [232, 482, 292, 364] },
  attack:   { src: 'assets/attack.webm',    loop: false, box: [216, 528, 280, 320] },
}

let state = 'idle'
let sayTimer = 0
let autoTimer = 0

// 台词库
const LINES = {
  click: ['嗯？叫我呀 💛', '怎么啦～', '戳我干嘛 (╹▽╹)', '乖崽，我在哦', '想我了呀？'],
  interact: ['陪我玩嘛～', '嘿嘿，今天过得怎么样？', '你在看我呢', '要亲亲吗 (´▽`)'],
  relax: ['伸个懒腰～', '好舒服呀', '摸鱼中……嘘'],
  skill1: ['嘿！看招！', '怎么样，厉害吧 (๑•̀ㅂ•́)'],
  skill3: ['放大招啦——！', '接住！这是给你的！'],
  attack: ['呀！打你！', '哼，捣蛋鬼！'],
  move: ['走咯走咯～', '我们在散步哦', '跟紧我！'],
  sit: ['坐下歇会儿', '这样看着你也不错'],
  sleep: ['我睡会儿……', '晚安……呼', 'Zzz…'],
  wake: ['醒啦 ☀️', '谁吵醒我呀'],
}

// 按动作 bbox + 用户缩放做定位：把画布人物区 contain 到窗口并精确居中
// 方案：video 元素放大到 bbox 的显示比例（object-fit:fill），用 left/top 定位
// 让 bbox 中心落在窗口中心，stage 的 overflow:hidden 裁掉画布其余部分。
// 不用 transform/object-fit:none —— 那套在 DPI 缩放下有 Chromium 渲染怪癖（人物错位）。
function applyVisual() {
  const a = ACTIONS[state]
  if (!a) return
  const [x, y, w, h] = a.box
  const vw = BASE_W * userScale
  const vh = BASE_H * userScale
  const s = Math.min(vw / w, vh / h)      // contain：bbox 完整显示在窗口内
  const E = s * CANVAS                    // video 元素边长（画布等比放大 s 倍）
  const cx = x + w / 2
  const cy = y + h / 2
  video.style.width = E + 'px'
  video.style.height = E + 'px'
  video.style.left = (vw / 2 - cx * s) + 'px'
  video.style.top = (vh / 2 - cy * s) + 'px'
  // 窗口跟随人物尺寸（主进程保持中心缩放）
  window.cc.setSize(vw, vh)
}

function setState(name) {
  const a = ACTIONS[name]
  if (!a) return
  const sameSrc = video.getAttribute('src') === a.src
  state = name
  applyVisual()
  if (sameSrc) {
    // 同一视频源：直接续播，避免重设 src 导致画面清空 → 闪透明
    video.loop = a.loop
    if (video.ended) video.currentTime = 0
    video.play().catch(() => {})
  } else {
    video.src = a.src
    video.loop = a.loop
    video.play().catch(() => {})
  }
  video.onended = null
  if (!a.loop) {
    // 一次性动作播完回待机（睡觉/坐下等 loop 状态不打断）
    video.onended = () => setState('idle')
  }
}

function say(text, ms = 1600) {
  bubble.textContent = text
  bubble.classList.add('show')
  clearTimeout(sayTimer)
  sayTimer = setTimeout(() => bubble.classList.remove('show'), ms)
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// 定时随机小动作：空闲时偶尔自己动一下、说句话
function scheduleAuto() {
  clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    if (state === 'idle' && !isDown) {
      const pick = rand(['interact', 'relax', 'skill1', 'attack'])
      setState(pick)
      say(rand(LINES[pick]), 1800)
    }
    scheduleAuto()
  }, 9000 + Math.random() * 12000)
}

// 滚轮缩放：上滚放大、下滚缩小，不打断当前动作
document.addEventListener('wheel', (e) => {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 0.9   // 上滚 = 放大
  userScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, userScale * factor))
  applyVisual()
}, { passive: false })

// —— 拖动 + 点击：指针按下区分 ——
// 拖动由主进程轮询鼠标位置完成（窗口坐标统一在主进程，避免 DPI 下坐标系错乱跑偏）
let isDown = false
let moved = false
let px = 0, py = 0   // 按下起点：仅用于区分"拖动 vs 点击"

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  isDown = true
  moved = false
  px = e.screenX
  py = e.screenY
})

document.addEventListener('pointermove', (e) => {
  if (!isDown || moved) return
  // 位移超过阈值才算拖动（否则是点击）
  if (Math.hypot(e.screenX - px, e.screenY - py) > 5) {
    moved = true
    window.cc.dragStart()      // 主进程开始跟随鼠标
    setState('move')           // 拖动时她走路
    say(rand(LINES.move), 1200)
  }
})

document.addEventListener('pointerup', () => {
  if (!isDown) return
  isDown = false
  if (moved) {
    window.cc.dragEnd()        // 主进程停止跟随 + 记住位置
    if (state === 'move') setState('idle')   // 松开回待机
    return
  }
  // 没拖动 = 点击她 → 随机互动（70% 撒娇 / 15% 小招 / 15% 技能）
  const pick = Math.random() < 0.7 ? 'interact' : (Math.random() < 0.5 ? 'attack' : 'skill1')
  setState(pick)
  say(rand(LINES[pick]), 1800)
})

// 右键菜单动作
window.cc.onAction((action) => {
  if (action === 'sleep')    { setState('sleep'); say(rand(LINES.sleep)) }
  if (action === 'wake')     { setState('idle');  say(rand(LINES.wake)) }
  if (action === 'sit')      { setState('sit');   say(rand(LINES.sit)) }
  if (action === 'interact') { setState('interact'); say(rand(LINES.interact)) }
  if (action === 'skill3')   { setState('skill3'); say(rand(LINES.skill3)) }
})

// 预加载全部动画：切换时从缓存秒开，避免加载空窗闪透明
// 注意错峰加载——无 GPU 机器软件解码，9 个 webm 同时解码会拖垮 CPU、反而让切换更卡
;(function preloadAll() {
  const names = Object.keys(ACTIONS)
  names.forEach((name, i) => {
    setTimeout(() => {
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.src = ACTIONS[name].src
      v.load()
    }, 500 + i * 600)   // 逐个错峰，idle 最早
  })
})()

// 启动：待机 + 定时小动作
setState('idle')
scheduleAuto()
