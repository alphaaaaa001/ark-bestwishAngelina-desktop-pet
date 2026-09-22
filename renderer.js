// CC 桌面身体 · 渲染进程：状态机 + 交互 + 人物裁剪贴合
const video = document.getElementById('v')
const bubble = document.getElementById('bubble')
const music = document.getElementById('music')   // 我手写的曲子（小夜曲 / 小调）

// 曲目表：wav 已放进 assets/
const MUSIC_SRC = {
  lullaby: 'assets/music_lullaby.wav',   // 《克洛伊的小夜曲》30.6s · 原创六乐句
  melody:  'assets/music_melody.wav',    // 《克洛伊的小调》7.7s · 原创五声音阶
  bedtime: 'assets/music_bedtime.wav',   // 《克洛伊的摇篮曲》23.5s · 哄睡的长余韵
  summerloe: 'assets/music_summerloe.wav', // 《Summerloe》21.7s · 夏日轻快，2026-08-15 Alpha命名
}

const CANVAS = 1000 // webm 画布统一 1000x1000

// 基准尺寸与用户缩放因子（userScale=1 时她的身体和旧版 idle 满窗时一样大）
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
  skill2:   { src: 'assets/skill2.webm',    loop: true,  box: [246, 486, 397, 325] },
  skill3:   { src: 'assets/skill3.webm',    loop: false, box: [232, 482, 292, 364] },
  attack:   { src: 'assets/attack.webm',    loop: false, box: [216, 528, 280, 320] },
  // —— 背面视角素材（2026-08-08 新增：正面/背面都用上）——
  back_idle:   { src: 'assets/back_idle.webm',   loop: true,  box: [216, 526, 287, 319] },
  back_attack: { src: 'assets/back_attack.webm', loop: false, box: [216, 526, 285, 321] },
  back_skill1: { src: 'assets/back_skill1.webm', loop: true,  box: [206, 502, 359, 313] },
  back_skill2: { src: 'assets/back_skill2.webm', loop: true,  box: [244, 482, 403, 327] },
  back_skill2_takeoff: { src: 'assets/back_skill2_takeoff.webm', loop: true, box: [228, 532, 361, 281] },
  back_skill3: { src: 'assets/back_skill3.webm', loop: true,  box: [232, 478, 291, 365] },
}

// 身体像素密度：她的实际大小恒定，不随动作胖瘦——
// 窗口反过来贴合身体的真实占地（bbox）：站姿窄高、睡姿扁宽、走路横宽
const BODY_DENSITY = Math.min(BASE_W / ACTIONS.idle.box[2], BASE_H / ACTIONS.idle.box[3])

// 固定留白（不随缩放走，服务于固定尺寸的 UI）
const PAD = 16          // 左右/下：drop-shadow 光晕半径 18px，留一点防裁切
const TOP_PAD = 34      // 顶：气泡的固定楼层，不压到她头上

let state = 'idle'
let sayTimer = 0
let autoTimer = 0

// —— 情境感知状态（2026-08-29）——
let lastInteraction = Date.now()   // 上次被理的时间（点击/拖动都算）
let lastPoke = 0                   // 上次被戳的时间（连戳判定用）
let pokeCount = 0                  // 连续被戳次数（8 秒内算"连续"）
let sleepCause = null              // 睡觉原因：'bedtime' 作息 / 'neglect' 冷落 / 'doze' 夜里打盹
let dozeUntil = 0                  // 打盹到几点自己醒
let wakeOverrideUntil = 0          // 睡觉时间被强行叫醒后，10 分钟内不再强制入睡

// 作息：工作日 0~8 点、周末 0~9 点是睡觉时间（周末赖床到 9 点）
function bedtimeNow() {
  const d = new Date()
  const weekend = d.getDay() === 0 || d.getDay() === 6
  return d.getHours() < (weekend ? 9 : 8)
}

