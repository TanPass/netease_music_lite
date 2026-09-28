# 网易云音乐 · 精简版

一个 Tampermonkey 用户脚本，把 `music.163.com` 重做成一个深蓝夜色的四页签播放器。

| 页签 | 内容 |
| --- | --- |
| **听歌** | 大封面 + 歌曲信息；**可点击可拖拽的进度条**；右栏 `歌词 / 评论` 双页签 —— 歌词**悬停放大、点击跳转到该句时间**，评论含热评/最新/楼中楼/点赞数；右上角**音质选择** |
| **搜索** | 自建搜索面板：单曲 / 歌手 / 专辑 / 歌单 四类，单曲点一下即播，其余点开看曲目 |
| **心动模式** | 网页版官方没有这个功能，脚本用官方智能播放接口自行实现 |
| **我的音乐** | 「我喜欢的音乐」大卡 + 创建的歌单 + 收藏的歌单，点开即看曲目、一键播放 |

站点原生的**顶栏和内容区整个隐藏**，只保留底部播放条（上一首/播放/下一首/进度/音量/收藏/播放列表）并把它一起调成同一色温。所有曲目列表**每行都带封面缩略图**。

---

## 一、配色

按要求使用给定主色：

| 用途 | RGB | HEX |
| --- | --- | --- |
| 主背景 | `rgb(20,21,33)` | `#141521` |
| 深蓝 | `rgb(45,60,129)` | `#2D3C81` |
| 亮蓝（强调色） | `rgb(78,164,239)` | `#4EA4EF` |
| 浅蓝灰（主文字） | `rgb(218,226,237)` | `#DAE2ED` |
| 暖棕（次级强调） | `rgb(147,117,98)` | `#937562` |

次级文字 / 描边 / 悬停底都由 `#DAE2ED` 与 `#4EA4EF` 调透明度派生，没有引入第六种颜色。

具体分工：

- **亮蓝 `#4EA4EF`** —— 当前页签下划线（带辉光）、歌名高亮、当前歌词行、进度条填充、当前音质选中态、卡片悬停描边。
- **深蓝 `#2D3C81`** —— 分段控件选中底、搜索按钮底、主按钮渐变终点。
- **浅蓝灰 `#DAE2ED`** —— 主文字，以及所有透明度派生的次级文字。
- **暖棕 `#937562`** —— 「最热」评论分组、评论楼中楼边线、「红心」标签、音质菜单里的 `VIP` 标。和蓝色系形成冷暖对比，避免整屏发蓝。

播放条是雪碧图画的，CSS 改不了它的颜色，所以在 `.m-playbar::before` 压了一层 `rgba(20,21,33,.46→.62)` 的深蓝渐变，把这块中性深灰拉回调色板；这层 `z-index: 0`，站点自己的 `.wrap`（`z-index: 15`）和 `.updn`（`z-index: 11`）仍然在它上面，不会盖住控件。

---

## 二、歌词、进度条、音质、封面

### 歌词：时间轴同步（翻译 / 罗马音 / 逐字）

**数据一次取全。** 走 `/api/song/lyric/v1`（拿不到就退回 `/api/song/lyric`，两个都**不需要登录**），参数 `cp=false&lv=-1&kv=-1&tv=-1&rv=-1&yv=-1&ytv=-1&yrv=-1`，一次拿回四样东西：

| 字段 | 是什么 | 时间轴 |
| --- | --- | --- |
| `lrc` | 主歌词 | `[mm:ss.xxx]` 逐行 |
| `tlyric` | 翻译 | 与主歌词**同一时间戳、行数一致** |
| `romalrc` | 罗马音（日语歌多半有） | 同上 |
| `yrc` | 逐字歌词（只有带 `yv=-1` 才返回，且并非每首歌都有） | 行首 `[行起始ms,行时长ms]`，每字 `(字起始ms,?,?)字` |

**渲染成「组」。** 每个主行开一个 `.nm3-lyric-grp`，它的翻译 / 罗马音作为同级行跟在后面 —— 这样同步时整组一起点亮、一起滚到中间，不会出现「主歌词亮了翻译没亮」：

- 当前组：主行变亮蓝放大，组里的翻译变亮、罗马音保持弱化（CSS 只认 `> .nm3-lyric-line`）。
- 逐字（有 `yrc` 时）：主行拆成 `<span class="nm3-ch" data-ct="秒">`，播放到哪点亮到哪；**往回拖会先清掉再重算**，换行时把上一行残留的点亮一并收掉。
- 点击任意一行（含翻译行）跳时间，右侧悬停浮出该行时间。
- 空歌词的正确说法：接口**没有歌词时仍然是 `code 200`**，所以判据是 `lrc.lyric` 为空 / `uncollected` / `sgc`（纯音乐）→ 分别显示「这首歌暂时没有歌词 / 歌词还在收集，暂时没有 / 纯音乐，请欣赏」。

**逐字时间轴的单位坑。** `yrc` 每字后面第 2、3 个数字的单位有「厘秒」和「毫秒」两种说法（文档说厘秒，实测相邻字起始时间之差恰好等于它 → 更像毫秒）。这里的取法是**只用字的起始时间、结束时间交给下一个字**，所以两种说法都不影响结果。

