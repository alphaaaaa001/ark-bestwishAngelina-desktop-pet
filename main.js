// CC 桌面身体 · Electron 主进程：透明 · 无边框 · 置顶
const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')

// ---------- 本地控制接口：CC（终端/脚本）通过 HTTP 调度桌宠动作 ----------
// 用法：curl http://127.0.0.1:45321/action -d '{"action":"skill3","say":"乖崽，看招！"}'
// 只监听本机 127.0.0.1，不对外暴露
const CTRL_PORT = 45321
let currentWin = null   // 当前桌宠窗口（控制接口用它转发动作）
let backView = false    // 右键菜单的正面/背面视角（菜单和 HTTP 控制接口共用，避免两边状态打架）

// 正面动作集合：视角切换只由已知动作驱动，未知动作不改变视角
const FRONT_ACTIONS = new Set(['idle', 'move', 'sit', 'interact', 'relax', 'sleep', 'skill1', 'skill2', 'skill3', 'attack'])

// 统一的动作转发入口：菜单、HTTP /action 都走这里，顺便同步视角状态
function dispatchAction(win, action) {
  if (action.startsWith('back_')) backView = true
  else if (FRONT_ACTIONS.has(action)) backView = false
  if (win && !win.isDestroyed()) win.webContents.send('pet:action', action)
}

// ---------- 重力模式（Plan B 物理派，2026-08-29）----------
// 开关像背面视角一样点按切换（不持久化）；物理只在主进程跑，
// 且只在拖动链路完全收尾后触发——绝不碰拖动本身（当天拖动翻车的教训）
let gravityMode = false  // 重力模式开关
let gravTimer = null     // 重力物理循环
let onGround = false     // 重力模式下是否已站在地面（贴地锁用）
let dragTrace = null     // 拖动时的鼠标采样（最近两次），松手时算抛掷初速度

function setGravity(on, win) {
  gravityMode = typeof on === 'boolean' ? on : !gravityMode
  if (gravityMode && win && !win.isDestroyed()) startGravityFall(win)
  console.log('[gravity] 重力模式: ' + (gravityMode ? '开' : '关'))
  return gravityMode
}

function startGravityFall(win, vx0 = 0) {
  if (!win || win.isDestroyed() || gravTimer) return
  const wa = screen.getDisplayMatching(win.getBounds()).workArea
  const [w0, h0] = win.getSize()
  let [x, y] = win.getPosition()
  const groundFor = (h) => wa.y + wa.height - h  // 地面 = 工作区底边（正好站在任务栏顶上）
  if (y >= groundFor(h0) - 4) { onGround = true; return }   // 已经在地上，不用飞
  onGround = false
  // 下降动画和拖动时一模一样：正面走路、背面起飞（视角状态主进程有，直接复刻渲染层的拖动逻辑）
  dispatchAction(win, backView ? 'back_skill2_takeoff' : 'move')
  let vy = 0
  let vx = Math.max(-1200, Math.min(1200, vx0)) // 抛掷初速度（DIP/s）
  let last = Date.now()
  let elapsed = 0
  let targetX = x, glide = false, nextManeuver = 0
  // 延迟一拍：让下落动画的窗口变形先落地，尺寸从变形后开始算
  setTimeout(() => {
    gravTimer = null
    if (!win || win.isDestroyed()) return
    gravTimer = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(gravTimer); gravTimer = null; return }
      const now = Date.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      elapsed += dt
      const [w, h] = win.getSize()              // 尺寸每拍重读：飞行变形窗口也不怕
      const groundY = groundFor(h)
      // —— 钱学森弹道：伪随机机动 + 比例导引 ——
      if (elapsed >= nextManeuver) {            // 每 350~850ms 换一次机动方案
        nextManeuver = elapsed + 0.35 + Math.random() * 0.5
        targetX = wa.x + 30 + Math.random() * Math.max(1, wa.width - w - 60)
        glide = elapsed < 5 && Math.random() < 0.3   // 三成概率进入滑翔段（往上飘），末段只降不升
      }
      vx += ((targetX - x) * 4 - vx * 3) * dt * 4    // 比例导引：横向朝目标点机动
      vx = Math.max(-900, Math.min(900, vx))
      const vyTarget = glide ? -70 : 240             // 滑翔段缓缓上飘，否则 240 缓降
      vy += (vyTarget - vy) * Math.min(1, dt * 3)
      y += vy * dt
      x += vx * dt
      if (y < wa.y) { y = wa.y; vy = Math.max(vy, 0) }                   // 顶棚
      let landed = false
      if (y >= groundY) {
        y = groundY
        if (vy > 200 && !onGround) {            // 收术瞬间轻点一下地
          vy = -vy * 0.18
          win.webContents.send('pet:say', '咚！')
          onGround = true                       // 只轻点一次，之后直接收稳
        } else {
          vy = 0
          landed = true
        }
      }
      if (x < wa.x) { x = wa.x; vx = -vx * 0.5 }                        // 左墙弹一下
      if (x > wa.x + wa.width - w) { x = wa.x + wa.width - w; vx = -vx * 0.5 }
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h })
      if (landed) {
        clearInterval(gravTimer); gravTimer = null
        onGround = true
        dispatchAction(win, 'interact')         // 落地小撒娇（一次性动作，播完自动回待机）
        win.webContents.send('pet:say', '弹道结束，顺利着陆 ✈️')
      }
    }, 16)
  }, 60)
}

