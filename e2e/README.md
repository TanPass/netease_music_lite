# 端到端冒烟测试（真实浏览器 + 模拟站点）

`node *.test.cjs` 那几套是 Node 桩测试：把脚本里某一段原样抽出来跑，快、准，但**不跑整份脚本**。
这个目录补上最后一块：用真正的浏览器把整份 userscript 跑起来，看四个页签、点行播放、歌手页、
收藏是不是真的按预期动。

## 怎么跑

```bash
# ① 起一个迷你静态服务器（把 mock.html 和上一级的 userscript 用 http:// 提供出来）
node e2e/server.cjs                      # → http://127.0.0.1:8791/mock.html

# ② 用 Chrome / Edge 无头模式打开它，等驱动跑完，截图看结果
#    Windows 上 Edge 一般在这里：
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1500,1250 --virtual-time-budget=45000 \
  --screenshot=e2e/artist-page.png http://127.0.0.1:8791/mock.html
```

截图底部那条深色横条就是测试报告（`RESULT OK  jsErrors=[]` 加各步结论）。

## 它模拟了什么

- **站点骨架**：`.g-topbar` / `#g_iframe` / `.g-btmbar > .m-playbar`（含 `data-action` 控件）、
  一个 `<audio>`、`window.GUser`、`window.player`（只会被用到的 `addTo` / `getPlaying`）。
- **接口**：`fetch` 被换成桩，覆盖脚本用到的每个路由。**其中 `/api/radio/like` 故意回
  `-460`（风控）** —— 复现用户那边「收藏没用」的环境，用来证明新的多口径流程能兜住。
- **封面**：歌单 / 专辑封面用真实的「合成封面」URL（`?imageView=1&thumbnail=800y800&…&watermark&…`），
  用来盯住 `pic()` 有没有把尺寸追加到 ops 链末尾（丢 query 会只剩模糊底图，改写前面的
  thumbnail 会把合成弄丢）。

## 驱动步骤（像用户那样点，不调内部函数）

1. 搜「周杰伦」→ 点第 2 行 → 断言 `player.addTo` 播的是**搜索结果**里那一首；
2. 切「歌手」→ 点歌手卡片 → 断言两个页签、全部歌曲 50 首 + 加载更多、`meta=歌手 · 106 首`；
3. 点「加载更多」→ 100 首；
4. 切「专辑」→ 30 张卡片、封面 URL 末尾带 `thumbnail=300y300` 且仍保留 `imageView`；
5. 点一张专辑 → 点「返回」→ 断言回到歌手页（详情栈）；
6. 点 ♡ → 断言 toast「已收藏到「我喜欢的音乐」」，且写请求走的是 `/api/v1/radio/like`；
7. 手动把一张封面写成不存在的地址 → 断言 `error` 兜底把它换掉。

改脚本之后重跑一次，报告里任何一步不对都看得见。