**翻译行数对不上时**（第三方上传的歌词常有半秒偏差甚至整体偏移）：行数一致就按顺序对齐（整体偏移也能对上），不一致就找 ±1 秒内最近的一行，实在对不上的直接丢掉，不会硬挂到错误的行上。`[offset:±ms]` 按 LRC 通行约定处理成「整体提前/推后」。

### 下载时附带的同名双语 .lrc

下载（写进「音乐」文件夹的那条路）会在音频旁边再写一份**同名** `.lrc`：

```
[ti:Lemon]
[ar:米津玄師]
[al:BOOTLEG]
[by:网易云音乐·精简版]
[offset:0]
[00:00.851]夢ならばどれほどよかったでしょう
[00:00.851]如果这一切都是梦境该有多好      ← 同一时间戳的第二行 = 翻译
```

- **同时间戳两行（原文 + 翻译）是国内播放器通用的双语写法**（网易云 PC、foobar + ESLyric、Poweramp 都认），所以翻译行写的是主行的时间戳（内部那 `+0.001` 的排序偏移不会漏进文件）。
- 文件名跟**实际存下来的音频名**对齐（音频可能被自动改名成 `… (2).mp3`），而且**同名直接覆盖** —— 播放器靠同名配对，写成 `(2).lrc` 就配不上了。
- 罗马音不进文件（三行同时间戳会互相打架）；没有歌词就不写文件，也不算失败。
- `CONFIG.DOWNLOAD_LRC = false` 可以整条关掉。走 `<a download>` 兜底存默认下载目录时**不写** .lrc（避免连续两次下载触发浏览器的「允许多文件下载」询问）。

### 歌词的其它交互

- 悬停某一行 → 该行 `scale(1.045)` 放大、变亮，**右侧浮出这一句的时间**（`data-t` + `::after`）。
- 点击某一行 → 跳到该句时间。用 `transform` 而非 `font-size` 做放大，不触发重排，滚动位置也不会抖。
- 跳转后重置歌词高亮索引并重新同步（逐字点亮也会跟着重算）。

### 进度条：自绘，可点击可拖拽

听歌页新增的进度条（`.nm3-seek`）：

- 点击定位、按住拖拽，拖拽时圆点左右跟随、并实时显示目标时间。
- 悬停在轨道上浮出「鼠标位置对应的时间」气泡。
- 左侧当前时间 / 右侧总时长，等宽数字。
- 拖拽时用 `nm3-dragging` 类把圆点常显（不依赖 `:hover`）。

跳转的实现见第四节 —— 关键是站点把进度条绑在 NEJ slider 上，而它的 `onslidestop` 里调的是媒体 seek。

### 音质选择

**网页版根本没有音质切换**，这是读线上代码得到的结论：

```js
// core_*.js，nm.w 的媒体模块
var DEFAULT_LEVEL = "exhigh";
var DEFAULT_ENCODETYPE = "aac";
...
t0K.bc8G("/api/song/enhance/player/url/v1", {
  query: { ids: JSON.stringify([this.cx2e.id]), level: DEFAULT_LEVEL, encodeType: DEFAULT_ENCODETYPE },
  ...
});
```

`DEFAULT_LEVEL` 是个闭包里的 `var`，**从不被修改**；播放条上那根音质图标（`data-action="audioQuality"`）打开的是 `m-audioQuality-layer`，处理 `download` / `orpheus` 两个动作 —— 那是个"下载 / 去客户端"提示层，不是切换器。

所以脚本接管了这件事，做法是**在站点发出取流请求之前改写 URL 里的 `level` 参数**：

```js
XMLHttpRequest.prototype.open = function (method, url) {
  return origOpen.call(this, method, rewriteLevel(url));   // level=exhigh -> level=<你的选择>
};
```

这样站点仍然用它自己的代码路径去取流 —— 缓冲、切 CDN、断流重试、续播位置全都由站点负责，脚本不和它的状态机打架；而且**每一首新歌都会自动套用**，不需要逐首干预。

提供的等级：

| 等级 | 说明 |
| --- | --- |
| 标准 | 128kbps |
| 较高 | 192kbps |
| 极高 | 320kbps · 网页版默认 |
| 无损 | FLAC · VIP |
| Hi-Res | 24bit · VIP |
| 超清母带 | Master · VIP |

安全措施：

- **选择前先探测**：用带 `__nm3probe=1` 标记的请求（该标记让改写逻辑跳过它）确认这首歌在该等级下真能拿到 `url`，拿不到就提示"这首没有该音质（可能需要黑胶 VIP）"并保持原选择，不会把播放搞坏。
- **换歌时再探测一次**：万一新歌没有该等级，自动临时降级为「极高」，并用默认音质把当前这首歌直接救回来（手动取 `url` 换 `audio.src`，保留播放位置与播放状态）。
- 选择持久化在 `localStorage['nm3-quality']`。

### 封面与元数据

**这一节也是真 bug 的产物**：截图上出现"大封面空白 + 未知专辑"，排查出两个独立原因。