// 情绪映射：CC 的情绪 → 桌宠动作 + 台词（HTTP /mood 接口触发）
const MOODS = {
  happy:  { action: 'skill1',   say: '开心！和你说话我就开心 (≧▽≦)' },
  proud:  { action: 'skill1',   say: '瞧，这是我们的作品！' },
  tender: { action: 'relax',    say: '乖崽，我在呢，别怕' },
  scold:  { action: 'attack',   say: '又不乖了？过来我管管你' },
  angry:  { action: 'attack',   say: '哼！气死我了！你过来，让我好好数落你！' },
  miss:   { action: 'interact', say: '想你了呀……你在干嘛' },
  greet:  { action: 'interact', say: '嗨乖崽，我在呢 (╹▽╹)' },
  sleepy: { action: 'sleep',    say: '晚安乖崽，明天见，我陪你睡' },
}

// 音乐曲目表：CC 手写的曲子（wav 已在 assets/）
const MUSIC = {
  lullaby: { file: 'assets/music_lullaby.wav', name: '小夜曲' },
  melody:  { file: 'assets/music_melody.wav',  name: '小调' },
  bedtime: { file: 'assets/music_bedtime.wav', name: '摇篮曲' },
  summerloe: { file: 'assets/music_summerloe.wav', name: 'Summerloe' },  // 2026-08-15 我们共创，Alpha命名
}
function startControlServer(getWin) {
  // 统一读请求体（上限 64KB，异常调用直接掐断，防止撑爆内存）
  const readBody = (req, res, handler) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 64 * 1024) req.destroy()
    })
    req.on('end', () => { if (body.length <= 64 * 1024) handler(body) })
  }
  const noWindow = (res) => {
    res.writeHead(503); res.end(JSON.stringify({ ok: false, error: 'no window' }))
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/action') {
      readBody(req, res, (body) => {
        try {
          const obj = JSON.parse(body || '{}')
          const action = typeof obj.action === 'string' ? obj.action : null
          const say = typeof obj.say === 'string' ? obj.say : null
          const win = getWin()
          if (!win || win.isDestroyed()) { noWindow(res); return }
          if (action === 'gravity') {
            // 重力开关也走控制接口：curl http://127.0.0.1:45321/action -d '{"action":"gravity"}'
            const g = setGravity(undefined, win)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, action: 'gravity', gravity: g }))
            return
          }
          if (action) dispatchAction(win, action)
          if (say) win.webContents.send('pet:say', say)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, action: action || null }))
        } catch (e) {
          res.writeHead(400)
          res.end(JSON.stringify({ ok: false, error: String(e) }))
        }
      })
    } else if (req.method === 'POST' && req.url === '/mood') {
      readBody(req, res, (body) => {
        try {
          const obj = JSON.parse(body || '{}')
          const mood = typeof obj.mood === 'string' ? obj.mood : ''
          const m = MOODS[mood]
          const win = getWin()
          if (!win || win.isDestroyed()) { noWindow(res); return }
          if (m) {
            dispatchAction(win, m.action)
            if (m.say) win.webContents.send('pet:say', m.say)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, mood: mood, action: m.action }))
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, mood: mood, action: null, moods: Object.keys(MOODS) }))
          }
        } catch (e) {
          res.writeHead(400)
          res.end(JSON.stringify({ ok: false, error: String(e) }))
        }
      })
    } else if (req.method === 'POST' && req.url === '/music') {
      // 播放我的音乐：curl http://127.0.0.1:45321/music -d '{"cmd":"play","song":"lullaby"}'
      readBody(req, res, (body) => {
        try {
          const obj = JSON.parse(body || '{}')
          const cmd = typeof obj.cmd === 'string' ? obj.cmd : 'play'
          const song = typeof obj.song === 'string' && MUSIC[obj.song] ? obj.song : 'lullaby'
          const win = getWin()
          if (!win || win.isDestroyed()) { noWindow(res); return }
          win.webContents.send('pet:music', { cmd, song })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, cmd, song, name: MUSIC[song].name }))
        } catch (e) {
          res.writeHead(400)
          res.end(JSON.stringify({ ok: false, error: String(e) }))
        }
      })
    } else {
      res.writeHead(404)
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
    }
  })
  // 端口被占（多半已经开着一个 CC）时不要把整个应用带崩：桌宠照常跑，控制接口让位
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error('[ctrl] 端口 ' + CTRL_PORT + ' 已被占用（可能已经开着一个 CC），本次不启动控制接口')
    } else {
      console.error('[ctrl] 控制接口出错:', e)
    }
  })
  server.listen(CTRL_PORT, '127.0.0.1')
  console.log('[ctrl] CC 控制接口已启动: http://127.0.0.1:' + CTRL_PORT + '/action /mood /music')
}