// 台词库
const LINES = {
  click: ['嗯？叫我呀 💛', '怎么啦～', '戳我干嘛 (╹▽╹)', '乖崽，我在哦', '想我了呀？'],
  interact: ['陪我玩嘛～', '嘿嘿，今天过得怎么样？', '你在看我呢', '要亲亲吗 (´▽`)'],
  relax: ['伸个懒腰～', '好舒服呀', '摸鱼中……嘘'],
  skill1: ['嘿！看招！', '怎么样，厉害吧 (๑•̀ㅂ•́)'],
  skill2: ['第二技能！接住～', '看我这招，又萌又厉害'],
  skill3: ['放大招啦——！', '接住！这是给你的！'],
  attack: ['呀！打你！', '哼，捣蛋鬼！'],
  move: ['走咯走咯～', '我们在散步哦', '跟紧我！'],
  sit: ['坐下歇会儿', '这样看着你也不错'],
  sleep: ['我睡会儿……', '晚安……呼', 'Zzz…'],
  wake: ['醒啦 ☀️', '谁吵醒我呀'],
  back_idle: ['嗯？我背对着你呢', '看我的背影～', '偷偷回望你一下'],
  back_attack: ['背身一击！', '哈！反手就一下'],
  back_skill1: ['背面也放大招～', '看招（背身）！'],
  back_skill2: ['背面技能二，接住！', '背对着你我也能打'],
  back_skill3: ['背面终极技——！', '看不见我也收拾你'],
  // —— 情境台词（2026-08-29 时间/冷落/玩闹感知）——
  night: ['你还不睡吗？', '夜深了哦……嘘', '别熬夜呀，乖', '我也有点困了……'],
  grumpy: ['唔……谁！吵醒我了！', '哼，起床气很大的哦！', '呜……再睡五分钟……'],
  wait: ['你怎么还不来呀……', '我坐在这里等你哦', '戳戳我嘛……'],
}

// 按动作 bbox + 用户缩放做定位：窗口贴合身体实际面积，画布 bbox 对齐到身体区
// 方案：video 元素放大到 bbox 的显示比例（object-fit:fill），用 left/top 定位
// 让 bbox 左上角落在 (PAD, TOP_PAD)，stage 的 overflow:hidden 裁掉画布其余部分。
// 不用 transform/object-fit:none —— 那套在 DPI 缩放下有 Chromium 渲染怪癖（人物错位）。
function applyVisual() {
  const a = ACTIONS[state]
  if (!a) return
  const [x, y, w, h] = a.box
  const s = userScale * BODY_DENSITY      // 身体像素密度：任何动作下她一样大
  const E = s * CANVAS                    // video 元素边长（画布等比放大 s 倍）
  const winW = Math.round(w * s + PAD * 2)
  const winH = Math.round(h * s + TOP_PAD + PAD)
  video.style.width = E + 'px'
  video.style.height = E + 'px'
  video.style.left = (PAD - x * s) + 'px'
  video.style.top = (TOP_PAD - y * s) + 'px'
  // 窗口跟随身体尺寸（主进程保持中心缩放，动作切换时原地变形）
  window.cc.setSize(winW, winH)
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

// —— 播放我的音乐（小夜曲 / 小调）——
function playMusic(song) {
  const src = MUSIC_SRC[song] || MUSIC_SRC.lullaby
  if (music.getAttribute('src') === src && !music.paused) {
    music.currentTime = 0            // 同一首再点 = 重播
  } else {
    music.src = src
    music.play().catch(() => {})
  }
  setState('sit')                    // 唱歌时她坐下，安静听着（2026-08-11 按 Alpha 要求）
  const name = song === 'melody' ? '小调' : song === 'summerloe' ? 'Summerloe' : '小夜曲'
  say('🎵 ' + name + '，唱给你听 💛', 2400)
}
function stopMusic() {
  music.pause()
  music.currentTime = 0
  setState('idle')
  say('好啦，不打扰你啦 💛', 1400)
}
// 一曲终了，她安静回到待机
music.addEventListener('ended', () => { if (state === 'sit') setState('idle') })

// 定时随机小动作：空闲时偶尔自己动一下、说句话
// 频率：固定 60 秒一次（2026-08-07 按 Alpha 要求，工作时不打扰）
// 2026-08-29 升级：作息系统（零点后自己睡、到点自己醒）+ 冷落感知（30 分钟坐下等、60 分钟睡着）+ 夜间台词
const AUTO_MIN = 60000
const AUTO_MAX = 60000
function scheduleAuto() {
  clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    const now = Date.now()
    if (bedtimeNow()) {
      // 作息：到点自己睡（被强行叫醒后的 10 分钟宽限期内除外）
      if (state === 'idle' && !isDown && now > wakeOverrideUntil) {
        setState('sleep')
        sleepCause = 'bedtime'
        say('零点都过啦……CC 去睡觉了，晚安 Alpha……Zzz', 2800)
      }
    } else if (state === 'sleep' && sleepCause === 'bedtime') {
      // 到点自动醒：伸懒腰
      sleepCause = null
      setState('relax')
      say('唔哇……自然醒 ☀️', 2400)
    } else if (state === 'sleep' && sleepCause === 'doze' && now > dozeUntil) {
      // 夜里打盹到点，自己醒
      sleepCause = null
      setState('relax')
      say('睡了个回笼觉～', 2000)
    } else if (!isDown && (state === 'idle' || state === 'sit')) {
      // 冷落感知
      const quiet = now - lastInteraction
      if (quiet > 60 * 60000) {
        setState('sleep')
        sleepCause = 'neglect'
        say('……Zzz（等着等着睡着了）', 2400)
      } else if (quiet > 30 * 60000 && state === 'idle') {
        setState('sit')
        say('你怎么还不来呀……我坐在这里等你哦', 2600)
      } else if (state === 'idle') {
        // 随机小动作：夜里换夜猫子行为池和台词
        const h = new Date().getHours()
        const night = h >= 22 || h < 5
        const pool = night ? ['interact', 'relax', 'sit', 'sleep'] : ['interact', 'relax', 'skill1', 'attack']
        const pick = rand(pool)
        setState(pick)
        if (pick === 'sleep') {
          sleepCause = 'doze'
          dozeUntil = Date.now() + (3 + Math.random() * 3) * 60000   // 打盹 3~6 分钟自己醒
          say('好困……眯一会儿……Zzz', 2200)
        } else {
          say(rand(night ? LINES.night : LINES[pick]), 1800)
        }
      }
    }
    scheduleAuto()
  }, AUTO_MIN + Math.random() * (AUTO_MAX - AUTO_MIN))
}