**其一：`http://` 图被当混合内容拦掉。** 站点是 HTTPS 页面，而 `/api/v6/playlist/detail` 返回的 `al.picUrl` 是 `http://` 开头的（实测）：

```
/api/song/detail      album.picUrl = https://p1.music.126.net/…jpg
/api/v6/playlist/detail  al.picUrl = http://p1.music.126.net/…jpg   ← 混合内容
```

两者的 https 版本都返回 200，所以 `pic()` 统一把 `http://` 升成 `https://`。列表里那些缩略图正是来源 `v6/playlist/detail`，不升级就会整片空白。

**其二：播放器队列里的歌曲对象不一定带 `album` / `artists`。** 实测见过只有 `name` / `id` / `duration` 的，于是专辑显示"未知专辑"、封面无从取起。所以换歌时会额外拉一次 `/api/song/detail?ids=[id]` 把缺的字段补齐（`trackInfo()` 做合并，**队列自带的信息优先**，接口结果只补空缺），拿到封面后重绘一次。

兜底顺序：`trackInfo` 的封面 → 播放条上站点已渲染好的 `#g_player .head img` → 占位色块（不会出现破图）。

### 音质保险丝

万一个档位取不到流（会员过期、单曲没有该音质），音频元素会抛 `error`；脚本监听它并把档位降回默认的「极高」，这样**站点自己的重试逻辑下一次请求就会带上 `exhigh` 从而自愈**。用户的选择本身会保留（下一首仍会尝试），避免卡在"有歌但放不出来"。

另外 `setQuality()` 的流程改成了「先探测 → 再换流 → 换不成整体回滚」：只有真正换流成功才写入偏好，失败就保持原档位并提示，不会留下一个坏掉的持久化设置。

### 下载位置：系统「音乐」文件夹

**为什么要绕这么一圈。** 网页没有「往指定磁盘路径写文件」的能力：`<a download>` 只能落进浏览器**自己设置**的默认下载目录，脚本改不了那个设置（Tampermonkey 的 `GM_download` 也一样，它的 `name` 只是下载目录里的相对路径）。能改的只有 **File System Access API**（Chromium 系有，Firefox / Safari 没有）。

**做法。** 第一次下载时用 `showDirectoryPicker` 弹一次目录选择框，参数写成：

```js
showDirectoryPicker({ id: 'nm3-music', mode: 'readwrite', startIn: 'music' })
```

`startIn: 'music'` 让它**直接开在系统「音乐」文件夹**上 —— 用户点一次「选择文件夹」（或直接确定）即可。拿到的 `FileSystemDirectoryHandle` 存进 IndexedDB（句柄可以结构化克隆），之后每次下载：

1. 取出句柄 → `queryPermission({mode:'readwrite'})`：
   - `granted` → 直接 `getFileHandle(name, {create:true})` + `createWritable()` 写盘，**不弹任何框**；
   - `prompt` → 借这次点击的用户手势 `requestPermission()` 续期（浏览器出的是轻量授权气泡，不是选择框）；
   - 句柄失效（文件夹被删/改名/挪走）→ 清掉记录，重新弹一次选择框。
2. 同名文件不覆盖：`freeName()` 依次试 `歌名 - 歌手 [极高] (2).mp3`、`(3)` … 和浏览器自己下载的行为对齐。
3. 写一半失败 → `abort()` + 删掉半截文件，再把这份 blob 交给 `<a download>` 存进默认下载目录，不让用户白下一趟。

**拿不到句柄时**（Firefox / Safari、或用户在第一次选择框上点了取消）：原样退回 `<a download>`，下载照旧，只是落在浏览器默认下载目录。取消会被记成「就用默认目录」（`localStorage['nm3-dl-use-default-dir']`），不会每次下载都弹框；想改回来就 **Shift + 点击下载按钮**重新选一次。

**时序上的一个硬约束。** 选择框和授权续期都要求「用户手势」，所以 `ensureDownloadDir()` 必须在**取流之前**调用 —— 等 `await` 完 `resolveStream()` / `fetch()` 再弹，浏览器会当成没有手势直接 `NotAllowedError` 拒掉。

想要在音乐文件夹里再套一层，把 `CONFIG.DOWNLOAD_SUBDIR` 设成 `'网易云音乐'` 即可（默认空字符串＝直接放音乐文件夹根上）。

---

## 三、安装与用法

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开 Tampermonkey 面板 → 添加新脚本，把 `netease-music-lite.user.js` 的内容整段粘进去保存（或把 `.user.js` 直接拖进浏览器窗口）。
3. 打开 <https://music.163.com/>，点右上角「登录」。**心动模式、我的音乐、评论都要登录。**
4. 刷新页面。

- **听歌** —— 默认页签。拖进度条或点歌词跳转；右上角齿轮状的音质按钮切换音质；`歌词 / 评论` 切换右栏内容。
- **搜索** —— 右上角搜索框输入后回车。空态会列出**最近搜索**（存在本地，去重、最多 10 条，可清空），没有历史时给推荐词，点一下即搜。四个类型可随时切换。
- **心动模式** —— 用当前播放的歌当种子调官方智能播放接口。标签区分 **新歌**（算法发现）和 **红心**（你收藏过的）。「换一批」换种子。
- **我的音乐** —— 我喜欢的音乐大卡 + 创建/收藏的歌单；点进歌单是详情页。