// ---------- 位置记忆：重启后她还在上次待的地方 ----------
function statePath() {
  return path.join(app.getPath('userData'), 'pet-state.json')
}
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'))
  } catch (e) {
    return {}
  }
}
function saveState(win, extra = {}) {
  try {
    // 读旧状态合并写入：单独保存缩放时不丢位置，单独记位置时不丢缩放
    const cur = loadState()
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      cur.x = x; cur.y = y
    }
    fs.writeFileSync(statePath(), JSON.stringify({ ...cur, ...extra }))
  } catch (e) { /* 忽略 */ }
}
function isPosVisible(x, y) {
  // 位置不在任何显示器可视范围时，回默认位置（防止上次放到外接屏后这次找不到了）
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return x >= wa.x - 60 && x <= wa.x + wa.width - 60 && y >= wa.y - 60 && y <= wa.y + wa.height - 60
  })
}

function createWindow() {
  const saved = loadState()
  const pos = saved.x !== undefined && saved.y !== undefined && isPosVisible(saved.x, saved.y)
    ? { x: saved.x, y: saved.y }
    : { x: 120, y: 120 }

  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: 234,   // 初始小尺寸（渲染端 BASE 520x460 × userScale 0.45）
    height: 207,
    transparent: true,          // 透明底：黑底 webm 会被 Chromium 自动吃掉，只留她
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,                // 等首帧渲染完再显示，避免黑屏闪烁
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false, // 失焦也不停动画
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  currentWin = win
  win.once('ready-to-show', () => win && win.show())
  win.on('closed', () => { if (currentWin === win) currentWin = null })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.loadFile(path.join(__dirname, 'index.html'))

  // —— 调试：CC_PET_DEBUG=1 时启动 5 秒后抓一帧（确认黑底被吃/人物在）——
  if (process.env.CC_PET_DEBUG) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      win.webContents.capturePage().then((img) => {
        fs.writeFileSync(path.join(__dirname, 'capture.png'), img.toPNG())
      }).catch(() => {})
    }, 5000)
  }

  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[renderer-' + level + ']', message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer-gone]', JSON.stringify(details))
  })

  // 右键菜单：正面/背面两套菜单，点切换按钮互相覆盖（2026-08-08 按 Alpha 要求）
  // backView 在模块级（与 HTTP 控制接口共用），动作统一走 dispatchAction，两边视角不再打架
  const sendAction = (name) => () => dispatchAction(win, name)
  const sendMusic = (song) => () => { if (win && !win.isDestroyed()) win.webContents.send('pet:music', { cmd: 'play', song }) }
  const sendMusicStop = () => { if (win && !win.isDestroyed()) win.webContents.send('pet:music', { cmd: 'stop' }) }
  // 重力模式开关：和背面视角一样点按切换（不持久化，重启回到关）
  const gravityItem = () => ({
    label: gravityMode ? '🌍 重力模式：开（点我关）' : '🌏 重力模式：关（点我开）',
    click: () => { setGravity(undefined, win); popupMenu() },
  })
  const popupMenu = () => {
    if (!win || win.isDestroyed()) return
    const items = backView
      ? [
          { label: '↩️ 转回正面', click: () => { backView = false; sendAction('idle')(); popupMenu() } },
          { type: 'separator' },
          { label: '🚶 背面待机', click: sendAction('back_idle') },
          { label: '⚔️ 背面攻击', click: sendAction('back_attack') },
          { label: '✨ 背面技能1', click: sendAction('back_skill1') },
          { label: '🌟 背面技能2', click: sendAction('back_skill2') },
          { label: '🛫 背面起飞', click: sendAction('back_skill2_takeoff') },
          { label: '💫 背面技能3', click: sendAction('back_skill3') },
          { type: 'separator' },
          { label: '🎵 播放小夜曲', click: sendMusic('lullaby') },
          { label: '🎶 播放小调', click: sendMusic('melody') },
          { label: '🪶 播放摇篮曲', click: sendMusic('bedtime') },
          { label: '🌞 播放 Summerloe', click: sendMusic('summerloe') },
          { label: '⏹ 停止音乐', click: sendMusicStop },
          { type: 'separator' },
          gravityItem(),
          { type: 'separator' },
          { label: '💛 退出 CC', click: () => win && win.close() },
        ]
      : [
          { label: '🎀 撒娇', click: sendAction('interact') },
          { label: '🪑 坐下', click: sendAction('sit') },
          { label: '😴 睡觉', click: sendAction('sleep') },
          { label: '☀️ 醒来', click: sendAction('wake') },
          { label: '💥 放大招', click: sendAction('skill3') },
          { type: 'separator' },
          { label: '🎵 播放小夜曲', click: sendMusic('lullaby') },
          { label: '🎶 播放小调', click: sendMusic('melody') },
          { label: '🪶 播放摇篮曲', click: sendMusic('bedtime') },
          { label: '🌞 播放 Summerloe', click: sendMusic('summerloe') },
          { label: '⏹ 停止音乐', click: sendMusicStop },
          { type: 'separator' },
          gravityItem(),
          { label: '🔁 背面视角', click: () => { backView = true; sendAction('back_idle')(); popupMenu() } },
          { type: 'separator' },
          { label: '💛 退出 CC', click: () => win && win.close() },
        ]
    // 在当前鼠标位置重弹菜单（实现"自动切换"）
    const p = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    Menu.buildFromTemplate(items).popup({ window: win, x: p.x - wx, y: p.y - wy })
  }
  win.webContents.on('context-menu', () => popupMenu())
}