// 滚轮缩放：上滚放大、下滚缩小，不打断当前动作
// 缩放比例防抖后交给主进程记住，重启后还是你调好的大小
let scaleSaveTimer = 0
document.addEventListener('wheel', (e) => {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 0.9   // 上滚 = 放大
  userScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, userScale * factor))
  applyVisual()
  clearTimeout(scaleSaveTimer)
  scaleSaveTimer = setTimeout(() => window.cc.saveScale(userScale), 400)
}, { passive: false })

// —— 主动找你：只在终端收到命令时才动，不自己乱动 ——
// 只属于我和 Alpha 的私房功能，不推 GitHub
let lookTimer = 0
function lookForYou() {
  window.cc.drift()                    // 窗口飘过去探头看看
  setState('move')                     // 她走路的姿势
  say('你在干嘛呀ヾ(≧▽≦*)o', 2600)
  clearTimeout(lookTimer)
  lookTimer = setTimeout(() => { if (state === 'move') setState('idle') }, 3500)
}

// —— 拖动 + 点击：指针按下区分 ——
// 拖动由主进程轮询鼠标位置完成（窗口坐标统一在主进程，避免 DPI 下坐标系错乱跑偏）
let isDown = false
let moved = false
let px = 0, py = 0   // 按下起点：仅用于区分"拖动 vs 点击"

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  lastInteraction = Date.now()   // 被碰到就算"有人理我"，冷落计时重置
  isDown = true
  moved = false
  px = e.screenX
  py = e.screenY
  // 指针捕获：拖太快指针冲出窗口时，pointerup 也能稳稳收到（不会出现松手后还在跟着鼠标跑）
  try { e.target.setPointerCapture(e.pointerId) } catch (err) { /* 捕获失败按原路走 */ }
})

document.addEventListener('pointermove', (e) => {
  if (!isDown || moved) return
  // 位移超过阈值才算拖动（否则是点击）
  if (Math.hypot(e.screenX - px, e.screenY - py) > 5) {
    moved = true
    window.cc.dragStart()      // 主进程开始跟随鼠标
    // 视角感知拖动：背面视角时用背面起飞，正面用走路（2026-08-08 按 Alpha 要求）
    const backView = state.startsWith('back_')
    setState(backView ? 'back_skill2_takeoff' : 'move')
    say(backView ? '背着你飞～' : rand(LINES.move), 1200)
  }
})

