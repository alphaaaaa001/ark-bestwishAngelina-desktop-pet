# ⚠️ 需自行下载 Electron

> 本项目**不内置** Electron（体积大 + 二进制下载易被墙）。运行前请用下方镜像命令自行安装，然后 `npm start`。

---

# 🐾 安洁莉娜 桌面宠物

> **基于 Electron + webm 的安洁莉娜透明桌面宠物：9 种动作、滚轮缩放、拖动走路、随机互动，无需 GPU。** webm素材来自《明日方舟PRTS》，仅供学习交流。
>
> Arknights Angelina desktop pet built with Electron + webm: 9 animations, wheel zoom, drag-to-walk, random interactions. No GPU required. Assets from Arknights, for learning only.

她会待在你屏幕角落，等你戳她、拖她、让她陪你摸鱼。

> 不需要 GPU / WebGL——普通核显笔记本也能跑。

## ✨ 功能

| 操作 | 效果 |
|---|---|
| **点击** | 随机互动：撒娇 / 小招 / 技能，弹台词气泡 |
| **按住拖动** | 她走路的姿势移动；松手记住位置，下次启动还在这 |
| **鼠标滚轮** | 放大 / 缩小她（最小 30% ~ 最大 200%），窗口跟随收放 |
| **右键** | 菜单：撒娇 / 坐下 / 睡觉 / 醒来 / 放大招 / 退出 |
| **平时** | 待机 + 每 9~21 秒随机做一个动作、说句话 |

9 个动作：待机 / 走路 / 坐下 / 撒娇 / 放松 / 睡觉 / 小招 / 大招 / 攻击，全部来自官方 webm 素材，黑底会被 Electron 透明窗口自动吃掉，只留下她。

## 🚀 快速开始

```bash
# 1. 安装 Electron（国内镜像，十几秒；不用镜像会被 GitHub 卡住）
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install --save-dev electron

# 2. 启动
npm start
```

> 若无法运行：先看下方「常见问题」，本机实测过的坑都写在那。

## 📁 文件结构

```
cc-desktop-pet/
├─ main.js          # 主进程：透明置顶窗口、拖动手势、右键菜单、位置记忆
├─ preload.js       # 安全 IPC 桥
├─ index.html       # 页面：容器 + 视频 + 气泡
├─ renderer.js      # 渲染：动作状态机、bbox 裁剪定位、交互、随机小动作
└─ assets/          # 9 个动作的 webm 素材
```

## ⚙️ 技术说明（写给想折腾的人）

- **黑底透明原理**：素材是 RGB(1,1,1) 的伪黑幕，Chromium 在合成时会剔除接近纯黑的像素，透明窗口因此只露出人物，无需抠图。
- **人物裁剪定位**：素材画布统一 1000×1000，人物只在其中一块区域。每个动作记录 bbox，用「绝对定位 + object-fit:fill + overflow:hidden 容器」把 bbox 区域精确居中放大到窗口——不要用 transform + object-fit:none，在 DPI 缩放下会错位（实测的坑）。
- **拖动手势**：由主进程轮询 `screen.getCursorScreenPoint()` + `setBounds` 移动窗口——DPI 缩放下渲染进程的 `PointerEvent.screenX` 与主进程坐标单位不一致，会让窗口跑偏/加速（实测的坑）。
- **位置记忆**：存在 `%APPDATA%/cc-desktop-pet/pet-state.json`，删掉即重置位置。
- **动画切换**：所有视频预加载但**错峰**（无 GPU 机器上 9 个 webm 同时解码会卡）。

## 🐛 常见问题

- **窗口拖动时变大/跑偏** → 已修复（主进程 setBounds 轮询）。若还异常，检查系统 DPI 缩放比例。
- **动画播完变透明** → 已修复（同源续播 + 预加载）。若切换动作有加载空窗，说明机器解码慢，可减少预加载数量。
- **黑底没被吃、人物带黑框** → Electron 版本过旧，或窗口没设 `transparent: true`。
- **npm 装 Electron 卡死** → 用上面的 `ELECTRON_MIRROR` 国内镜像。

## 📄 素材与版权

- 角色：安洁莉娜（《明日方舟》，鹰角网络 / Hypergryph）
- 动作 webm：方舟官方网页素材（PRTS），**仅个人学习交流，请勿用于任何商业用途**。
- 本项目基于 Electron，MIT License。代码可自由使用，但**请遵守素材版权**。

---

*Made with 💛 by 何林霜 & 克洛伊（CC）*