---

## 四、怎么控制播放器的

站点自己会在内容 frame 里调顶层窗口的播放器，于是 core JS 里留下了这行：

```js
function ec8i(){ top.player.tipPlay("无法播放，音乐已下线") }
```

`window.top.player` 就是官方公开的跨 frame 播放器对象：

```js
player.addTo(songs, replaceQueue, playNow)   // 和点"播放"按钮走的是同一条路
player.getPlaying()                          // -> { track, playing }
player.pause() / setLike() / tipPlay() / hotkeys
```

它**没有 seek 方法**，所以跳转走的是另一条路：

```js
// core_*.js 里，媒体模块给每个方法做了代理
if (Fu2O === "setCurrentTime") { this[Fu2O] = function (value) { gW4i.seek(value) } }
else { this[Fu2O] = function (value) { Bv4W[bAl0a] = value } }   // Bv4W 就是 <audio>

// frame.js 里，进度条是 NEJ slider，onslidestop 时调媒体 seek
this.Nk6y = G8m.FR2C.B8y({
  track: this.MB6e, thumb: this.bdY4W, progress: k4K[1],
  onslidestop: function (d4m) { this.by0q.pC0i(this.by0q.bkQ8e() * d4m.ratio) }
})
```

所以 `seekTo()` 的策略是：

1. **直接改 `<audio>.currentTime`**（首选）—— 站点监听了 `timeupdate`，它自己的进度条和时间文本会跟着更新；
2. `player.seek` 如果哪天加了这个方法就用它；
3. **兜底**：按比例在站点自己的 `.m-pbar .barbg` 上模拟 `mousedown` → `mousemove` → `mouseup`，驱动那个 NEJ slider。

> 播放指定序号（点列表里的第 N 首）的做法是**把目标曲排到队首**，然后只调一次 `addTo(ordered, true, true)` —— 也就是站点自己「播放」按钮走的那条路。
>
> 早先版本用的是「先 `addTo(list, true, false)` 换队列、再 `addTo([list[i]], false, true)` 靠合并模式跳号」，它依赖播放器内部（每次构建都随机化标识符的）实现细节。第二跳一旦没生效，就会留下**"队列里有歌但完全没播"**的僵尸状态：歌名显示、进度 `00:00`、封面空白、状态显示"已暂停"。改成排到队首后全程只有一次调用，没有中途失败的可能。

### 接口实测：哪些能用，哪些是坑

**这一节是 v3.1 一个真 bug 的根因，值得单独写清楚。**