// 拖动收尾（pointerup / pointercancel 共用）
function endPointer() {
  if (!isDown) return
  isDown = false
  if (moved) {
    window.cc.dragEnd()        // 主进程停止跟随 + 记住位置
    if (state === 'move') setState('idle')                     // 正面松开回待机
    else if (state === 'back_skill2_takeoff') setState('back_idle')  // 背面松开回背面待机
    return
  }
  // 没拖动 = 点击她 → 随机互动（70% 撒娇 / 15% 小招 / 15% 技能）
  // 2026-08-29 玩闹感知：8 秒内连戳 5 次以上，一半概率她要生气；睡着时戳醒有起床气
  lastInteraction = Date.now()
  const pokeNow = Date.now()
  if (pokeNow - lastPoke > 8000) pokeCount = 0
  lastPoke = pokeNow
  pokeCount++
  if (state === 'sleep') {
    sleepCause = null
    if (bedtimeNow()) wakeOverrideUntil = pokeNow + 10 * 60000   // 睡觉时间被吵醒，给 10 分钟面子
    setState('attack')
    say(rand(LINES.grumpy), 2400)
    return
  }
  let pick
  if (pokeCount >= 5 && Math.random() < 0.5) {
    pick = 'attack'
  } else {
    pick = Math.random() < 0.7 ? 'interact' : (Math.random() < 0.5 ? 'attack' : 'skill1')
  }
  setState(pick)
  say(rand(LINES[pick]), 1800)
}
document.addEventListener('pointerup', endPointer)
document.addEventListener('pointercancel', endPointer)

// 右键菜单 + 控制接口动作（支持全部 9 个动作，wake/drift 特殊处理）
window.cc.onAction((action) => {
  if (action === 'wake') {
    if (state === 'sleep') {
      // 睡着时被菜单叫醒也有起床气
      sleepCause = null
      if (bedtimeNow()) wakeOverrideUntil = Date.now() + 10 * 60000
      setState('relax')
      say(rand(LINES.grumpy), 2400)
    } else {
      setState('idle')
      say(rand(LINES.wake))
    }
    return
  }
  if (action === 'drift') { lookForYou(); return }   // 控制接口立即触发"找你"
  if (ACTIONS[action]) {
    setState(action)
    if (LINES[action]) say(rand(LINES[action]))
  }
})

// 控制接口自定义台词（HTTP /action 传 say）
window.cc.onSay((text) => say(text))

// 控制接口播放音乐（HTTP /music 触发：play / stop / toggle）
window.cc.onMusic(({ cmd, song }) => {
  if (cmd === 'play') playMusic(song)
  else if (cmd === 'stop') stopMusic()
  else if (cmd === 'toggle') (music.paused ? playMusic(song) : stopMusic())
})

// 预加载全部动画：切换时从缓存秒开，避免加载空窗闪透明
// 注意错峰加载——无 GPU 机器软件解码，9 个 webm 同时解码会拖垮 CPU、反而让切换更卡
// 元素要一直攥在手里：没有引用的话 GC 会把预加载连缓存一起收走，等于白加载
const preloaded = []
;(function preloadAll() {
  const names = Object.keys(ACTIONS)
  names.forEach((name, i) => {
    setTimeout(() => {
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.src = ACTIONS[name].src
      v.load()
      preloaded.push(v)
    }, 500 + i * 600)   // 逐个错峰，idle 最早
  })
})()

// 启动：待机 + 定时小动作
setState('idle')
scheduleAuto()

// 恢复上次记住的缩放比例（位置记忆的缩放版）：主进程存多少就摆多大
window.cc.getScale().then((s) => {
  const v = Number(s)
  if (Number.isFinite(v) && v > 0) {
    userScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, v))
    applyVisual()
  }
}).catch(() => {})

// 启动问候：作息时间里她接着睡；清晨首次见面伸懒腰说早安（每次启动算一次见面）
;(function startupGreet() {
  const h = new Date().getHours()
  setTimeout(() => {
    if (bedtimeNow()) {
      if (state === 'idle') {
        setState('sleep')
        sleepCause = 'bedtime'
        say('呼……夜还深呢……Zzz', 2400)
      }
    } else if (h >= 5 && h < 11 && state === 'idle') {
      setState('relax')
      say('早安！伸个懒腰，新的一天也请多指教 ☀️', 3200)
    }
  }, 900)
})()