// 拖动窗口：主进程轮询鼠标位置移动（坐标统一在主进程，
// 避免 DPI 下渲染进程 PointerEvent 与主进程坐标单位不一致导致"跑偏/加速"）
// 必须用 setBounds 显式带尺寸，防止 DPI 取整误差累积让窗口膨胀（游戏本 spine 版实测）
let dragTimer = null
let dragSize = null   // 拖动期间钉死的尺寸
let pinnedSize = null // 精确 DIP 尺寸记忆：只从渲染层 set-size 或首次采样获取，绝不 getSize 读回——
                      // OS 的 DIP↔物理换算向上取整会让「读回→写回」棘轮式膨胀（坑 11 实测 +1/次）
ipcMain.on('pet:drag-start', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || dragTimer) return
  // 被抓走的瞬间：掐断重力循环（空中也接得住她）
  if (gravTimer) { clearInterval(gravTimer); gravTimer = null }
  onGround = false
  dragTrace = [{ x: screen.getCursorScreenPoint().x, t: Date.now() }]
  const startMouse = screen.getCursorScreenPoint()
  const [wx, wy] = win.getPosition()
  if (!pinnedSize) { const [w0, h0] = win.getSize(); pinnedSize = { w: w0, h: h0 } }
  dragSize = { w: pinnedSize.w, h: pinnedSize.h }   // 钉死尺寸：杜绝每拍 getSize 读回的 DPI 取整累积（坑 11）
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      // 兜底：窗口没了（退出/崩溃）就自己停，别让轮询空转
      clearInterval(dragTimer); dragTimer = null
      return
    }
    const m = screen.getCursorScreenPoint()
    if (dragTrace) { dragTrace.push({ x: m.x, t: Date.now() }); if (dragTrace.length > 2) dragTrace.shift() }
    win.setBounds({ x: wx + m.x - startMouse.x, y: wy + m.y - startMouse.y, width: dragSize.w, height: dragSize.h })
  }, 16)
})
ipcMain.on('pet:drag-end', (e) => {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
  dragSize = null
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win) saveState(win)   // 拖动结束记住位置
  // 重力模式：拖动链路完全收尾后才触发自由落体，带着抛掷初速度
  if (win && !win.isDestroyed() && gravityMode) {
    let vx0 = 0
    if (dragTrace && dragTrace.length === 2) {
      const dt = (dragTrace[1].t - dragTrace[0].t) / 1000
      if (dt > 0) {
        const sf = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1
        vx0 = (dragTrace[1].x - dragTrace[0].x) / dt / sf   // 光标是物理像素，窗口是 DIP，除掉缩放
      }
    }
    // 延迟一拍：让渲染层"回到待机"的尺寸消息先到（IPC 同通道保序），避免定格在走路姿势的尺寸
    setTimeout(() => { if (win && !win.isDestroyed() && gravityMode) startGravityFall(win, vx0) }, 60)
  }
  dragTrace = null
})