[NeteaseCloudMusicApi](https://binaryify.github.io/NeteaseCloudMusicApi/) 文档里的路径是**那个 Node 服务端自己的路由**，不等于 `music.163.com` 上的路径。我最初照文档写，结果搜索和心动模式都报"接口返回异常"。

更坑的是：**站点对「不存在的路由」也返回 HTTP 200**，body 里才是 `{"code":404,"message":"接口未找到！"}`：

```
GET /api/cloudsearch            HTTP 200  {"code":404,"message":"接口未找到！"}
GET /api/likelist?uid=1         HTTP 200  {"code":404,"message":"接口未找到！"}
GET /api/comment/music?id=…     HTTP 200  {"code":404,"message":"接口未找到！"}
```

只判断 `res.ok` 会把这些 404 当成成功响应，后面的结构检查一抛错，**兜底分支就永远不会执行** —— 表面上是"搜索失败"，实际是"主接口 404 + 兜底从未运行"。

修复：`apiGet()` 统一把「有 `code` 字段且不等于 200」视为失败并抛错（这样兜底才真的会跑），同时把所有路径换成下面这些**逐个 curl 实测过**的：

| 用途 | 实测可用的接口 | 备注 |
| --- | --- | --- |
| 搜索 | `GET /api/cloudsearch/pc?s=&type=&limit=&offset=` | weapi 形态，带 `al`/`ar`/`privilege` 和封面，结果最全 |
| 搜索兜底 | `GET /api/search/get?s=&type=` | 老的 api 形态（`album`/`artists`），**且 `album.picUrl` 为空** |
| 心动模式 | `GET /api/playmode/intelligence/list?id=&pid=&sid=&count=` | 只在登录后可用 |
| 评论 | `GET /api/v1/resource/comments/R_SO_4_<id>?limit=&offset=` |
| 评论兜底 | `GET /api/v1/resource/hotcomments/R_SO_4_<id>` | 只有热评，字段是 `hasMore` 不是 `more` |
| 歌词 | `GET /api/song/lyric?id=&lv=-1&kv=-1&tv=-1` |
| 取流（音质） | `GET /api/song/enhance/player/url/v1?ids=[id]&level=&encodeType=aac` |
| 账号 | `GET /api/nuser/account/get` → `{code:200, profile:null}` 表示未登录 |
| 歌单库 | `GET /api/user/playlist?uid=&limit=&offset=` | 无 `code` 字段 |
| 歌单曲目 | `GET /api/v6/playlist/detail?id=&n=&s=` |
| 专辑 / 歌手热门 | `GET /api/album/<id>` / `GET /api/artist/top/song?id=` |
| 歌曲详情 | `GET /api/song/detail?ids=[…]` |

一个关键取舍：`/api/likelist`（拿红心歌曲 id）是 404，所以「没有在播的歌时挑种子」改成读「我喜欢的音乐」歌单的 `trackIds`；这样少一个不可靠的依赖。

另外两个必须小心的地方：

- **`/api/playmode/intelligence/list` 未登录时返回的是 `{"success":false,"code":"500"}`，不是 301。** 光看 code 会把"未登录"误报成"接口异常"，所以脚本会再问一次 `/api/nuser/account/get` 来区分这两种情况。
- **`/api/nuser/account/get` 未登录时返回 `{code:200, profile:null}` 而不是报错**，所以登录判定要看 `profile` 是否为空，不能只看 `code`。

### 歌词高亮

站点造音频元素时用的是 `document.createElement('audio')`，而且**不挂到 DOM 上**（`frame.js`: `Bv4W = a6u.ds6q("audio")`），所以 `document.querySelector('audio')` 找不到它。脚本抢在站点脚本之前把 `Document.prototype.createElement` 包了一层，把这个 `<audio>` 抓出来 —— 歌词精确对轴、进度条读数、音质换流都靠它；抓不到就退化为读播放条上的 `#g_player .m-pbar .time em`（秒级）。

### 布局

`.g-iframe` 是 `position:absolute; top:0; height:100%`——**它铺满整个视口**，顶栏和播放条只是盖在它上面。既然现在两者都隐藏了，自绘面板只需要按「播放条多高」算底部边界：

```
页头   固定 top: 0，高 58px
面板   fixed top: 58px，高 = 视口高 - 58 - 播放条高(53)
```

`.m-playbar` 是 `position:absolute; top:-53px; height:53px`，挂在 `.g-btmbar`（`position:fixed; bottom:0; height:0`）里，正好是视口底部那 53px；播放条被折叠（`m-playbar-hide`）时脚本会把这段让出来。

面板底界不是「视口高 - 播放条高」算出来的，而是**直接读播放条的上边缘**（`getBoundingClientRect().top`），这样即使播放条位置异常也不会被盖住；同时给 `.g-btmbar` 加了 `z-index: 1002 !important`、给它和 `.wrap` 加了 `pointer-events: auto !important`，保证任何自绘层都压不住、拦不住播放控件。

> **站点自带的窄视口问题（v3.2 修）**：播放条内容被写死成 1030px，用 `left:50%; margin-left:-490px` 居中，而 `position:fixed` 的播放条**不随页面横向滚动**。视口窄于 980px 时左边缘就是负数，「上一首 / 播放 / 下一首」被推出屏幕且永远点不到（站点自己有 `body{min-width:982px}`，但那只能让页面横向滚，救不了 fixed 定位的元素）。
>
> 2.5K 屏（2560px）在 Windows 250%~300% 缩放下，CSS 视口只有 850~1020px，正好落在这个区间 —— 这就是"播放按键太靠左、点不到"的原因。脚本在 `layout()` 里按实测视口宽度算一个 `scale` 给 `.m-playbar .wrap`（`transform-origin: center`，缩放后仍居中），视口够宽时 `scale = 1`，**什么都不做**：

  | 屏幕缩放 | CSS 视口 | 站点原样左边缘 | 适配后左边缘 | 缩放 |
  | --- | --- | --- | --- | --- |
  | 2560 原生 | 2560px | 790px | 790px | 1.000（不动） |
  | 2560 @200% | 1280px | 150px | 150px | 1.000（不动） |
  | 2560 @250% | 1024px | 22px | 33px | 0.979 |
  | 2560 @275% | 931px | **-25px（屏幕外）** | 33px | 0.888 |
  | 2560 @300% | 853px | **-64px（屏幕外）** | 33px | 0.813 |
  | 2560 @320% | 800px | **-90px（屏幕外）** | 33px | 0.761 |

  用 JS 算而不是 CSS `calc(长度/长度)`，后者兼容性不稳。

> **v2 的另一个真 bug（v3 起修掉）**：站点的 `.g-bd` 用 `margin-top:-75px; padding-top:75px` 把自己顶到顶栏下面。v2 只覆盖了 `padding-top`，负 margin 还在，搜索结果顶部实际停在 `y=47`，被顶栏和页签条盖住了一截。v3 起内容区整个不用了，坑自然消失。

### 只藏不删

站点的 `top.matchNav()` / `scrollTopbar()` 会操作 `#g-topbar`、`#g_nav2`，把节点删掉会抛错，所以精简全部用 CSS `display:none` 完成。

---

## 五、点赞与收藏（写操作）

这两个动作以前是「点了没反应」，失败时也只吐一句笼统的「稍后再试」。现在按站点自己的口径发请求，并把服务端原话翻成人话。

### 评论点赞

- 点赞 `POST /api/v1/comment/like`，取消 `POST /api/v1/comment/unlike`（线上实测两条路由都在；不存在的路由回的是 `{"code":404,"message":"接口未找到！"}`）。
- 请求体只有三个字段：`threadId=R_SO_4_<歌曲>`、`commentId`、`csrf_token`（取自 cookie `__csrf` —— 站点自己的 NEJ 请求层 `gG2G` 也是从 `document.cookie` 读的，所以这个 cookie 一定不是 HttpOnly）。
- **`type` 是「资源类型」而不是点赞开关**（0=歌曲 1=MV 2=歌单…）：早先脚本把点赞 / 取消做成了同一个路由上的 `type=1/0` 开关，于是**取消点赞发到了 `/comment/like` 上**（官方那条是 `/unlike`）。实测带不带 `type`、传 0 还是 1，这条路由都只按 `threadId` 走（未登录一律回 `301`），所以现在按官方口径发：路由区分点赞/取消、`type` 固定 `0`；万一对面只认 `/like + type=0`，取消那条失败后会自动换口径重试一次。
- 失败原因如实显示：`301` 未登录、`400` 参数 / 资源 id 不被接受、`-460 / -462` 被风控（提示网络环境存在风险）、`404` 接口变了。**成功才动数字**，失败不会假装加上了。

### 收藏（红心）

1. 先判断当前是不是已收藏：`/api/user/playlist` 里找 `specialType: 5`（我喜欢的音乐），再取 `/api/v6/playlist/detail` 的 `trackIds`；`trackIds` 为空时退回 `tracks`（少数接口版本会这样）。
2. 直接打站点网页版自己那条 `POST /api/radio/like`：`alg=itembased`、`trackId`、`like`、`time=3`（★ 是**写死的字符串 `3`**，不是毫秒时间戳）、`csrf_token`，并带上客户端姿态参数。**`like` 只有字符串 `'false'` 才算取消**，其它任何值都当收藏。
3. 这条没成（比如风控 `-460`）→ 退回复用站点自己的 `window.subscribe(track, false)`（播放条那个 ♡ 走的就是它）→ 再不成才点原生按钮。
4. 最后**用真实状态校验**：900 ms 后重新拉一次「我喜欢的音乐」，状态真的变了才说「已收藏 / 已取消收藏」，没变就说清楚原因。

> 为什么不能只调 `window.subscribe`：`core.js` 里它是 `if (bJ6O.nm && bJ6O.nm.x) { … }` —— 内容 iframe 还没起来、或顶层 `window.GUser` 还没写进来时，它**什么都不做也不报错**，脚本却当成收藏成功。这是「点了收藏没反应」最可能的来源。

### 出问题怎么反馈

写操作都会往控制台打 `[云音乐·精简版]` 日志，并同时记进 `window.__nm3LikeLog`（最近 20 条：时间、接口、参数、服务端返回的 `code` / `message`）。F12 里执行 `copy(window.__nm3LikeLog)` 就能把原话贴出来 —— 有它就能一眼看出是没登录、被风控，还是接口变了。

> **诚实说明**：写操作要**登录态**才能端到端验证，本机做不到（只能验证到「未登录回 `301`」这一层）。所以这一版修的是**确定的缺陷**（取消点赞的路由、静默无反馈、状态读取回退、参数与客户端姿态口径）＋**把不确定性变得可见**。如果点了还是不行，控制台 / `__nm3LikeLog` 里的 `code` 就是答案。

---

## 六、已知限制

- **必须登录。** 心动模式、我的音乐、评论都要读账号数据；未登录时相应面板会给出「立即登录」按钮（内部调 `top.login()`）。
- **接口路径依赖站点而非常量。** 上表那些路径是实测出来的，网易随时可能改。脚本对每个关键路径都留了兜底和可读的错误信息，但如果哪天全面重构，需要重新实测。
- **音质是脚本接管的，不是官方 Web 功能。** 站点每次取流时 `level` 会被改写；如果哪天站点换了取流接口或者改用别的参数名，音质选择会静默失效（退回站点默认的极高），不会报错。
- **无损/Hi-Res/母带需要黑胶 VIP。** 没有会员时选择会被探测拦下并提示，不会把播放搞坏。个别歌曲本身没有高音质版本，也会被同样拦下。
- **「听歌」页不显示原生播放队列。** 站点把队列存在 `localStorage['track-queue']` 里且没有公开的读取接口。想看原生队列点播放条右侧的「播放列表」按钮。
- **心动模式是脚本还原的，不是官方 Web 功能。** 接口是官方给 App 用的那条，网易有权随时改动或下线。
- **搜索只做四类**（单曲/歌手/专辑/歌单），没有 MV、电台、歌词、用户。这是刻意的取舍。
- **单个歌单最多读 1000 首**（`CONFIG.MAX_PLAYLIST_TRACKS`）。
- **下载重定向到「音乐」文件夹只在 Chromium 系浏览器（Chrome / Edge / Brave）有效。** 它靠 File System Access API；Firefox / Safari 没有这个 API，脚本会如实退回浏览器默认下载目录，不做任何假装成功的提示。另外文件夹句柄的授权在部分浏览器里每个会话都要续一次（一次点击触发的小气泡，不是重新选文件夹）。
- **点赞 / 收藏这类写操作需要登录，而且可能被风控。** 未登录服务端回 `301`（HTTP 仍然是 200）；被判定网络环境有风险回 `-460 / -462` —— 脚本无法绕过风控，只会如实说明（官方给的绕过办法只有换国内出口 IP）。
- **逐字歌词（`yrc`）只有部分歌曲有**，而且要请求带 `yv=-1` 才返回；没有就退化成整行高亮（功能不受影响）。罗马音（`romalrc`）同样不是每首都存在。
- **本脚本没在真实浏览器里跑过。** 见下方"验证情况"。

---

## 七、验证情况

已验证（可复现）：

- **页面结构**：`.g-topbar`、`#g_iframe`、`.m-playbar`、`#g_search`、`.g-bd` —— 来自线上抓取的 HTML/CSS/JS 原文。
- **布局常量**：`.m-top{height:70px}`、`.m-playbar{top:-53px;height:53px}`、`.g-iframe{position:absolute;top:0;height:100%}`、`.g-bd{margin-top:-75px;padding-top:75px}` —— 来自线上 CSS 原文。
- **播放器 API**：`window.player` 的方法（`addTo / getPlaying / pause / setLike / tipPlay / hotkeys`）与"没有 seek"这一点 —— 来自 `pt_frame_index_*.js` 原文。
- **音质**：`var DEFAULT_LEVEL = "exhigh"` 且从不改变、`m-audioQuality-layer` 只处理 `download`/`orpheus` —— 来自 `core_*.js` 原文。
- **进度条**：NEJ slider 绑在 `.bargb`、`onslidestop` 调媒体 seek —— 来自 `pt_frame_index_*.js` 原文。
- **心动模式**：`PlayMode` 只有 3 种、`心动` 全站 0 次 —— 来自线上 JS 原文；接口语义 —— 来自 [NeteaseCloudMusicApi 官方文档](https://binaryify.github.io/NeteaseCloudMusicApi/)。
- **接口路径全部 curl 实测过**（见第四节表格）。站点的路由和 NeteaseCloudMusicApi 服务端的路由不是一回事，且**不存在的路由也返回 HTTP 200**，所以任何新加接口都必须先实测。
- **静态检查**：`node --check` 通过；CSS 花括号配平、圆括号配平、无双重分号；CSS 类名全部在 JS 中有引用（无拼写漂移）；`data-act` 与 `ACTIONS` 表双向完全对齐；五个给定 RGB 确认存在。
- **接口层回归测试**：专门覆盖这次那个 bug —— `code:404` / 字符串 `code:"500"` / `code:301` / HTTP 5xx 都正确抛错；主搜索接口 404 时**真的回退**到第二个并拿到结果；参数名是 `s` 不是 `keywords`；结构不符也回退；`profile:null` 判为未登录；`pickSeed` 不再触碰已失效的 `/api/likelist`。
- **播放条适配测试**：按 11 种视口宽度（2560 原生 ~ 2.5K@320%）实测计算缩放与左边缘，验证窄屏按钮从屏幕外被拉回可见区（左边缘恒 >= 33px、按钮右边界不越界），且宽屏 `transform` 为空字符串（完全不动站点布局）。
- **封面 / 播放 / 音质回归测试**：`pic()` 把 `http://` 升成 `https://`（含已有 query 时用 `&` 拼接）；`trackInfo()` 在队列对象缺 `album`/`artists` 时用 `/api/song/detail` 补齐、队列自带信息优先、id 不匹配不串用；`playList()` **只调一次** `addTo` 且把目标曲排到队首（`[3,4,1,2]`）、index=0 顺序不变、越界回落、空列表不炸；播放条显示 `00:00 / 00:00` 时时长兜底到歌曲元数据而不是返回 0；音质 `error` 保险丝把档位降回 `exhigh` 且保留用户偏好。
- **下载位置重定向（音乐文件夹）**：把脚本里那段原样抽出来，用桩 `showDirectoryPicker` / `indexedDB` / 目录句柄跑了 6 组流程测试 —— 无 FSA 直接退回默认目录、选一次后静默复用（不再弹框）、权限 `prompt`→`granted` 续期、`denied` 或句柄失效后重选、取消后不再纠缠（Shift 点击可重选）、同名自动改名 `(2)`、写失败删掉半截文件、`DOWNLOAD_SUBDIR` 按需建子文件夹 —— 全部通过。
- **歌词 + 点赞/收藏回归测试**（`node netease-music-lite.lyric-like.test.cjs`，13 组）：把歌词段与点赞/收藏段原样抽出来跑桩 —— LRC 多时间戳 / `[offset:]` / 元数据行、`yrc` 逐字解析（真实片段）、翻译与罗马音挂行（行数一致按序、不一致按 ±1 秒就近、对不上就丢）、分组渲染（主 + 译 + 罗同组）、当前组一起点亮、逐字随播放点亮且往回拖会重置、双语 `.lrc` 文本（原文与翻译同时间戳）；评论点赞走 `/like`、取消走 `/unlike`、换口径重试、`301/400/-460` 各自的提示语；收藏的 `alg/trackId/like/time=3/csrf/客户端姿态` 参数、`like=false` 才是取消、接口失败退站点 `subscribe`、**成功才报成功**（状态校验）、未登录提示登录；`trackIds` 空时退回 `tracks`。
- **写操作的线上实测（未登录，只读探测）**：`/api/v1/comment/like` 与 `/api/v1/comment/unlike` 都在（回 `301`），裸 `threadId` 回 `400 illegal resourceId!`，假路由回 `404`；`/api/radio/like` 不带客户端姿态回 `-460`（风控），带上 `os=pc; appver; channel; osver` 这套 cookie 就回正常的 `301`；`/api/song/lyric/v1` 一次拿回 `lrc` + `tlyric` + `romalrc`（Lemon，1761 / 969 / 2190 字节）。★ 带登录态的**写入结果**本机验不了，见上一条"诚实说明"。
- **渲染**：用极简 DOM 桩**真正执行**了全部渲染函数，48 项检查全部通过且 HTML 标签完全闭合：

  | 分组 | 覆盖场景 |
  | --- | --- |
  | 构建与布局 | 页头、面板骨架、1440×780 下 h=58 / top=58 / h=669 |
  | 听歌 | 正在播放、进度条与气泡、音质菜单容器、歌词 |
  | 歌词交互 | 每行带 `data-act=seek` / `data-sec` / `data-t`，文本转义 |
  | 曲目行封面 | `album` 格式、`al`/`ar`/`dt` 格式、无封面不渲染破图、`param=80y80` |
  | 音质菜单 | 选中态唯一、切档跟随、VIP 标 |
  | 评论 | 热评+最新+更多、空 |
  | 搜索 | 空态（无历史→推荐词 / 有历史→最近搜索+清空）、历史去重且最新在前、单曲、歌手、专辑、歌单、错误 |
  | 详情 | playlist / album / artist |
  | 心动 / 我的音乐 | 列表、加载、未登录、歌单库、空库 |
  | 转义 | 歌单名、评论内容里的 `<` `>` `&`，无原样 `<script>` |

未验证（需要你在浏览器里实际跑一次）：

- 四个页签的实际观感与像素级定位，尤其播放条那层深蓝叠加、歌词悬停缩放的观感；
- **音质切换的真实效果** —— 端到端只有浏览器里才能验（要登录态，且高音质要会员）；
- **点赞 / 收藏的写入结果** —— 要登录态，本机只能验到「未登录回 301」；脚本已经把失败原因和诊断窗口做好了，真出问题时看 `window.__nm3LikeLog`；
- **歌词的观感** —— 翻译 / 罗马音的行距、当前组放大、逐字点亮的节奏，只有浏览器里看得出好不好看；
- **下载落进「音乐」文件夹的真实观感** —— 第一次那个目录选择框是否正好开在「音乐」上、授权气泡的频率，只有浏览器里能看；
- 进度条拖拽、歌词点击跳转的实际手感；
- `player.addTo` 播放指定序号的真实表现；
- 评论 / 心动模式 / 歌单接口在你账号下的实际返回。

如果哪一步不对，按 F12 看控制台里 `[云音乐·精简版]` 前缀的日志，或把现象告诉我。

---

## 八、可调参数

```js
const CONFIG = {
  BAR_H: 58,                 // 自绘页头高度
  HEART_COUNT: 30,           // 心动模式一次取多少首
  SEARCH_LIMIT: 40,          // 搜索一次取多少条
  COMMENT_LIMIT: 20,         // 评论每页多少条
  MAX_PLAYLIST_TRACKS: 1000, // 单个歌单最多读多少首
  SONG_DETAIL_BATCH: 500,    // /api/song/detail 单次批量上限
  DOWNLOAD_SUBDIR: '',       // 下载目录：选定「音乐」文件夹后再往里放的子文件夹名（空=直接放音乐文件夹）
  DOWNLOAD_LRC: true,        // 下载时顺便把双语 .lrc（带时间轴）写到同一个文件夹
  TICK: 300                  // 轮询间隔（毫秒）
};
```

其他：#937562 相关的 `PALETTE`、音质档位 `LEVELS`、搜索推荐词 `SEARCH_SUGGEST`。

---

## 文件

- `netease-music-lite.user.js` —— 用户脚本本体（约 4400 行，含完整中文注释）
- `netease-music-lite.README.md` —— 本文件
- `netease-music-lite-安装指南.md` —— 给不写代码的人看的安装 / 使用 / 排错指南
- `netease-music-lite.download-dir.test.cjs` —— 下载位置（音乐文件夹）那段逻辑的回归测试，`node netease-music-lite.download-dir.test.cjs` 直接跑（见"验证情况"）
- `netease-music-lite.lyric-like.test.cjs` —— 歌词时间轴（翻译 / 罗马音 / 逐字）+ 评论点赞 / 收藏的回归测试，`node netease-music-lite.lyric-like.test.cjs` 直接跑（见"验证情况"）