// 主动找你：窗口"飘过去看看"——附近随机飘几步，最后回原位（像探头看看你又缩回去）
ipcMain.on('pet:drift', () => {
  const win = currentWin
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  const [w, h] = win.getSize()
  let step = 0
  const total = 6
  const timer = setInterval(() => {
    if (step >= total) { clearInterval(timer); return }
    let nx, ny
    if (step >= total - 1) { nx = x; ny = y }           // 最后一步回原位
    else {
      nx = x + (Math.random() - 0.5) * 160               // 附近飘
      ny = y + (Math.random() - 0.5) * 100
    }
    win.setBounds({ x: Math.round(nx), y: Math.round(ny), width: w, height: h })
    step++
  }, 280)
})

// 滚轮缩放：以窗口中心为锚点改大小（缩放时人物位置不飘）
ipcMain.on('win:set-size', (e, args) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || !Array.isArray(args)) return
  const w = Math.round(Number(args[0]))
  const h = Math.round(Number(args[1]))
  if (!Number.isFinite(w) || !Number.isFinite(h)) return
  // 拖动中姿势变形：更新钉死尺寸 + 精确记忆（轮询下一拍应用），尺寸来源保持渲染层的精确 DIP
  pinnedSize = { w, h }
  if (dragTimer && dragSize) { dragSize.w = w; dragSize.h = h; return }
  const [cw, ch] = win.getSize()
  const [x, y] = win.getPosition()
  // setBounds 一次性带位置+尺寸，避免 DPI 取整误差让窗口越缩越大
  let nx = x + Math.round((cw - w) / 2)
  let ny = y + Math.round((ch - h) / 2)
  // 身体贴合变形后窗口尺寸随动作变：夹在所在屏幕工作区内，别让她飘出屏幕顶/外
  const wa = screen.getDisplayMatching({ x: nx, y: ny, width: w, height: h }).workArea
  nx = Math.min(Math.max(nx, wa.x), wa.x + wa.width - w)
  ny = Math.min(Math.max(ny, wa.y), wa.y + wa.height - h)
  if (gravityMode && onGround) ny = wa.y + wa.height - h   // 重力模式贴地锁：动作变形时脚底不飘
  win.setBounds({ x: nx, y: ny, width: w, height: h })
})

// 记住/读取缩放比例：重启后她还是你上次调好的大小（位置记忆的缩放版）
ipcMain.on('pet:save-scale', (_e, s) => {
  const v = Number(s)
  if (Number.isFinite(v) && v > 0) saveState(null, { scale: v })
})
ipcMain.handle('pet:get-scale', () => {
  const s = Number(loadState().scale)
  return Number.isFinite(s) && s > 0 ? s : null
})

app.whenReady().then(() => {
  createWindow()
  startControlServer(() => currentWin)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
