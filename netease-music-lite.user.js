// ==UserScript==
// @name         网易云音乐 · 精简版（听歌 / 搜索 / 我的音乐）
// @namespace    https://music.163.com/
// @version      4.7.0
// @description  把网易云音乐网页版重做成深蓝夜色的三页签播放器：听歌（大封面 + 歌词上方的完整播放控制台：上一首/播放暂停/下一首、进度条、播放模式、音量、可展开点歌的播放列表、收藏、分享、下载 + 可点赞的评论 + 悬停放大/点击跳转的歌词 + 音质选择 + 专辑/歌手点进去看详情、歌手带简介）、搜索（歌曲/歌手/专辑/歌单）、我的音乐。取流按 PC 客户端姿态发（os=pc / appver），网页播放器不给播时需要同一账号在客户端能播的内容，脚本会直接取流播放并支持下载（下载默认重定向到系统「音乐」文件夹，并附一份同名双语 .lrc 歌词；歌词本身带时间轴同步：翻译 / 罗马音 / 逐字点亮）。站点导航与内容区移除，底部播放条整体让位 —— 它的全部功能都搬到听歌页歌词上方。
// @author       TanPass
// @match        https://music.163.com/*
// @match        https://www.music.163.com/*
// @icon         https://s1.music.126.net/style/favicon.ico
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * ───────────────────────────────────────────────────────────────────────────
 *  设计说明（阅读源码前请先看这一段）
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  一、整体策略：全接管
 *
 *     站点原生的顶栏（#g-topbar）和内容 iframe（#g_iframe）整个隐藏，底部
 *     播放条（.m-playbar）也不再出现 —— 页头 + 三个页面全部由本脚本绘制，
 *     所以配色、间距、状态是一套；也不会出现“站点浅色页面和自绘深色面板打架”。
 *
 *     但没有删掉播放条：**它的全部功能都搬到听歌页歌词上方**（见第五节），
 *     自绘控件按下时把动作合成事件转发回播放条上那些原生控件，走的完全是
 *     官方那条代码路径 —— 播放状态机、音量持久化、播放模式、队列面板、
 *     收藏这些都不用自己重写一遍，也就不会跟站点打架。
 *
 *     实现上只把播放条自己的零件（背景 / 上下一首 / 封面 / 进度 / 收藏分享 /
 *     音量·模式·列表·音质）用 visibility 藏起来，容器本身留着：队列浮层
 *     （#g_playlist）就挂在这个容器里，藏容器会把它一起藏掉。之所以用
 *     visibility 而不是 display，是因为站点那些 NEJ slider、offsetWidth、
 *     getBoundingClientRect 还要照常工作（转发事件要靠它们的真实矩形）。
 *
 *  二、调色板
 *
 *        主背景  rgb(20,21,33)    #141521
 *        深蓝    rgb(45,60,129)   #2D3C81
 *        亮蓝    rgb(78,164,239)  #4EA4EF   ← 强调色
 *        浅蓝灰  rgb(218,226,237) #DAE2ED   ← 主文字
 *        暖棕    rgb(147,117,98)  #937562   ← 次级强调（“最热”评论）
 *
 *     次级文字 / 描边 / 悬停底都由 #DAE2ED 与 #4EA4EF 调透明度得到。
 *
 *  三、布局（实测 music.163.com 2025 版）
 *
 *       .g-iframe 是 position:absolute; top:0; height:100% —— 它铺满整个
 *       视口，顶栏和播放条只是盖在它上面（所以不能按 iframe 的 rect 算
 *       可用高度，那会得到整个视口）。播放条不显示了以后，自绘面板直接从
 *       页头下面一路铺到视口底部：top = 页头高，height = 视口高 - 页头高。
 *
 *       .m-playbar 是 position:absolute; top:-53px; height:53px，挂在
 *       .g-btmbar（position:fixed; bottom:0; height:0）里。它现在只是
 *       「看不见的原生控件壳」，尺寸和位置照旧。
 *
 *       站点的 .g-bd 用 margin-top:-75px / padding-top:75px 把自己顶到顶栏
 *       下面。现在整块内容区都不用了，这个坑也就不存在了。
 *
 *  四、播放能力来自站点自己公开的跨 frame 播放器对象 —— core_*.js 里就有
 *     `top.player.tipPlay("无法播放，音乐已下线")`，即 window.top.player：
 *
 *         player.addTo(songs, replaceQueue, playNow)   // 点“播放”同一条路
 *         player.getPlaying() -> {track, playing}
 *         player.pause() / setLike() / tipPlay() / hotkeys
 *
 *     注意：网易的 JS 每次构建都随机化标识符（b8q / caZ2m / sD6O …），
 *     但 window.player 是站点自己跨 frame 依赖的契约，相对稳定；仍备了
 *     DOM 兜底（合成 a[data-res-action=play] 点击）。
 *
 *  五、歌词上方的播放控制台（底栏功能的落点）
 *
 *     播放条上每个控件都是服务端渲染好的 <a data-action="...">：
 *
 *         prev / play / next          上一首 / 播放暂停 / 下一首
 *         like / share                收藏 / 分享
 *         volume / mode / panel       音量 / 播放模式 / 播放列表
 *         audioQuality                音质（脚本自己有一套更好的，不用它）
 *
 *     所以搬过来的是「操作入口」，不是「播放逻辑」：自绘按钮按下时用
 *     MouseEvent 合成一次点击（带元素矩形中心的真实坐标）转发过去，站点
 *     完全按自己的代码路径处理 —— 模式轮换、队列浮层、音量持久化都不需要
 *     脚本重写，也不会跟站点状态打架。音量那根是 NEJ 竖滑条
 *     （.m-vol .vbg，顶部=100%），转发时按这个几何合成按下/移动/抬起。
 *
 *     ★ 两个坑，都踩过：
 *       1. **我们自己的点击不能再冒到 document。** 站点在 document 上挂了
 *          「点别处就收起播放列表 + 藏音量条」（frame.js 的 b8q.uK4y）。点
 *          「播放列表」转发出去、面板刚建好，同一个点击继续冒上去就把它自己
 *          关掉了 —— 表现是「点了没反应」。所以 ctl-* 这些转发按钮就地
 *          stopPropagation（转发是另外合成的点击，由站点在 .m-playbar 上的
 *          分发器处理，不受影响）。
 *       2. **音量转发要打标记。** 合成事件同样会冒到 document，被脚本自己的
 *          拖拽处理再吃一遍；音量转发里又会合成 mousemove，不打标记就是无限
 *          递归（见 fireMouse 的 __nm3Forwarded）。
 *
 *     状态显示：播放/暂停读 player.getPlaying()；播放模式读原生模式按钮的
 *     title（随机 / 循环 / 单曲循环）；播放列表条数读原生列表按钮的文字；
 *     收藏直接调站点的 window.subscribe(track, isProgram)（就是 playbar
 *     收藏那条路径，比点按钮少一堆副作用），状态用「我喜欢的音乐」的
 *     trackIds 自己维护一份集合。
 *
 *     播放列表不是自绘的：点「播放列表」会把站点那块队列面板（#g_playlist）
 *     展开成右下角抽屉 —— 里面是官方列表，点行换歌、单曲删除/下载/分享/收藏、
 *     收藏全部、清除、关闭全是它自己的逻辑，脚本只做三件事：把它从「挂在播放条
 *     上、位置随站点布局飘」摆成固定抽屉、把用不上的装饰去掉、同步按钮状态。
 *     所以队列内容永远和站点一致（包括刷新后恢复的队列）。为了不把行里那串
 *     定宽列（.col-1…col-6 ≈542px）挤坏，抽屉宽度按 .listbdc 原本的 553px 定成
 *     570px；头部因为站点是按 976px 绝对定位摆的，这里改成 flex。
 *     另外 layout() 不再给播放条的 .wrap 加 transform：那会让 position:fixed
 *     的抽屉以 .wrap 为包含块而被一起缩放 / 错位。
 *
 *     歌手名（带 id 的那些）做成链接，点进歌手详情：详情借用「搜索」视图展示，
 *     数据来自 /api/v1/artist/<id>（名字/封面/简介）+ /api/artist/top/song（热门
 *     曲目）；听歌页的专辑名同样可点（/api/v1/album）。★ id 为 0 / 缺失的不做成
 *     链接（用户上传的翻唱很多是这样，免得去请求 artist/0）；队列对象里缺 id 时用
 *     详情补回来的那份 —— 注意 /api/song/detail 现在只回精简版（没有 ar/al），
 *     所以 songDetail() 走 v3 → v1 → 老接口降级。
 *
 *     歌词：/api/song/lyric/v1（拿不到退 /api/song/lyric）一次取回 lrc（时间轴）+
 *     tlyric（翻译）+ romalrc（罗马音）+ yrc（逐字时间轴），合成「主行 + 它的翻译 +
 *     罗马音」一组来渲染：当前组整体点亮并滚到中间，有逐字的歌按字跟着播放点亮，
 *     点任意一行跳时间。翻译行数对不上时按时间就近挂（±1 秒），[offset:] 也认。
 *     歌词接口**不需要登录**，而且没有歌词时它照样回 code 200（靠 lrc 为空 /
 *     uncollected / sgc 判断），所以这里不用 code 当判据。
 *     ★ [offset:+500] 按 LRC 通行约定处理成「整体提前 0.5 秒」。
 *
 *     点赞 / 收藏这两个写操作按「站点自己的口径」发请求，失败说人话：
 *       · 评论点赞：点赞 POST /api/v1/comment/like，取消 POST /api/v1/comment/unlike
 *         （请求体只有 threadId=R_SO_4_<歌曲>、commentId、csrf_token；type 是资源类型
 *         0=歌曲，不是点赞开关）。取消点赞原先发到了 /comment/like 上，是错的。
 *       · 收藏：直接打 /api/radio/like（alg=itembased + trackId + like + time=3 +
 *         csrf_token，like 只有字符串 'false' 才算取消）→ 不成再退回复用站点自己的
 *         window.subscribe（播放条那个 ♡ 就是它）→ 最后用「我喜欢的音乐」的真实状态
 *         校验，成功才说成功，失败把 code / message 一并说出来。之所以不能只调
 *         subscribe：它在内容 iframe 没起来时会静默什么都不做。
 *       · 两者都写诊断（window.__nm3LikeLog）。未登录回 301、风控回 -460/-462、
 *         接口变了回 404 —— 这些原因现在都会如实显示，不再是笼统一句「失败」。
 *
 *     下载：控制台上的下载按钮，按当前音质档位取流（同样带客户端姿态），
 *     fetch 成 blob 交给 <a download> 存盘，边下边在按钮上显示百分比；取不到
 *     地址就如实说明（VIP / 客户端授权的内容，账号没权限就是没有）。流式读取
 *     带停滞超时 + 总超时，失败时退回新标签页打开音频地址。
 *
 *     下载位置默认重定向到系统「音乐」文件夹：网页改不了浏览器的默认下载目录，
 *     所以走 File System Access API —— 第一次下载时选择框直接开在「音乐」文件夹，
 *     确认一次后目录句柄存进 IndexedDB，之后每次都直接写进那个文件夹且不再弹框
 *     （授权过期时借点击的手势续期）；Shift + 点击下载按钮可重选。浏览器没有这个
 *     API（Firefox / Safari）或用户取消时，原样退回浏览器默认下载目录。
 *     顺便附一份**同名双语 .lrc**（带时间轴，原文 + 翻译同时间戳两行，国内播放器
 *     按这个认双语）：本地播放器靠同名自动加载，所以文件名跟着实际音频名走，
 *     而且同名直接覆盖；CONFIG.DOWNLOAD_LRC = false 可以关掉。
 *
 *     客户端姿态（模拟 PC 客户端）：取流请求统一带 os=pc / appver / channel /
 *     osver，并在 cookie 里补一个 os=pc；网页播放器自己判定不播、而接口还能给流
 *     的时候，脚本按这套姿态自己取流喂给 <audio> 播出来（rescuePlayback）——
 *     这就是「客户端能放、网页不给放」那类内容的落地办法。注意这不是绕付费：
 *     账号没权限的内容接口照样回 url=null，脚本只会如实提示。
 *
 *     进度条仍是全站唯一一根，就在这一排的上方：点一下跳转、按住左右拖动、
 *     悬停显示目标时间；内凹暗槽 + 已缓存片段（读 <audio>.buffered）+ 深蓝到
 *     亮蓝的渐变播放段 + 悬停/拖动时放大的圆点 + 跟随鼠标的时间气泡，两侧是
 *     自绘的当前 / 总时长，定位直接改 <audio>.currentTime。
 * ───────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════════════════ 配置 ═══════════════════════════ */

  const CONFIG = {
    BAR_H: 58,                 // 自绘页头高度
    SEARCH_LIMIT: 40,          // 搜索一次取多少条
    COMMENT_LIMIT: 20,         // 评论每页多少条
    MAX_PLAYLIST_TRACKS: 1000, // 单个歌单最多读多少首
    SONG_DETAIL_BATCH: 500,    // /api/song/detail 单次批量上限
    DOWNLOAD_SUBDIR: '',       // 下载目录：选定「音乐」文件夹后再往里放的子文件夹名（空=直接放音乐文件夹）
    DOWNLOAD_LRC: true,        // 下载时顺便把双语 .lrc（带时间轴）写到同一个文件夹
    TICK: 300                  // 轮询间隔（毫秒）
  };

  const PALETTE = {
    bg: '#141521',      // rgb(20,21,33)
    bg2: '#1A1C2C',
    card: '#1E2133',
    deep: '#2D3C81',    // rgb(45,60,129)
    accent: '#4EA4EF',  // rgb(78,164,239)
    fg: '#DAE2ED',      // rgb(218,226,237)
    warm: '#937562'     // rgb(147,117,98)
  };

  const INK = '#0B0E19'; // 亮蓝底上的深色文字

  const PREFIX = '%c[云音乐·精简版]';
  const STYLE = 'color:' + PALETTE.accent + ';font-weight:bold';
  const log = (...a) => console.log(PREFIX, STYLE, ...a);
  const warn = (...a) => console.warn(PREFIX, STYLE, ...a);

  /* ═══════════════════════════ 通用小工具 ═══════════════════════════ */

  /**
   * 注入样式。
   *
   * ★ @run-at document-start 时文档可能还是空的：`document.head` 与
   *   `document.documentElement` **都**可能是 null，此时直接 appendChild 会
   *   抛 TypeError，整个脚本在 boot() 里就死了（页面看上去像没装脚本）。
   *   所以挂不上就返回 false，等 DOMContentLoaded 再补。
   */
  function injectStyle(css, id) {
    const put = () => {
      if (id && document.getElementById(id)) return true;
      const host = document.head || document.documentElement;
      if (!host) return false;                 // 文档还没建好，等下一轮
      const s = document.createElement('style');
      if (id) s.id = id;
      s.textContent = css;
      host.appendChild(s);
      return true;
    };
    if (!put()) document.addEventListener('DOMContentLoaded', put, { once: true });
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDuration(ms) {
    if (!ms || !isFinite(ms) || ms <= 0) return '--:--';
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function fmtCount(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(v);
  }

  /** 时间戳 -> 相对时间 */
  function fmtTime(ms) {
    if (!ms) return '';
    const t = Number(ms);
    const diff = Date.now() - t;
    if (!isFinite(diff) || diff < 0) return '';
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 30) return Math.floor(diff / 86400000) + ' 天前';
    const d = new Date(t);
    const p = (x) => (x < 10 ? '0' : '') + x;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** '01:23' -> 秒 */
  function parseClock(text) {
    if (!text) return null;
    const m = /(\d+)\s*:\s*(\d+)/.exec(text);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function artistsOf(song) {
    if (!song) return '';
    const list = song.artists || song.ar || [];
    if (!list.length) return song.artistName || '';
    return list.map((a) => a && a.name).filter(Boolean).join(' / ');
  }

  /**
   * 有效的资源 id。站点的队列对象里常出现 id 为 0 / '0' / null 的歌手、专辑
   * （实测某些歌就是 ar:[{id:0,name:'…'}]），这种不能当成「可点」——否则会去
   * 请求 /api/v1/artist/0。
   */
  function validId(v) {
    const s = v == null ? '' : String(v).trim();
    return (s && s !== '0' && s !== 'undefined' && s !== 'null') ? s : '';
  }

  /** 歌手（带 id 的那些）：站点各处的歌曲对象有的用 ar、有的用 artists */
  function artistNameList(song) {
    if (!song) return [];
    const list = song.artists || song.ar || [];
    return list
      .filter((a) => a && a.name)
      .map((a) => ({ id: validId(a.id), name: a.name }));
  }

  /** 歌名旁边 / 曲目行里的歌手：能拿到 id 的就做成可以点进歌手详情的链接 */
  function artistLinksHtml(song) {
    const list = artistNameList(song);
    if (!list.length) return esc(artistsOf(song));
    return list.map((a) => (a.id
      ? '<a class="nm3-artist" data-act="artist" data-id="' + esc(a.id) +
        '" title="查看歌手：' + esc(a.name) + '">' + esc(a.name) + '</a>'
      : esc(a.name))).join(' / ');
  }

  /**
   * 专辑信息。
   * ★ 一定要把 id 也带出来：听歌页那个「专辑」chip 就是靠它做成可点链接的，
   *   少了 id 就只能退化成纯文本（之前踩过这个坑：id 一直取不到，专辑点不进去）。
   */
  function albumOf(song) {
    if (!song) return { id: '', name: '', picUrl: '' };
    const al = song.album || song.al || {};
    return {
      id: validId(al.id),
      name: al.name || '',
      picUrl: al.picUrl || ''
    };
  }

  /**
   * 图片地址 + 网易图床缩放参数。
   * ★ 必须把 http 升成 https：站点是 https 页面，而 /api/v6/playlist/detail
   *   返回的 al.picUrl 是 http:// 开头的，浏览器会按混合内容拦掉（或等自动升级
   *   而实际不生效），实测表现就是封面一片空白。p1.music.126.net 的 https 是通的。
   */
  function pic(url, size) {
    if (!url) return '';
    const u = String(url).replace(/^http:\/\//i, 'https://');
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'param=' + size + 'y' + size;
  }

  /**
   * 同源 GET JSON（自动带上登录 Cookie）。
   *
   * ★ 关键：站点对「不存在的路由」也是 HTTP 200，body 里才是
   *   {"code":404,"message":"接口未找到！"}。只判断 res.ok 会把它当成成功，
   *   后面的形状检查一抛错，兜底分支就永远不会执行 —— 所以这里统一把
   *   「有 code 字段且不等于 200」视为失败。
   */
  async function apiGet(path, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(path + qs, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json, text/plain, */*' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    let d;
    try {
      d = await res.json();
    } catch (e) {
      throw new Error('返回的不是 JSON（' + path + '）');
    }

    if (d && typeof d === 'object' && d.code != null) {
      const code = Number(d.code);
      if (code && code !== 200) {
        const err = new Error(
          code === 404
            ? '接口不存在：' + path
            : code === 301
              ? '需要登录'
              : 'code=' + d.code + (d.message ? '（' + d.message + '）' : '')
        );
        err.code = code;
        throw err;
      }
    }
    return d;
  }

  /** 真正问一次账号状态（GUser 可能是过期的登录态） */
  async function checkLogin() {
    try {
      const d = await apiGet('/api/nuser/account/get');
      return !!(d && d.profile && d.profile.userId);
    } catch (e) {
      return false;
    }
  }

  function getPlayer() {
    try {
      return window.top.player || null;
    } catch (e) {
      return null;
    }
  }

  function getGUser() {
    try {
      return window.top.GUser || null;
    } catch (e) {
      return null;
    }
  }

  function isLoggedIn() {
    const g = getGUser();
    return !!(g && g.userId > 0);
  }

  /* ═══════════════════════════ 图标 ═══════════════════════════ */

  const SVG = {
    heart: (s, c) =>
      '<svg viewBox="0 0 1024 1024" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<path d="M512 896C288 736 128 597 128 405 128 277 226 179 354 179c63 0 123 27 158 71 35-44 95-71 158-71 128 0 226 98 226 226 0 192-160 331-384 491z"/></svg>',
    play: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg>',
    back: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + c +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    search: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + c +
      '" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
    like: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<path d="M12 20s-7-4.6-9.2-9A5.2 5.2 0 0 1 12 7.6 5.2 5.2 0 0 1 21.2 11C19 15.4 12 20 12 20z"/></svg>',
    wave: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<rect x="3" y="10" width="2.4" height="4" rx="1.2"/>' +
      '<rect x="7.4" y="6" width="2.4" height="12" rx="1.2"/>' +
      '<rect x="11.8" y="3" width="2.4" height="18" rx="1.2"/>' +
      '<rect x="16.2" y="7.5" width="2.4" height="9" rx="1.2"/>' +
      '<rect x="20.6" y="11" width="2.4" height="2" rx="1"/></svg>',
    check: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + c +
      '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',

    /* ── 播放控制台用到的（原来都是底部播放条上的） ─────────── */
    prev: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<path d="M7 6a1 1 0 0 1 2 0v4.3l7.6-4.9A1 1 0 0 1 18 6.2v11.6a1 1 0 0 1-1.4.8L9 13.7V18a1 1 0 0 1-2 0z"/></svg>',
    next: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<path d="M17 6a1 1 0 0 0-2 0v4.3L7.4 5.4A1 1 0 0 0 6 6.2v11.6a1 1 0 0 0 1.4.8L15 13.7V18a1 1 0 0 0 2 0z"/></svg>',
    pause: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<rect x="7" y="5" width="3.6" height="14" rx="1.4"/>' +
      '<rect x="13.4" y="5" width="3.6" height="14" rx="1.4"/></svg>',
    mode: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + c +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M17 4l3 3-3 3"/><path d="M4 7h3.2c1.2 0 2.3.6 3 1.6l4.6 6.8c.7 1 1.8 1.6 3 1.6H20"/>' +
      '<path d="M17 14l3 3-3 3"/><path d="M4 17h3.2c1.2 0 2.3-.6 3-1.6l.8-1.2"/></svg>',
    list: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="' + c + '">' +
      '<rect x="3.5" y="5" width="17" height="2.4" rx="1.2"/>' +
      '<rect x="3.5" y="10.8" width="17" height="2.4" rx="1.2"/>' +
      '<rect x="3.5" y="16.6" width="11" height="2.4" rx="1.2"/></svg>',
    share: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + c +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="18" cy="5.5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18.5" r="2.6"/>' +
      '<path d="M8.4 10.7l7.2-3.9M8.4 13.3l7.2 3.9"/></svg>',
    download: (s, c) =>
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + c +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4v10.5"/><path d="M7.8 10.6L12 14.8l4.2-4.2"/><path d="M5 18.5h14"/></svg>'
  };

  /* ═══════════════════════════ 样式（深蓝夜色） ═══════════════════════════ */

  const CSS = `
    /* ── 调色板（--nm3- 前缀，不会和站点冲突） ─────────────────── */
    :root {
      --nm3-bg:     ${PALETTE.bg};
      --nm3-bg2:    ${PALETTE.bg2};
      --nm3-card:   ${PALETTE.card};
      --nm3-deep:   ${PALETTE.deep};
      --nm3-accent: ${PALETTE.accent};
      --nm3-fg:     ${PALETTE.fg};
      --nm3-warm:   ${PALETTE.warm};
      --nm3-fg2:    rgba(218,226,237,.62);
      --nm3-fg3:    rgba(218,226,237,.36);
      --nm3-line:   rgba(218,226,237,.09);
      --nm3-hover:  rgba(78,164,239,.10);
      --nm3-sel:    rgba(78,164,239,.15);
      --nm3-glow:   0 0 12px rgba(78,164,239,.55);
    }

    /* ── 站点原生的顶栏和内容区整个让位 ───────────────────────── */
    html, body { background: var(--nm3-bg) !important; }
    #g-topbar, #g_iframe { display: none !important; }

    /* ── 底部播放条：功能全部搬到听歌页，这里只剩「看不见的原生控件壳」 ──
     * 只藏播放条自己的零件，容器（.m-playbar / .wrap）留着 —— 播放列表那个
     * 浮层（#g_playlist）就挂在这个容器里，藏容器会把它一起藏掉。
     *
     * 用 visibility 而不是 display：这些控件还要被转发点击、被 NEJ slider
     * 拖拽、被读 offsetWidth / getBoundingClientRect（转发的坐标就来自它们
     * 的真实矩形），display:none 会让这些全部失效。
     */
    .m-playbar { background: none !important; border: 0 !important; box-shadow: none !important; }
    .m-playbar .bg,
    .m-playbar .updn,
    .m-playbar .hand,
    .m-playbar .m-guidetip,
    .m-playbar .btns,
    .m-playbar .head,
    .m-playbar .play,
    .m-playbar .oper,
    .m-playbar .ctrl { visibility: hidden !important; pointer-events: none !important; }

    /* 壳本身不吃鼠标（面板现在一直铺到视口底部），队列抽屉除外 */
    .m-playbar { pointer-events: none !important; }
    .m-playbar #g_playlist,
    .m-playbar #g_playlist * { visibility: visible !important; pointer-events: auto !important; }
    /* 官方队列抽屉永远在最上层，压得住自绘面板 */
    .g-btmbar { z-index: 1002 !important; }

    /* ── 播放列表（队列）抽屉：官方面板在我们这儿展开，点行即唱 ──
     * 面板本身就是站点那块 #g_playlist：行内容、当前播放高亮、点一下换歌、
     * 单曲删除/下载/分享/收藏、收藏全部、清除、关闭，全是站点自己的逻辑 ——
     * 脚本只把它从「挂在播放条上、位置随站点布局飘」摆成一个固定抽屉，
     * 并把用不上的装饰（贴图、假滚动条、右侧歌词栏）去掉。
     *
     * ★ 宽度不能随便收：行是 .col-1…col-6 一串固定像素宽的浮动块
     *   （10+256+78+70+35+37 + 各列 padding ≈ 542px），而 .listbdc 本身
     *   就是 553px。抽屉比这窄，行里的歌手/时长就会被裁掉 —— 所以抽屉定
     *   570px，把列表列原样留着，多出来的 17px 正好给原生滚动条。
     */
    .m-playbar #g_playlist {
      position: fixed !important;
      left: auto !important; right: 22px !important;
      top: auto !important; bottom: 22px !important;
      width: 570px !important; height: 460px !important;
      max-height: calc(100vh - 200px) !important;
      z-index: 1005 !important;
      background: ${PALETTE.card} !important; border: 1px solid rgba(78,164,239,.28);
      border-radius: 14px; overflow: hidden;
      box-shadow: 0 26px 64px rgba(0,0,0,.62);
    }
    /* 头部：站点是按 976px 宽绝对定位摆的，这里改成 flex，免得挤成一团 */
    .m-playbar #g_playlist .listhd {
      height: 46px !important; padding: 0 14px !important;
      background: none !important; background-image: none !important;
    }
    .m-playbar #g_playlist .listhdc {
      position: static !important; height: 45px !important;
      display: flex; align-items: center; gap: 14px;
    }
    .m-playbar #g_playlist .listhdc h4 {
      position: static !important; margin: 0 !important;
      height: auto !important; line-height: 1 !important;
      font-size: 13.5px !important; color: var(--nm3-fg) !important;
    }
    .m-playbar #g_playlist .listhdc .lytit,
    .m-playbar #g_playlist .listhdc .line,
    .m-playbar #g_playlist .listhdc .ico { display: none !important; }
    .m-playbar #g_playlist .listhdc .addall,
    .m-playbar #g_playlist .listhdc .clear {
      position: static !important; left: auto !important; top: auto !important;
      height: auto !important; line-height: 1 !important; margin: 0 !important;
      font-size: 12.5px !important; color: var(--nm3-fg2) !important;
      text-decoration: none !important;
    }
    .m-playbar #g_playlist .listhdc .addall:hover,
    .m-playbar #g_playlist .listhdc .clear:hover { color: var(--nm3-accent) !important; }
    .m-playbar #g_playlist .listhdc .close {
      position: static !important; margin-left: auto !important;
      width: auto !important; height: auto !important; padding: 0 !important;
      background: none !important; text-indent: 0 !important;
      font-size: 12.5px !important; color: var(--nm3-fg2) !important; cursor: pointer;
    }
    .m-playbar #g_playlist .listhdc .close:hover { color: var(--nm3-accent) !important; }
    /* 列表区：占满抽屉剩余高度，列表列保持站点自己的 553px */
    .m-playbar #g_playlist .listbd {
      position: absolute !important; left: 0 !important; top: 46px !important;
      width: 100% !important; height: calc(100% - 46px) !important;
      padding: 0 !important; overflow: hidden !important;
      background: none !important; background-image: none !important;
    }
    .m-playbar #g_playlist .listbdc {
      position: absolute !important; left: 0 !important; top: 0 !important;
      width: 553px !important; height: 100% !important;
      overflow-y: auto !important; overflow-x: hidden !important;
    }
    .m-playbar #g_playlist .listbdc::-webkit-scrollbar { width: 8px; }
    .m-playbar #g_playlist .listbdc::-webkit-scrollbar-thumb {
      background: rgba(218,226,237,.16); border-radius: 4px;
    }
    .m-playbar #g_playlist .listbdc::-webkit-scrollbar-thumb:hover { background: rgba(78,164,239,.5); }
    .m-playbar #g_playlist .listlyric,
    .m-playbar #g_playlist .imgbg,
    .m-playbar #g_playlist .msk,
    .m-playbar #g_playlist .msk2,
    .m-playbar #g_playlist .bline,
    .m-playbar #g_playlist .ask,
    .m-playbar #g_playlist .upload,
    .m-playbar #g_playlist .scrol { display: none !important; }
    /* 行：列宽/行高都按站点自己的来，只把颜色拉进主题。
       注意 #g_playlist 本身就是那块 .list，所以选择器别再往后接 .list */
    .m-playbar #g_playlist ul { color: var(--nm3-fg2) !important; }
    .m-playbar #g_playlist li:hover { background-color: rgba(78,164,239,.10) !important; }
    .m-playbar #g_playlist li.z-sel { background-color: rgba(78,164,239,.16) !important; }
    .m-playbar #g_playlist .col-5 { color: var(--nm3-fg3) !important; }
    .m-playbar #g_playlist .nocnt { color: var(--nm3-fg3); }
    .m-playbar #g_playlist .nocnt a { color: var(--nm3-accent) !important; }
    @media (max-width: 1100px) {
      .m-playbar #g_playlist { left: 16px !important; right: 16px !important; width: auto !important; }
    }

    /* “去客户端播放”气泡很碍事 */
    #m-guidetip { display: none !important; }

    /* ══════════════ 页头 ══════════════ */
    #nm3-bar {
      position: fixed; left: 0; right: 0; top: 0; z-index: 901;
      height: ${CONFIG.BAR_H}px;
      display: flex; align-items: center; gap: 22px;
      box-sizing: border-box; padding: 0 26px;
      background: linear-gradient(180deg, #16182A 0%, ${PALETTE.bg} 100%);
      border-bottom: 1px solid rgba(78,164,239,.16);
      box-shadow: 0 1px 20px rgba(0,0,0,.35);
      color: var(--nm3-fg);
      font: 14px/1 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    #nm3-bar .nm3-brand {
      display: flex; align-items: center; gap: 9px; flex: 0 0 auto;
      font-size: 15px; font-weight: 700; letter-spacing: .4px;
      white-space: nowrap; user-select: none;
    }
    #nm3-bar .nm3-brand i {
      width: 18px; height: 18px; border-radius: 50%; display: block;
      background: radial-gradient(circle at 32% 30%, ${PALETTE.accent}, ${PALETTE.deep} 74%);
      box-shadow: 0 0 14px rgba(78,164,239,.5);
    }
    #nm3-bar .nm3-tabs { display: flex; align-items: center; height: 100%; flex: 0 0 auto; }
    #nm3-bar .nm3-tab {
      position: relative; display: flex; align-items: center; height: 100%;
      padding: 0 15px; color: var(--nm3-fg2); font-size: 14.5px;
      cursor: pointer; text-decoration: none; user-select: none; white-space: nowrap;
      transition: color .18s;
    }
    #nm3-bar .nm3-tab:hover { color: var(--nm3-fg); }
    #nm3-bar .nm3-tab.nm3-on { color: var(--nm3-accent); font-weight: 600; }
    #nm3-bar .nm3-tab::after {
      content: ''; position: absolute; left: 15px; right: 15px; bottom: -1px; height: 2px;
      border-radius: 2px; background: var(--nm3-accent); box-shadow: var(--nm3-glow);
      transform: scaleX(0); transition: transform .24s cubic-bezier(.4,0,.2,1);
    }
    #nm3-bar .nm3-tab.nm3-on::after { transform: scaleX(1); }

    /* 页头搜索框 */
    #nm3-bar .nm3-search {
      margin-left: auto; display: flex; align-items: center; gap: 8px;
      width: 300px; height: 36px; flex: 0 0 auto;
      box-sizing: border-box; padding: 0 6px 0 13px;
      border-radius: 18px;
      background: rgba(218,226,237,.06);
      border: 1px solid rgba(218,226,237,.10);
      transition: border-color .18s, background .18s, box-shadow .18s;
    }
    #nm3-bar .nm3-search:focus-within {
      border-color: rgba(78,164,239,.6);
      background: rgba(78,164,239,.09);
      box-shadow: 0 0 0 3px rgba(78,164,239,.13);
    }
    #nm3-bar .nm3-search svg { flex: 0 0 auto; color: var(--nm3-fg3); }
    #nm3-bar .nm3-search input {
      flex: 1 1 auto; min-width: 0; height: 100%;
      background: transparent; border: 0; outline: 0;
      color: var(--nm3-fg); font-size: 13.5px; font-family: inherit;
    }
    #nm3-bar .nm3-search input::placeholder { color: var(--nm3-fg3); }
    #nm3-bar .nm3-search button {
      flex: 0 0 auto; height: 26px; padding: 0 14px;
      border-radius: 13px; border: 0; cursor: pointer;
      background: var(--nm3-deep); color: var(--nm3-fg);
      font-size: 12.5px; font-family: inherit; transition: all .18s;
    }
    #nm3-bar .nm3-search button:hover { background: var(--nm3-accent); color: ${INK}; }

    /* 账号 */
    #nm3-bar .nm3-user { position: relative; flex: 0 0 auto; }
    #nm3-bar .nm3-user-chip {
      display: flex; align-items: center; gap: 9px; height: 36px;
      padding: 0 13px 0 4px; border-radius: 18px; cursor: pointer;
      background: rgba(218,226,237,.06);
      border: 1px solid rgba(218,226,237,.10);
      transition: background .18s, border-color .18s;
    }
    #nm3-bar .nm3-user-chip:hover { background: rgba(78,164,239,.13); border-color: rgba(78,164,239,.4); }
    #nm3-bar .nm3-user-chip img {
      width: 28px; height: 28px; border-radius: 50%; object-fit: cover;
      background: var(--nm3-deep); flex: 0 0 auto; display: block;
    }
    #nm3-bar .nm3-user-chip span {
      max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 13px; color: var(--nm3-fg2);
    }
    #nm3-bar .nm3-user-go {
      display: flex; align-items: center; height: 34px; padding: 0 18px;
      border-radius: 17px; cursor: pointer; border: 0;
      background: linear-gradient(135deg, ${PALETTE.accent}, ${PALETTE.deep});
      color: ${INK}; font-size: 13px; font-weight: 600; font-family: inherit;
      transition: filter .18s;
    }
    #nm3-bar .nm3-user-go:hover { filter: brightness(1.12); }
    #nm3-bar .nm3-user-menu {
      position: absolute; right: 0; top: calc(100% + 10px); min-width: 140px;
      padding: 6px; display: none; border-radius: 11px;
      background: ${PALETTE.card}; border: 1px solid var(--nm3-line);
      box-shadow: 0 16px 40px rgba(0,0,0,.55);
    }
    #nm3-bar .nm3-user.nm3-open .nm3-user-menu { display: block; }
    #nm3-bar .nm3-user-menu a {
      display: block; padding: 9px 12px; border-radius: 7px;
      color: var(--nm3-fg2); font-size: 13px; cursor: pointer;
    }
    #nm3-bar .nm3-user-menu a:hover { background: var(--nm3-hover); color: var(--nm3-accent); }

    @media (max-width: 1120px) {
      #nm3-bar .nm3-search { width: 210px; }
      #nm3-bar .nm3-brand span { display: none; }
    }
    @media (max-width: 820px) {
      #nm3-bar { gap: 12px; padding: 0 14px; }
      #nm3-bar .nm3-tab { padding: 0 9px; font-size: 13.5px; }
      #nm3-bar .nm3-tab::after { left: 9px; right: 9px; }
      #nm3-bar .nm3-search { width: 150px; }
      #nm3-bar .nm3-search button { display: none; }
    }

    /* ══════════════ 主面板 ══════════════ */
    #nm3-panel {
      position: fixed; left: 0; right: 0; top: ${CONFIG.BAR_H}px; bottom: 0; z-index: 900;
      display: flex; flex-direction: column;
      box-sizing: border-box; overflow: hidden;
      background: var(--nm3-bg);
      color: var(--nm3-fg);
      font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .nm3-view { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .nm3-view.nm3-hide { display: none !important; }
    .nm3-scroll { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
    .nm3-scroll::-webkit-scrollbar { width: 9px; }
    .nm3-scroll::-webkit-scrollbar-thumb { background: rgba(218,226,237,.14); border-radius: 5px; }
    .nm3-scroll::-webkit-scrollbar-thumb:hover { background: rgba(78,164,239,.45); }

    /* ── 通用控件 ──────────────────────────────────────────────── */
    .nm3-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      height: 34px; padding: 0 20px; border-radius: 17px;
      border: 1px solid rgba(218,226,237,.16); background: rgba(218,226,237,.05);
      color: var(--nm3-fg); font-size: 13px; font-family: inherit;
      cursor: pointer; white-space: nowrap; transition: all .18s;
    }
    .nm3-btn:hover { border-color: rgba(78,164,239,.6); color: var(--nm3-accent); background: var(--nm3-hover); }
    .nm3-btn.nm3-primary {
      background: linear-gradient(135deg, ${PALETTE.accent}, ${PALETTE.deep});
      border-color: transparent; color: ${INK}; font-weight: 600;
      box-shadow: 0 6px 20px rgba(78,164,239,.28);
    }
    .nm3-btn.nm3-primary:hover { filter: brightness(1.1); color: ${INK}; }
    .nm3-btn[disabled] { opacity: .45; cursor: not-allowed; }
    .nm3-btn svg { flex: 0 0 auto; }

    .nm3-back {
      display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
      height: 30px; padding: 0 15px 0 11px; border-radius: 15px;
      border: 1px solid rgba(218,226,237,.14); background: rgba(218,226,237,.05);
      color: var(--nm3-fg2); font-size: 12.5px; font-family: inherit;
      cursor: pointer; transition: all .18s;
    }
    .nm3-back:hover { border-color: rgba(78,164,239,.6); color: var(--nm3-accent); }

    /* 分段控件（歌词/评论、搜索类型） */
    .nm3-seg { display: inline-flex; gap: 4px; padding: 3px; border-radius: 11px; background: rgba(218,226,237,.06); }
    .nm3-seg a {
      display: inline-flex; align-items: center; gap: 7px;
      height: 28px; padding: 0 16px; border-radius: 8px;
      font-size: 13px; color: var(--nm3-fg2); cursor: pointer;
      user-select: none; transition: all .18s; white-space: nowrap;
    }
    .nm3-seg a:hover { color: var(--nm3-fg); }
    .nm3-seg a.nm3-on { background: var(--nm3-deep); color: var(--nm3-fg); font-weight: 500; }
    .nm3-seg a em { font-style: normal; font-size: 11.5px; color: var(--nm3-fg3); }
    .nm3-seg a.nm3-on em { color: rgba(218,226,237,.7); }

    /* ── 状态块 ────────────────────────────────────────────────── */
    .nm3-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; padding: 92px 40px; text-align: center;
    }
    #nm3-view-listen .nm3-state { padding: 54px 16px; }
    .nm3-state-title { font-size: 16px; color: var(--nm3-fg); font-weight: 500; letter-spacing: .2px; }
    .nm3-state-sub { font-size: 13px; color: var(--nm3-fg3); max-width: 430px; line-height: 1.9; }
    .nm3-spin {
      width: 28px; height: 28px; border-radius: 50%;
      border: 2px solid rgba(218,226,237,.12); border-top-color: var(--nm3-accent);
      animation: nm3-rot .8s linear infinite;
    }
    @keyframes nm3-rot { to { transform: rotate(360deg); } }

    /* ── 曲目列表 ──────────────────────────────────────────────── */
    .nm3-tracks { padding: 4px 22px 44px; }
    .nm3-track {
      display: grid; align-items: center; gap: 14px;
      grid-template-columns: 42px 32px minmax(0, 2.5fr) minmax(0, 1.4fr) minmax(0, 1.7fr) 56px;
      height: 56px; padding: 0 12px; box-sizing: border-box;
      border-radius: 10px; cursor: pointer; transition: background .15s;
    }
    .nm3-tracks.nm3-tagged .nm3-track {
      grid-template-columns: 42px 32px minmax(0, 2.3fr) 58px minmax(0, 1.3fr) minmax(0, 1.6fr) 56px;
    }
    .nm3-track:hover { background: var(--nm3-hover); }
    .nm3-track.nm3-current { background: var(--nm3-sel); }
    .nm3-track.nm3-current .nm3-t-name { color: var(--nm3-accent); font-weight: 600; }
    /* 每行的小封面（正在播放的盖一层 ♪ 角标） */
    .nm3-t-cover {
      position: relative; width: 42px; height: 42px; flex: 0 0 auto;
      border-radius: 8px; overflow: hidden; background: var(--nm3-card);
      box-shadow: 0 2px 8px rgba(0,0,0,.35);
    }
    .nm3-t-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .nm3-t-badge {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(11,14,25,.68); color: var(--nm3-accent); font-size: 15px;
      opacity: 0; transition: opacity .18s;
    }
    .nm3-track.nm3-current .nm3-t-badge { opacity: 1; }
    .nm3-t-idx { color: var(--nm3-fg3); font-size: 13px; text-align: center; font-variant-numeric: tabular-nums; }
    .nm3-track.nm3-current .nm3-t-idx { color: var(--nm3-accent); }
    .nm3-t-name { color: var(--nm3-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nm3-t-art, .nm3-t-alb {
      color: var(--nm3-fg2); font-size: 13px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .nm3-t-dur { color: var(--nm3-fg3); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    .nm3-tag { display: inline-block; font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 9px; white-space: nowrap; }
    .nm3-tag.nm3-new { color: var(--nm3-accent); background: rgba(78,164,239,.16); }
    .nm3-tag.nm3-old { color: var(--nm3-warm); background: rgba(147,117,98,.22); }

    /* ══════════════ 听歌页 ══════════════ */
    #nm3-view-listen .nm3-np-bg {
      position: absolute; inset: -80px; z-index: 0;
      background-position: center; background-size: cover;
      filter: blur(86px) saturate(1.4); opacity: .30;
      transform: scale(1.08); pointer-events: none;
    }
    #nm3-view-listen .nm3-np {
      position: relative; z-index: 1;
      display: flex; gap: 52px; align-items: flex-start;
      width: 100%; max-width: 1160px; margin: 0 auto;
      padding: 44px 52px 30px; box-sizing: border-box;
    }
    #nm3-view-listen .nm3-np-left { flex: 0 0 296px; }
    #nm3-view-listen .nm3-cover {
      width: 296px; height: 296px; border-radius: 16px; overflow: hidden;
      background: var(--nm3-card);
      box-shadow: 0 22px 56px rgba(0,0,0,.55), 0 0 0 1px rgba(218,226,237,.07);
    }
    #nm3-view-listen .nm3-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #nm3-view-listen .nm3-title {
      margin-top: 24px; font-size: 24px; font-weight: 700;
      line-height: 1.35; letter-spacing: .3px; color: var(--nm3-fg); word-break: break-word;
    }
    #nm3-view-listen .nm3-sub { margin-top: 9px; color: var(--nm3-fg2); font-size: 14px; }
    #nm3-view-listen .nm3-meta { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    #nm3-view-listen .nm3-chip {
      font-size: 12px; color: var(--nm3-fg2);
      background: rgba(218,226,237,.07); border-radius: 11px; padding: 3px 12px;
    }
    /* 可点的专辑名 chip：和歌手链接一样是「进详情」的入口 */
    #nm3-view-listen a.nm3-chip-link {
      text-decoration: none; cursor: pointer; transition: color .18s, background .18s;
    }
    #nm3-view-listen a.nm3-chip-link:hover {
      color: var(--nm3-accent); background: var(--nm3-hover);
    }
    #nm3-view-listen .nm3-flag { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--nm3-accent); }
    #nm3-view-listen .nm3-flag i {
      width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: block;
      box-shadow: var(--nm3-glow); animation: nm3-pulse 1.6s ease-in-out infinite;
    }
    @keyframes nm3-pulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }

    #nm3-view-listen .nm3-np-right { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    /* 面板不再给播放条让位（+53px），又多了控制台这一排（-60px），净减 7px */
    #nm3-view-listen .nm3-pane-wrap {
      flex: 1 1 auto; display: flex; flex-direction: column;
      margin-top: 16px; height: calc(100vh - 337px); min-height: 200px;
    }
    #nm3-view-listen .nm3-pane { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
    #nm3-view-listen .nm3-pane.nm3-hide { display: none !important; }
    #nm3-view-listen .nm3-pane::-webkit-scrollbar { width: 7px; }
    #nm3-view-listen .nm3-pane::-webkit-scrollbar-thumb { background: rgba(218,226,237,.14); border-radius: 4px; }
    #nm3-view-listen .nm3-pane::-webkit-scrollbar-thumb:hover { background: rgba(78,164,239,.45); }

    /* ── 进度条：全站唯一一根，摆在歌词上方（听歌页） ───────────
     * 底部播放条那根原装的已经整根藏掉（见本节末尾），所以这里既是显示、
     * 也是唯一的定位控件：点一下跳转、按住拖动、悬停出目标时间。
     *
     * 结构：
     *   .nm3-seek-track
     *     └ .nm3-seek-rail  内凹暗槽（overflow:hidden）
     *         ├ .nm3-seek-buf   已缓存片段
     *         └ .nm3-seek-fill  播放进度（末端 ::after 是流动高光）
     *     ├ .nm3-seek-knob  圆点（悬停 / 拖动时长出来）
     *     └ .nm3-seek-tip   跟随鼠标的目标时间气泡
     */
    .nm3-seek { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; user-select: none; }
    .nm3-seek-time {
      flex: 0 0 auto; min-width: 48px; letter-spacing: .3px;
      font-size: 13px; color: var(--nm3-fg3); font-variant-numeric: tabular-nums;
      transition: color .18s;
    }
    .nm3-seek-time.nm3-seek-dur { text-align: right; }
    .nm3-seek:hover .nm3-seek-time,
    .nm3-dragging .nm3-seek-time { color: var(--nm3-fg); }

    .nm3-seek-track {
      position: relative; flex: 1 1 auto; height: 24px;
      display: flex; align-items: center; cursor: pointer;
    }
    /* 暗槽 */
    .nm3-seek-rail {
      position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%);
      height: 8px; border-radius: 999px; overflow: hidden;
      background: linear-gradient(180deg, rgba(11,14,25,.92), rgba(218,226,237,.10));
      box-shadow: inset 0 1px 2px rgba(0,0,0,.6), 0 0 0 1px rgba(218,226,237,.07);
      transition: height .18s cubic-bezier(.4,0,.2,1);
    }
    .nm3-seek-track:hover .nm3-seek-rail,
    .nm3-dragging .nm3-seek-rail { height: 11px; }
    /* 已缓存（站点原装那根是不画这个的） */
    .nm3-seek-buf {
      position: absolute; left: 0; top: 0; bottom: 0; width: 0;
      background: repeating-linear-gradient(115deg,
        rgba(218,226,237,.22) 0 5px, rgba(218,226,237,.09) 5px 10px);
      transition: width .3s linear;
    }
    /* 播放进度：深蓝 → 亮蓝渐变 + 末端流动高光 */
    .nm3-seek-fill {
      position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 999px;
      background: linear-gradient(90deg, var(--nm3-deep) 0%, var(--nm3-accent) 72%, #9BD6FF 100%);
      box-shadow: 0 0 14px rgba(78,164,239,.5);
      transition: width .12s linear;
    }
    .nm3-seek-fill::after {
      content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 24px;
      background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.5));
    }
    /* 没歌 / 时长还没读到：整根压暗，别装作有进度 */
    .nm3-idle .nm3-seek-fill { box-shadow: none; opacity: .45; }
    .nm3-idle .nm3-seek-fill::after { display: none; }
    .nm3-idle .nm3-seek-knob { display: none; }
    /* 圆点 */
    .nm3-seek-knob {
      position: absolute; top: 50%; left: 0; width: 0; height: 0; border-radius: 50%;
      background: #fff; pointer-events: none; opacity: 0;
      box-shadow: 0 0 0 3px rgba(78,164,239,.32), 0 0 16px rgba(78,164,239,.85);
      transform: translate(-50%, -50%);
      transition: width .16s, height .16s, opacity .16s;
    }
    .nm3-seek-track:hover .nm3-seek-knob,
    .nm3-dragging .nm3-seek-knob { width: 16px; height: 16px; opacity: 1; }
    .nm3-dragging .nm3-seek-rail {
      box-shadow: inset 0 1px 2px rgba(0,0,0,.6), 0 0 0 1px rgba(78,164,239,.45);
    }
    /* 悬停 / 拖动时浮出的目标时间 */
    .nm3-seek-tip {
      position: absolute; bottom: calc(100% + 4px); transform: translateX(-50%);
      padding: 3px 9px; border-radius: 8px; font-size: 11px; white-space: nowrap;
      background: rgba(30,33,51,.97); color: var(--nm3-fg);
      border: 1px solid rgba(78,164,239,.38);
      box-shadow: 0 8px 22px rgba(0,0,0,.5);
      opacity: 0; transition: opacity .16s; pointer-events: none;
      font-variant-numeric: tabular-nums;
    }
    .nm3-seek-tip.nm3-on { opacity: 1; }

    /* ── 播放控制台：底部播放条的功能都搬到这里（歌词上方） ─────
     * 一排按钮 + 一根音量条；所有动作都转发给站点隐藏掉的原生控件。
     */
    .nm3-ctl { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
    .nm3-ctl-grp { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
    .nm3-ctl-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: 0 1 auto; }
    .nm3-cbtn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      height: 34px; min-width: 34px; padding: 0 11px; box-sizing: border-box;
      border-radius: 17px; border: 1px solid rgba(218,226,237,.14);
      background: rgba(218,226,237,.05); color: var(--nm3-fg2);
      font-size: 12.5px; font-family: inherit; line-height: 1;
      cursor: pointer; white-space: nowrap; transition: all .18s;
    }
    .nm3-cbtn:hover { border-color: rgba(78,164,239,.6); color: var(--nm3-accent); background: var(--nm3-hover); }
    .nm3-cbtn.nm3-on { color: var(--nm3-accent); border-color: rgba(78,164,239,.5); background: var(--nm3-sel); }
    .nm3-cbtn.nm3-busy { cursor: progress; opacity: .7; }
    .nm3-cbtn.nm3-busy span { font-size: 11.5px; color: var(--nm3-accent); }
    .nm3-cbtn svg { flex: 0 0 auto; }
    /* 主按钮：播放 / 暂停 */
    .nm3-cbtn-play {
      width: 46px; height: 46px; min-width: 46px; padding: 0; border-radius: 50%;
      border-color: transparent; color: ${INK};
      background: linear-gradient(135deg, ${PALETTE.accent}, ${PALETTE.deep});
      box-shadow: 0 6px 20px rgba(78,164,239,.30);
    }
    .nm3-cbtn-play:hover { filter: brightness(1.1); color: ${INK}; }
    /* 音量 */
    .nm3-vol {
      position: relative; width: 96px; height: 34px; flex: 0 0 auto;
      display: flex; align-items: center; cursor: pointer;
    }
    .nm3-vol-rail {
      position: absolute; left: 2px; right: 2px; top: 50%; transform: translateY(-50%);
      height: 4px; border-radius: 999px; overflow: hidden;
      background: rgba(218,226,237,.16);
    }
    .nm3-vol-fill {
      position: absolute; left: 0; top: 0; bottom: 0; width: 100%; border-radius: 999px;
      background: linear-gradient(90deg, var(--nm3-deep), var(--nm3-accent));
    }
    .nm3-vol-knob {
      position: absolute; top: 50%; left: 100%; width: 10px; height: 10px; border-radius: 50%;
      background: #fff; pointer-events: none;
      box-shadow: 0 0 0 2px rgba(20,21,33,.75), 0 0 10px rgba(78,164,239,.7);
      transform: translate(-50%, -50%); transition: width .14s, height .14s;
    }
    .nm3-vol:hover .nm3-vol-knob,
    .nm3-vol.nm3-dragging .nm3-vol-knob { width: 14px; height: 14px; }
    .nm3-vol.nm3-dragging .nm3-vol-rail { background: rgba(218,226,237,.26); }
    /* 队列条数 */
    .nm3-cbtn em { font-style: normal; font-size: 11.5px; color: var(--nm3-fg3); }
    .nm3-cbtn.nm3-on em { color: rgba(218,226,237,.7); }

    @media (max-width: 1000px) {
      .nm3-ctl { gap: 10px; }
      .nm3-vol { display: none; }
      .nm3-cbtn span { display: none; }
      .nm3-cbtn { padding: 0 9px; }
    }

    /* ── 底部播放条：原装进度条整根藏掉，不保留、也不替代 ───────
     * 站点那根是雪碧图（.barbg 里的 .rdy/.cur/.btn），颜色写死；既然进度条
     * 只保留歌词上方那一根，这里就什么都不画，把底部这一条让出去。
     *
     * 用 visibility 而不是 display：尺寸、事件、文本都还在 —— 站点自己的
     * NEJ slider 不会因为量到 0 宽而出错，脚本读 .time 文本取时长的兜底
     * 也照旧可用；藏的是视觉而不是占位，播放条上其他控件也不会因此挪位。
     */
    .m-playbar .m-pbar .barbg,
    .m-playbar .m-pbar .time { visibility: hidden !important; }

    /* ── 歌词/评论 页签 + 音质选择 同一行 ───────────────────── */
    .nm3-bar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .nm3-bar-row .nm3-seg { flex: 0 0 auto; }
    .nm3-q-wrap { position: relative; margin-left: auto; flex: 0 0 auto; }
    .nm3-q-btn {
      display: inline-flex; align-items: center; gap: 7px;
      height: 34px; padding: 0 14px; border-radius: 17px;
      border: 1px solid rgba(218,226,237,.16); background: rgba(218,226,237,.05);
      color: var(--nm3-fg2); font-size: 12.5px; font-family: inherit;
      cursor: pointer; white-space: nowrap; transition: all .18s;
    }
    .nm3-q-btn:hover,
    .nm3-q-wrap.nm3-open .nm3-q-btn { border-color: rgba(78,164,239,.6); color: var(--nm3-accent); }
    .nm3-q-menu {
      position: absolute; right: 0; top: calc(100% + 8px); z-index: 6;
      min-width: 212px; padding: 6px; display: none;
      border-radius: 12px; background: var(--nm3-card);
      border: 1px solid rgba(78,164,239,.22);
      box-shadow: 0 18px 44px rgba(0,0,0,.6);
    }
    .nm3-q-wrap.nm3-open .nm3-q-menu { display: block; }
    .nm3-q-menu a {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px; border-radius: 8px; cursor: pointer;
      color: var(--nm3-fg2); font-size: 13px; transition: background .15s;
    }
    .nm3-q-menu a:hover { background: var(--nm3-hover); }
    .nm3-q-menu a.nm3-on { background: var(--nm3-sel); color: var(--nm3-accent); }
    .nm3-q-name { flex: 0 0 auto; white-space: nowrap; }
    .nm3-q-vip {
      font-style: normal; font-size: 10px; line-height: 14px;
      margin-left: 5px; padding: 0 4px; border-radius: 4px;
      color: var(--nm3-warm); background: rgba(147,117,98,.22);
    }
    .nm3-q-note { flex: 1 1 auto; text-align: right; font-size: 11px; color: var(--nm3-fg3); }
    .nm3-q-tick { flex: 0 0 auto; display: flex; color: var(--nm3-accent); }

    /* ── 歌词：悬停放大 + 点击跳转 + 时间轴同步（含翻译 / 罗马音 / 逐字） ── */
    #nm3-view-listen .nm3-lyric { padding: 4px 10px 40px 2px; scroll-behavior: smooth; }
    #nm3-view-listen .nm3-lyric-grp { padding: 3px 0; }
    #nm3-view-listen .nm3-lyric-line {
      position: relative; padding: 9px 54px 9px 0;
      color: var(--nm3-fg3); font-size: 15px; line-height: 1.7;
      cursor: pointer; word-break: break-word;
      transform-origin: left center;
      transition: color .22s, transform .18s;
    }
    #nm3-view-listen .nm3-lyric-line:hover {
      color: var(--nm3-fg); transform: scale(1.045);
    }
    /* 悬停时右侧浮出这一行的时间 */
    #nm3-view-listen .nm3-lyric-line::after {
      content: attr(data-t);
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
      font-size: 11px; font-weight: 400; letter-spacing: .5px;
      color: var(--nm3-accent); opacity: 0; transition: opacity .2s;
      font-variant-numeric: tabular-nums; pointer-events: none;
    }
    #nm3-view-listen .nm3-lyric-line:hover::after { opacity: .9; }
    /* 当前这一组（主歌词 + 它的翻译 / 罗马音）一起点亮 —— 翻译也跟着同步 */
    #nm3-view-listen .nm3-lyric-grp.nm3-cur > .nm3-lyric-line {
      color: var(--nm3-accent); font-weight: 600; font-size: 17px;
      text-shadow: 0 0 22px rgba(78,164,239,.45);
    }
    #nm3-view-listen .nm3-lyric-grp.nm3-cur > .nm3-lyric-line.nm3-trans {
      color: rgba(218,226,237,.86); font-weight: 400; font-size: 13.5px; text-shadow: none;
    }
    #nm3-view-listen .nm3-lyric-grp.nm3-cur > .nm3-lyric-line.nm3-roma {
      color: rgba(218,226,237,.62); font-weight: 400; font-size: 12.5px; text-shadow: none;
    }
    #nm3-view-listen .nm3-lyric-grp.nm3-cur > .nm3-lyric-line:hover { transform: scale(1.06); }
    #nm3-view-listen .nm3-lyric-line.nm3-trans {
      color: rgba(218,226,237,.42); font-size: 13px; padding-top: 0; padding-bottom: 4px;
    }
    #nm3-view-listen .nm3-lyric-line.nm3-roma {
      color: rgba(218,226,237,.28); font-size: 12px; font-style: italic;
      padding-top: 0; padding-bottom: 5px;
    }
    #nm3-view-listen .nm3-lyric-line.nm3-trans:hover { color: var(--nm3-fg2); }
    #nm3-view-listen .nm3-lyric-line.nm3-roma:hover { color: var(--nm3-fg2); }
    /* 逐字点亮（yrc 逐字歌词可用时） */
    #nm3-view-listen .nm3-ch { transition: color .12s; }
    #nm3-view-listen .nm3-lyric-grp.nm3-cur > .nm3-lyric-line .nm3-ch-on {
      color: var(--nm3-accent);
    }
    #nm3-view-listen .nm3-lyric-empty { color: var(--nm3-fg3); padding: 40px 0; font-size: 13px; }

    /* ── 评论 ──────────────────────────────────────────────────── */
    .nm3-cm { padding: 4px 18px 40px 2px; }
    .nm3-cm-grp {
      display: flex; align-items: center; gap: 10px;
      font-size: 12px; letter-spacing: 1.5px; color: var(--nm3-warm);
      margin: 4px 0 10px;
    }
    .nm3-cm-grp::after { content: ''; flex: 1 1 auto; height: 1px; background: rgba(147,117,98,.28); }
    .nm3-cm-item { display: flex; gap: 13px; padding: 15px 0; border-bottom: 1px solid var(--nm3-line); }
    .nm3-cm-avatar {
      width: 34px; height: 34px; border-radius: 50%; flex: 0 0 auto;
      object-fit: cover; background: var(--nm3-deep); display: block;
    }
    .nm3-cm-body { flex: 1 1 auto; min-width: 0; }
    .nm3-cm-meta { display: flex; align-items: baseline; gap: 10px; }
    .nm3-cm-meta b { font-size: 13px; font-weight: 500; color: var(--nm3-accent); }
    .nm3-cm-meta span { font-size: 11.5px; color: var(--nm3-fg3); }
    .nm3-cm-text {
      margin-top: 6px; font-size: 13.5px; line-height: 1.8; color: var(--nm3-fg);
      word-break: break-word; white-space: pre-wrap;
    }
    .nm3-cm-reply {
      margin-top: 9px; padding: 9px 13px; border-radius: 9px;
      background: rgba(218,226,237,.05); border-left: 2px solid rgba(147,117,98,.5);
      font-size: 12.5px; line-height: 1.7; color: var(--nm3-fg2); word-break: break-word;
    }
    .nm3-cm-reply b { color: var(--nm3-warm); font-weight: 500; }
    .nm3-cm-foot {
      margin-top: 9px; display: flex; align-items: center; gap: 6px;
      font-size: 11.5px; color: var(--nm3-fg3);
    }
    /* 评论点赞按钮 */
    .nm3-cm-like {
      display: inline-flex; align-items: center; gap: 5px;
      height: 24px; padding: 0 10px; border-radius: 12px;
      border: 1px solid transparent; background: rgba(218,226,237,.06);
      color: var(--nm3-fg3); font-size: 11.5px; font-family: inherit;
      cursor: pointer; transition: all .18s;
    }
    .nm3-cm-like:hover { color: var(--nm3-accent); background: var(--nm3-hover); border-color: rgba(78,164,239,.35); }
    .nm3-cm-like.nm3-on { color: var(--nm3-accent); background: var(--nm3-sel); border-color: rgba(78,164,239,.45); }
    .nm3-cm-like.nm3-busy { opacity: .55; cursor: progress; }
    /* 歌名旁的歌手链接（可点进歌手详情） */
    .nm3-artist { color: inherit; text-decoration: none; transition: color .18s; }
    .nm3-artist:hover { color: var(--nm3-accent); text-decoration: underline; }
    .nm3-t-art .nm3-artist:hover { color: var(--nm3-accent); }
    .nm3-cm-more { margin: 18px 0 24px; }
    .nm3-cm-end { padding: 18px 0 30px; font-size: 12px; color: var(--nm3-fg3); }

    /* ══════════════ 搜索页 ══════════════ */
    .nm3-sh {
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      padding: 22px 34px; border-bottom: 1px solid var(--nm3-line);
    }
    .nm3-sh-meta { flex: 1 1 180px; min-width: 0; color: var(--nm3-fg3); font-size: 12.5px; }
    .nm3-sh-meta b { color: var(--nm3-accent); font-weight: 500; }

    /* 搜索空态 —— 和其他页一样做成有设计的一屏，而不是一句干提示 */
    .nm3-empty {
      display: flex; flex-direction: column; align-items: center;
      padding: 74px 40px 60px; text-align: center;
    }
    .nm3-empty-icon {
      width: 64px; height: 64px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(78,164,239,.12); color: var(--nm3-accent);
      box-shadow: 0 0 44px rgba(78,164,239,.20);
    }
    .nm3-empty-title { margin-top: 20px; font-size: 17px; font-weight: 600; color: var(--nm3-fg); }
    .nm3-empty-sub { margin-top: 8px; font-size: 13px; color: var(--nm3-fg3); }
    .nm3-empty-grp { margin-top: 34px; width: 100%; max-width: 560px; }
    .nm3-empty-label {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      font-size: 12px; color: var(--nm3-fg3); margin-bottom: 14px;
    }
    .nm3-empty-label a { color: var(--nm3-fg3); cursor: pointer; text-decoration: underline; }
    .nm3-empty-label a:hover { color: var(--nm3-accent); }
    .nm3-chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .nm3-chip-btn {
      display: inline-flex; align-items: center; height: 32px; padding: 0 18px;
      border-radius: 16px; cursor: pointer; font-size: 13px; max-width: 230px;
      color: var(--nm3-fg2); background: rgba(218,226,237,.06);
      border: 1px solid rgba(218,226,237,.10);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      transition: color .18s, background .18s, border-color .18s, transform .18s;
    }
    .nm3-chip-btn:hover {
      color: var(--nm3-accent); border-color: rgba(78,164,239,.55);
      background: var(--nm3-hover); transform: translateY(-1px);
    }

    /* ══════════════ 卡片栅格（歌单/专辑/歌手） ══════════════ */
    .nm3-grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); }
    .nm3-sec { padding: 0 34px 36px; }
    .nm3-sec-title {
      display: flex; align-items: baseline; gap: 10px; margin: 0 0 20px;
      font-size: 16px; font-weight: 600; letter-spacing: .3px; color: var(--nm3-fg);
    }
    .nm3-sec-title span { font-size: 12px; font-weight: 400; color: var(--nm3-fg3); }
    .nm3-card { cursor: pointer; }
    .nm3-card-cover {
      position: relative; width: 100%; aspect-ratio: 1 / 1;
      border-radius: 14px; overflow: hidden; background: var(--nm3-card);
      box-shadow: 0 4px 18px rgba(0,0,0,.4);
      transition: transform .22s cubic-bezier(.4,0,.2,1), box-shadow .22s;
    }
    .nm3-card-cover.nm3-round { border-radius: 50%; }
    .nm3-card-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .nm3-card:hover .nm3-card-cover {
      transform: translateY(-4px);
      box-shadow: 0 16px 36px rgba(0,0,0,.55), 0 0 0 1px rgba(78,164,239,.35);
    }
    .nm3-card-play {
      position: absolute; right: 10px; bottom: 10px;
      width: 38px; height: 38px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: var(--nm3-accent); color: ${INK};
      opacity: 0; transform: translateY(8px);
      transition: opacity .2s, transform .2s; box-shadow: 0 6px 18px rgba(0,0,0,.5);
    }
    .nm3-card:hover .nm3-card-play { opacity: 1; transform: translateY(0); }
    .nm3-card-play:hover { filter: brightness(1.12); transform: scale(1.08); }
    .nm3-card-name {
      margin-top: 11px; font-size: 13.5px; line-height: 1.45; color: var(--nm3-fg);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .nm3-card-count {
      margin-top: 3px; font-size: 12px; color: var(--nm3-fg3);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* ══════════════ 详情头（歌单/专辑/歌手） ══════════════ */
    .nm3-dh {
      position: relative; z-index: 1;
      display: flex; align-items: center; gap: 22px;
      padding: 24px 34px 22px; border-bottom: 1px solid var(--nm3-line);
    }
    .nm3-dh-cover {
      width: 82px; height: 82px; flex: 0 0 auto; border-radius: 12px; overflow: hidden;
      background: var(--nm3-card); box-shadow: 0 10px 26px rgba(0,0,0,.5);
    }
    .nm3-dh-cover.nm3-round { border-radius: 50%; }
    .nm3-dh-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .nm3-dh-info { flex: 1 1 auto; min-width: 0; }
    .nm3-dh-name {
      font-size: 19px; font-weight: 700; letter-spacing: .3px; color: var(--nm3-fg);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .nm3-dh-meta { margin-top: 7px; font-size: 12.5px; color: var(--nm3-fg3); }
    /* 歌手简介：默认 4 行，点一下展开 */
    .nm3-bio {
      position: relative; margin: 16px 34px 6px; padding: 14px 18px;
      border-radius: 12px; background: rgba(218,226,237,.04);
      border: 1px solid var(--nm3-line); color: var(--nm3-fg2);
      font-size: 13px; line-height: 1.85; white-space: pre-wrap; cursor: pointer;
      max-height: 116px; overflow: hidden; transition: max-height .24s;
    }
    .nm3-bio::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 44px;
      background: linear-gradient(180deg, rgba(20,21,33,0), var(--nm3-bg));
      pointer-events: none; transition: opacity .2s;
    }
    .nm3-bio.nm3-open { max-height: 2000px; }
    .nm3-bio.nm3-open::after { opacity: 0; }
    .nm3-bio-more {
      display: block; margin-top: 6px; font-size: 12px; color: var(--nm3-accent);
      position: relative; z-index: 1;
    }

    /* ══════════════ 我喜欢的音乐 ══════════════ */
    .nm3-hero {
      display: flex; align-items: center; gap: 26px;
      margin: 6px 34px 34px; padding: 26px 30px; border-radius: 20px;
      background:
        radial-gradient(120% 160% at 0% 0%, rgba(78,164,239,.22) 0%, rgba(45,60,129,.30) 42%, rgba(20,21,33,0) 100%),
        linear-gradient(135deg, #1D2440 0%, #191B2C 62%);
      border: 1px solid rgba(78,164,239,.18);
      box-shadow: 0 10px 34px rgba(0,0,0,.38);
    }
    .nm3-hero-cover {
      width: 112px; height: 112px; flex: 0 0 auto; border-radius: 14px; overflow: hidden;
      background: var(--nm3-deep); box-shadow: 0 12px 30px rgba(0,0,0,.5);
    }
    .nm3-hero-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .nm3-hero-info { flex: 1 1 auto; min-width: 0; }
    .nm3-hero-label {
      display: flex; align-items: center; gap: 10px;
      font-size: 20px; font-weight: 700; letter-spacing: .3px; color: var(--nm3-fg);
    }
    .nm3-hero-label svg { color: var(--nm3-accent); }
    .nm3-hero-count { margin-top: 7px; color: var(--nm3-fg3); font-size: 13px; }
    .nm3-hero-actions { margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap; }

    /* ══════════════ 轻提示 ══════════════ */
    .nm3-toast {
      position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%);
      background: rgba(30,33,51,.96); color: var(--nm3-fg);
      border: 1px solid rgba(78,164,239,.32);
      font-size: 13px; padding: 10px 22px; border-radius: 19px;
      z-index: 9999; pointer-events: none; opacity: 0; transition: opacity .22s;
      box-shadow: 0 12px 32px rgba(0,0,0,.5);
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .nm3-toast.nm3-show { opacity: 1; }

    /* ══════════════ 窄屏 ══════════════ */
    @media (max-width: 1000px) {
      #nm3-view-listen .nm3-np { flex-direction: column; gap: 26px; padding: 26px; }
      #nm3-view-listen .nm3-np-left { flex: 0 0 auto; width: 100%; }
      #nm3-view-listen .nm3-cover { width: 184px; height: 184px; }
      #nm3-view-listen .nm3-title { font-size: 20px; margin-top: 16px; }
      #nm3-view-listen .nm3-pane-wrap { height: 40vh; }
      .nm3-dh, .nm3-sec, .nm3-sh { padding-left: 20px; padding-right: 20px; }
      .nm3-hero { margin-left: 20px; margin-right: 20px; padding: 20px; gap: 18px; }
      .nm3-hero-cover { width: 84px; height: 84px; }
      .nm3-tracks { padding-left: 12px; padding-right: 12px; }
      .nm3-track { height: 52px; }
      .nm3-tracks.nm3-tagged .nm3-track { grid-template-columns: 36px minmax(0, 2fr) 54px minmax(0, 1.2fr) 52px; }
      .nm3-tracks .nm3-track { grid-template-columns: 36px minmax(0, 2fr) minmax(0, 1.2fr) 52px; }
      .nm3-t-cover { width: 36px; height: 36px; border-radius: 7px; }
      .nm3-t-idx, .nm3-t-alb { display: none; }
      .nm3-grid { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 18px; }
    }
  `;

  /* ═══════════════════════════ 状态 ═══════════════════════════ */

  const TABS = [
    { key: 'listen', label: '听歌' },
    { key: 'search', label: '搜索' },
    { key: 'mine', label: '我的音乐' }
  ];

  const SEARCH_TYPES = [
    { type: 1, key: 'songs', label: '单曲', total: 'songCount' },
    { type: 100, key: 'artists', label: '歌手', total: 'artistCount' },
    { type: 10, key: 'albums', label: '专辑', total: 'albumCount' },
    { type: 1000, key: 'playlists', label: '歌单', total: 'playlistCount' }
  ];

  let tab = 'listen';
  let barEl = null;
  let panelEl = null;
  let toastEl = null;
  let toastTimer = null;

  // 账号
  let userInfo = null;
  let lastUserId = null;

  // 听歌
  let curTrackId = null;
  let lyricLines = [];        // 拍平后的行：主行 + 紧跟其后的翻译 / 罗马音行（sub=true）
  let lyricPayload = null;    // 歌词接口原始返回（下载时写 .lrc 用）
  let lyricPayloadFor = null; // 上面那份对应的歌曲 id
  let lyricEmptyText = '这首歌暂时没有歌词';
  let lyricFetching = false;
  let lastCurLyric = -1;
  let lastCharOn = -1;        // 当前行已经点亮的字数（避免每个 tick 重排 DOM）
  let lastCharSec = -1;       // 上一次逐字同步的播放秒数（往回拖要重置）
  let curCharNodes = null;    // 当前行里那些逐字 span（渲染 / 换行时重建）
  let listenPane = 'lyric';   // 'lyric' | 'comment'

  // 当前歌曲的完整元数据。站点队列里的对象不一定带 album / artists
  //（实测见过只有 name/id/duration 的），缺失时用 /api/song/detail 补齐。
  let trackMeta = null;
  let trackMetaFor = null;

  // 进度条拖拽（全站唯一那根，在听歌页歌词上方）
  let seeking = false;
  let seekPreview = null;     // 拖拽中的预览秒数
  let seekTrackEl = null;     // 正在拖的那根轨道

  // 播放控制台
  let volDragging = false;    // 正在拖脚本自绘的音量条
  let volLast = 1;            // 最近一次请求的音量（松手时用来校验 / 兜底）
  let likedSet = null;        // 「我喜欢的音乐」trackId 集合（null=还没取，false=取不到）
  let likedFor = null;        // 这份集合对应的 uid
  let likedBusy = false;
  let likeBusy = false;       // 收藏请求正在飞（防连点）
  const likeLog = [];         // 写操作诊断（点赞 / 收藏），同时暴露成 window.__nm3LikeLog

  // 评论
  let cmSongId = null;
  let cmHot = [];
  let cmList = [];
  let cmTotal = 0;
  let cmMore = false;
  let cmBusy = false;
  let cmError = null;

  // 我的音乐
  let mineLiked = null;
  let mineMade = [];
  let mineSubs = [];
  let mineBusy = false;
  let mineError = null;
  let mineLoaded = false;
  let uid = null;

  // 搜索
  let searchKw = '';
  let searchType = 1;
  let searchData = {};
  let searchBusy = false;
  let searchError = null;
  let searchDone = false;
  let searchSeq = 0;

  // 共用详情（我的音乐 / 搜索都往里开）
  let detail = {
    active: false,
    owner: 'mine',      // 'mine' | 'search'
    kind: 'playlist',   // playlist | album | artist
    id: null,
    title: '', cover: '', sub: '',
    brief: '',          // 歌手简介（只有 artist 有）
    briefOpen: false,
    tracks: [], busy: false, error: null
  };

  /* ═══════════════════════════ 小工具 ═══════════════════════════ */

  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'nm3-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('nm3-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('nm3-show'), ms || 2200);
  }

  function stateBlock(title, sub, opts) {
    const o = opts || {};
    const spinner = o.loading ? '<div class="nm3-spin"></div>' : '';
    const action = o.action
      ? '<div><button class="nm3-btn ' + (o.primary ? 'nm3-primary' : '') +
        '" data-act="' + esc(o.action) + '">' + esc(o.actionLabel || '确定') + '</button></div>'
      : '';
    return (
      '<div class="nm3-state">' + spinner +
        '<div class="nm3-state-title">' + esc(title) + '</div>' +
        (sub ? '<div class="nm3-state-sub">' + esc(sub) + '</div>' : '') +
        action +
      '</div>'
    );
  }

  /** 统一的曲目行：封面 + 序号 + 歌名 (+标签) + 歌手 + 专辑 + 时长
   *  o = {current, tag:'new'|'old'} */
  function trackRow(i, song, o) {
    const opt = o || {};
    const cur = !!opt.current;
    const cover = pic(albumOf(song).picUrl, 80);
    let tag = '';
    if (opt.tag === 'new') tag = '<div><span class="nm3-tag nm3-new">新歌</span></div>';
    else if (opt.tag === 'old') tag = '<div><span class="nm3-tag nm3-old">红心</span></div>';
    return (
      '<div class="nm3-track' + (cur ? ' nm3-current' : '') + '" data-i="' + i + '">' +
        '<div class="nm3-t-cover">' +
          (cover ? '<img src="' + esc(cover) + '" alt="" loading="lazy">' : '') +
          '<span class="nm3-t-badge">♪</span>' +
        '</div>' +
        '<div class="nm3-t-idx">' + (cur ? '♪' : i + 1) + '</div>' +
        '<div class="nm3-t-name" title="' + esc(song.name || '') + '">' + esc(song.name || '') + '</div>' +
        tag +
        '<div class="nm3-t-art" title="' + esc(artistsOf(song)) + '">' + artistLinksHtml(song) + '</div>' +
        '<div class="nm3-t-alb" title="' + esc(albumOf(song).name) + '">' + esc(albumOf(song).name) + '</div>' +
        '<div class="nm3-t-dur">' + fmtDuration(song.duration || song.dt) + '</div>' +
      '</div>'
    );
  }

  function trackListHtml(list, opts) {
    const o = opts || {};
    const np = nowPlaying();
    const playingId = np && np.track ? String(np.track.id) : '';
    const rows = list
      .map((song, i) =>
        trackRow(i, song, {
          current: !!song && String(song.id) === playingId,
          tag: o.tags ? o.tags(song, i) : null
        })
      )
      .join('');
    return '<div class="nm3-tracks' + (o.tagged ? ' nm3-tagged' : '') +
      '" data-list="' + esc(o.list || 'detail') + '">' + rows + '</div>';
  }

  /** 与 trackListHtml 对称：只改“正在播放”那一行 */
  function updateCurrentRows(hostId, list) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const np = nowPlaying();
    const id = np && np.track ? String(np.track.id) : '';
    host.querySelectorAll('.nm3-track').forEach((row) => {
      const i = parseInt(row.getAttribute('data-i'), 10);
      const s = list[i];
      const cur = !!s && String(s.id) === id;
      row.classList.toggle('nm3-current', cur);
      const idx = row.querySelector('.nm3-t-idx');
      if (idx) idx.textContent = cur ? '♪' : String(i + 1);
    });
  }

  /* ═══════════════════════════ 定位 ═══════════════════════════ */

  /**
   * 注意：这里**不再**给播放条的 .wrap 做等比缩放（3.x 里为了让被挤出屏幕的
   * 播放条按钮可点，做过一次 scale）。原因有两个：
   *
   *   · 那些按钮现在都是「转发点击」，命中测试不再需要它们真的在屏幕上；
   *   · .wrap 一旦带 transform，就会成为 position:fixed 后代的包含块 ——
   *     播放列表抽屉（#g_playlist，挂在播放条壳里）会被拽着一起缩放、错位。
   *
   * 窄屏适配改由抽屉自己的媒体查询负责。
   */
  function layout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = CONFIG.BAR_H;

    if (barEl) {
      barEl.style.left = '0px';
      barEl.style.top = '0px';
      barEl.style.width = vw + 'px';
      barEl.style.height = CONFIG.BAR_H + 'px';
    }
    if (panelEl) {
      panelEl.style.left = '0px';
      panelEl.style.top = top + 'px';
      panelEl.style.width = vw + 'px';
      // 底部播放条不显示了，面板一路铺到视口底
      panelEl.style.height = Math.max(0, vh - top) + 'px';
    }
  }

  /* ═══════════════════════════ 页头 ═══════════════════════════ */

  function buildBar() {
    if (barEl) return;
    barEl = document.createElement('div');
    barEl.id = 'nm3-bar';
    barEl.innerHTML =
      '<span class="nm3-brand"><i></i><span>网易云音乐</span></span>' +
      '<nav class="nm3-tabs">' +
        TABS.map((t) => '<a class="nm3-tab" data-tab="' + t.key + '">' + esc(t.label) + '</a>').join('') +
      '</nav>' +
      '<div class="nm3-search">' +
        SVG.search(15, 'currentColor') +
        '<input id="nm3-input" type="text" placeholder="搜索歌曲、歌手、专辑、歌单" autocomplete="off">' +
        '<button id="nm3-go" type="button">搜索</button>' +
      '</div>' +
      '<div class="nm3-user" id="nm3-user"></div>';

    barEl.querySelector('.nm3-tabs').addEventListener('click', (e) => {
      const a = e.target.closest('.nm3-tab');
      if (!a) return;
      e.preventDefault();
      switchTab(a.getAttribute('data-tab'));
    });

    const input = barEl.querySelector('#nm3-input');
    input.addEventListener('keydown', (e) => {
      // 输入框里的按键不要冒到站点的全局快捷键上（空格会播放/暂停）
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch(input.value);
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
    barEl.querySelector('#nm3-go').addEventListener('click', () => runSearch(input.value));

    barEl.querySelector('#nm3-user').addEventListener('click', (e) => {
      const menu = e.target.closest('.nm3-user-menu a');
      if (menu) {
        doAction(menu.getAttribute('data-act'));
        barEl.querySelector('#nm3-user').classList.remove('nm3-open');
        return;
      }
      if (e.target.closest('.nm3-user-go')) { doAction('login'); return; }
      if (e.target.closest('.nm3-user-chip')) {
        barEl.querySelector('#nm3-user').classList.toggle('nm3-open');
      }
    });

    document.addEventListener('click', (e) => {
      const u = document.getElementById('nm3-user');
      if (u && !e.target.closest('#nm3-user')) u.classList.remove('nm3-open');
      const q = document.getElementById('nm3-q-wrap');
      if (q && !e.target.closest('#nm3-q-wrap')) q.classList.remove('nm3-open');
    });

    document.body.appendChild(barEl);
  }

  function renderUser() {
    const box = document.getElementById('nm3-user');
    if (!box) return;
    if (!isLoggedIn()) {
      box.classList.remove('nm3-open');
      box.innerHTML = '<button class="nm3-user-go" type="button">登录</button>';
      return;
    }
    const info = userInfo || {};
    const avatar = info.avatarUrl ? pic(info.avatarUrl, 60) : '';
    const name = info.nickname || '我';
    box.innerHTML =
      '<div class="nm3-user-chip">' +
        (avatar ? '<img src="' + esc(avatar) + '" alt="">' : '<img alt="">') +
        '<span>' + esc(name) + '</span>' +
      '</div>' +
      '<div class="nm3-user-menu"><a data-act="logout">退出登录</a></div>';
  }

  async function ensureUser() {
    const g = getGUser();
    const id = g && g.userId > 0 ? g.userId : 0;
    if (id === lastUserId) return;

    // 登录态变了（无论登录还是退出）：依赖账号的缓存全部作废
    lastUserId = id;
    userInfo = null;
    uid = null;
    likedSet = null;
    likedFor = null;
    mineLoaded = false;
    mineLiked = null;
    mineMade = [];
    mineSubs = [];
    mineError = null;
    renderUser();

    if (!id) return;
    // GUser 说有 id，但服务端可能已经不认了
    if (!(await checkLogin())) return;
    try {
      const d = await apiGet('/api/nuser/account/get');
      userInfo = (d && d.profile) || null;
    } catch (e) {
      userInfo = null;
    }
    if (lastUserId === id) renderUser();
  }

  /* ═══════════════════════════ 面板骨架 ═══════════════════════════ */

  function buildPanel() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.id = 'nm3-panel';
    panelEl.innerHTML =
      // 听歌
      '<div class="nm3-view" id="nm3-view-listen">' +
        '<div class="nm3-np-bg" id="nm3-np-bg"></div>' +
        '<div class="nm3-scroll"><div id="nm3-np-host"></div></div>' +
      '</div>' +
      // 搜索
      '<div class="nm3-view nm3-hide" id="nm3-view-search">' +
        '<div class="nm3-scroll" id="nm3-search-host"></div>' +
      '</div>' +
      // 我的音乐
      '<div class="nm3-view nm3-hide" id="nm3-view-mine">' +
        '<div class="nm3-scroll" id="nm3-mine-host"></div>' +
      '</div>';

    panelEl.addEventListener('click', onPanelClick);

    // 进度条 / 音量条拖拽：按下在面板里，移动 / 松开挂 document（拖出面板也要跟手）。
    // 带 __nm3Forwarded 的是脚本转发给原生控件的合成事件，不能再被这里吃一遍。
    panelEl.addEventListener('mousedown', onSeekDown);
    panelEl.addEventListener('mousedown', onVolDown);
    document.addEventListener('mousemove', (e) => {
      if (e.__nm3Forwarded) return;
      if (seeking) onSeekMove(e);
      else if (volDragging) onVolMove(e);
      else onSeekHover(e);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.__nm3Forwarded) return;
      onSeekUp();
      onVolUp();
    });

    document.body.appendChild(panelEl);
  }

  const ACTIONS = {
    login: () => doLogin(),
    logout: () => doLogout(),
    back: () => closeDetail(),
    'playdetail': () => playDetailAll(),
    'open': (el) => openItem(el.getAttribute('data-kind'), el.getAttribute('data-id'), false),
    'openplay': (el) => openItem(el.getAttribute('data-kind'), el.getAttribute('data-id'), true),
    'mine-retry': () => ensureMine(true),
    'search-retry': () => runSearch(searchKw, true),
    'cm-more': () => loadComments(curTrackId, true),
    'cm-retry': () => loadComments(curTrackId, false),
    'pane': (el) => setListenPane(el.getAttribute('data-pane')),
    'stype': (el) => runSearch(searchKw, true, parseInt(el.getAttribute('data-type'), 10)),
    // 点击歌词跳到对应时间
    'seek': (el) => {
      const s = parseFloat(el.getAttribute('data-sec'));
      if (!isFinite(s)) return;
      seekTo(s);
      lastCurLyric = -1;
      setTimeout(syncLyric, 80);
    },
    'quality-menu': () => toggleQualityMenu(),
    'quality-set': (el) => {
      toggleQualityMenu(false);
      setQuality(el.getAttribute('data-level'));
    },
    'search-chip': (el) => runSearch(el.getAttribute('data-kw'), true),
    'search-clear': () => { clearHistory(); renderSearch(); },

    // 播放控制台：全部转发给隐藏的原生控件
    'ctl-prev': () => forwardCtl('prev'),
    'ctl-next': () => forwardCtl('next'),
    'ctl-play': () => togglePlay(),
    'ctl-share': () => forwardCtl('share'),
    'ctl-list': () => toggleQueuePanel(),
    'ctl-like': () => { doLike().catch((e) => warn('收藏出错', e)); },
    // 点歌手名进歌手详情（借搜索视图展示，那里有返回和曲目列表）
    'artist': (el) => openArtist(el.getAttribute('data-id')),
    'album': (el) => openAlbum(el.getAttribute('data-id')),
    'cm-like': (el) => likeComment(el),
    // 下载当前这首（网页端直接存文件，按当前音质档位）
    // Shift / Alt + 点击 = 重新挑一次音乐文件夹（详见 ensureDownloadDir）
    'dl-current': (el, ev) => downloadCurrent(null, { pickDir: !!(ev && (ev.shiftKey || ev.altKey)) }),
    'bio-toggle': () => { detail.briefOpen = !detail.briefOpen; renderCurrent(); },
    'ctl-mode': () => {
      if (!forwardCtl('mode')) return;
      // 站点切换模式后按钮的 title 才会变，等它写完再刷新显示
      setTimeout(() => {
        updateControlsUi();
        toast('播放模式：' + nativeModeLabel());
      }, 60);
    }
  };

  function doAction(name, el, ev) {
    const fn = ACTIONS[name];
    if (fn) fn(el, ev);
  }

  /**
   * ★ 这些按钮的点击必须就地拦下，不能再冒泡到 document。
   *
   * 站点在 document 上挂了一个「点别处就收起播放列表 + 藏音量条」的处理器
   * （frame.js 里 b8q.uK4y：`this.uR2q && this.uR2q.V8C()`）。我们点「播放列表」
   * 的那一下转发出去、面板刚建好，**同一个点击**继续冒到 document，面板就
   * 立刻被收掉了 —— 实测面板存在不到一帧，表现就是「播放列表点了没反应」。
   *
   * 转发本身不受影响：动作是脚本另外合成的点击，由站点在 .m-playbar 上的
   * 分发器处理（它自己会 stopEvent）。
   */
  const FORWARD_ACTS = {
    'ctl-prev': 1, 'ctl-next': 1, 'ctl-play': 1, 'ctl-mode': 1,
    'ctl-like': 1, 'ctl-list': 1, 'ctl-share': 1
  };

  function onPanelClick(e) {
    const act = e.target.closest('[data-act]');
    if (act) {
      const name = act.getAttribute('data-act');
      if (FORWARD_ACTS[name]) e.stopPropagation();
      doAction(name, act, e);
      return;
    }
    const row = e.target.closest('.nm3-track');
    if (row) {
      const i = parseInt(row.getAttribute('data-i'), 10);
      if (!isFinite(i)) return;
      playDetailAt(i);
      return;
    }
    const card = e.target.closest('[data-card]');
    if (card) openItem(card.getAttribute('data-kind'), card.getAttribute('data-card'), false);
  }

  function doLogin() {
    try {
      if (typeof window.top.login === 'function') { window.top.login(); return; }
    } catch (e) { /* noop */ }
    toast('登录入口没能打开，刷新页面再试');
  }

  function doLogout() {
    try {
      if (typeof window.top.logout === 'function') {
        window.top.logout();
        toast('已退出登录');
        return;
      }
    } catch (e) { /* noop */ }
    toast('退出失败，刷新页面再试');
  }

  function switchTab(next) {
    if (TABS.every((t) => t.key !== next)) return;
    tab = next;

    if (barEl) {
      barEl.querySelectorAll('.nm3-tab').forEach((a) => {
        a.classList.toggle('nm3-on', a.getAttribute('data-tab') === next);
      });
    }
    ['listen', 'search', 'mine'].forEach((k) => {
      const v = document.getElementById('nm3-view-' + k);
      if (v) v.classList.toggle('nm3-hide', next !== k);
    });

    if (next === 'search') {
      const input = document.getElementById('nm3-input');
      if (input) { try { input.focus(); } catch (e) { /* noop */ } }
      if (!searchDone && !searchBusy) renderSearch();
    }
    if (next === 'mine') ensureMine();

    layout();
  }

  /* ═══════════════════════════ 播放器读取 ═══════════════════════════ */

  function nowPlaying() {
    const p = getPlayer();
    if (!p || typeof p.getPlaying !== 'function') return null;
    try {
      const r = p.getPlaying();
      if (!r || !r.track) return null;
      return r;
    } catch (e) {
      return null;
    }
  }

  /**
   * 站点用 document.createElement('audio') 造播放器的音频元素，但不挂到
   * DOM 上（frame.js: Bv4W = a6u.ds6q("audio")），所以 querySelector('audio')
   * 找不到它。抢在站点脚本之前把 createElement 包一层，把它抓出来，
   * 歌词才能精确对上时间轴。
   */
  let capturedAudio = null;

  function hookAudioElement() {
    try {
      const proto = window.Document && window.Document.prototype;
      if (!proto || proto.__nm3Hooked) return;
      const orig = proto.createElement;
      proto.createElement = function (tag, opts) {
        const el = orig.call(this, tag, opts);
        try {
          if (!capturedAudio && String(tag).toLowerCase() === 'audio') capturedAudio = el;
        } catch (e) { /* noop */ }
        return el;
      };
      proto.__nm3Hooked = true;
    } catch (e) {
      warn('createElement 挂钩失败，歌词高亮退化为秒级', e);
    }
  }

  function currentSeconds() {
    const a = capturedAudio;
    if (a && isFinite(a.currentTime) && a.currentTime > 0) return a.currentTime;
    try {
      const el = document.querySelector('audio');
      if (el && isFinite(el.currentTime) && el.currentTime > 0) return el.currentTime;
    } catch (e) { /* noop */ }
    try {
      const em = document.querySelector('#g_player .m-pbar .time em');
      if (em) {
        const t = parseClock(em.textContent);
        if (t != null) return t;
      }
    } catch (e) { /* noop */ }
    return null;
  }

  /* ─────────────── 进度条 / 跳转 ─────────────── */

  function fmtClock(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) return '00:00';
    const t = Math.floor(sec);
    const m = Math.floor(t / 60);
    const s = t % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  /** 比例 → 百分比：定到小数点后两位，免得浮点噪声每 tick 都改一次样式 */
  function pct(ratio) {
    const v = Math.max(0, Math.min(1, Number(ratio) || 0));
    return (Math.round(v * 10000) / 100).toFixed(2) + '%';
  }

  /** 当前歌曲总时长（秒）：audio → 播放条时间文本 → 歌曲元数据 */
  function durationSeconds() {
    const a = capturedAudio;
    if (a && isFinite(a.duration) && a.duration > 0) return a.duration;
    try {
      const el = document.querySelector('audio');
      if (el && isFinite(el.duration) && el.duration > 0) return el.duration;
    } catch (e) { /* noop */ }
    try {
      const box = document.querySelector('#g_player .m-pbar .time');
      if (box) {
        const m = /\/\s*(\d{1,3}):(\d{2})/.exec(box.textContent || '');
        if (m) {
          const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
          // 0 说明站点自己也还没加载出时长，继续往下兜底（别把 --:-- 显示成 00:00）
          if (sec > 0) return sec;
        }
      }
    } catch (e) { /* noop */ }
    const np = nowPlaying();
    if (np && np.track) {
      const info = trackInfo(np.track);
      if (info.duration > 0) return info.duration / 1000;
    }
    return 0;
  }

  /**
   * 跳到指定秒数。
   * 站点把进度条绑在 NEJ slider 上（.m-pbar .barbg，onslidestop 里调媒体 seek），
   * 但最直接可靠的是改 <audio>.currentTime —— 站点监听了 timeupdate，
   * 进度条和时间文本会自己跟上。audio 拿不到时再模拟拖拽那根条。
   */
  function seekTo(sec) {
    if (!isFinite(sec) || sec < 0) return false;

    let a = capturedAudio;
    if (!a) {
      try { a = document.querySelector('audio'); } catch (e) { a = null; }
    }
    if (a) {
      try {
        const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
        a.currentTime = dur ? Math.min(sec, Math.max(0, dur - 0.3)) : sec;
        return true;
      } catch (e) {
        warn('设置 currentTime 失败，改用 DOM 兜底', e);
      }
    }

    const p = getPlayer();
    if (p && typeof p.seek === 'function') {
      try { p.seek(sec); return true; } catch (e) { /* noop */ }
    }
    return seekViaDom(sec);
  }

  /** DOM 兜底：按比例在站点自己的进度条上模拟一次拖拽 */
  function seekViaDom(sec) {
    let ok = false;
    try {
      const bar = document.querySelector('#g_player .m-pbar .barbg') ||
        document.querySelector('#g_player .m-pbar');
      if (!bar) return false;
      const r = bar.getBoundingClientRect();
      const dur = durationSeconds();
      if (!r.width || !dur) return false;

      const x = r.left + Math.max(0, Math.min(1, sec / dur)) * r.width;
      const y = r.top + r.height / 2;
      const mk = (type, buttons) => new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: buttons
      });

      bar.dispatchEvent(mk('mousedown', 1));
      document.dispatchEvent(mk('mousemove', 1));
      document.dispatchEvent(mk('mouseup', 0));
      bar.dispatchEvent(mk('click', 0));
      ok = true;
    } catch (e) {
      warn('模拟进度条拖拽失败', e);
    }
    return ok;
  }

  function ratioFromEvent(e, track) {
    const r = track.getBoundingClientRect();
    if (!r.width) return 0;
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  /** 已缓存比例：读 <audio>.buffered 里覆盖当前时长的最后一段 */
  function bufferedRatio(dur) {
    if (!dur) return 0;
    let a = capturedAudio;
    if (!a) {
      try { a = document.querySelector('audio'); } catch (e) { a = null; }
    }
    if (!a || !a.buffered || !a.buffered.length) return 0;
    try {
      let end = 0;
      for (let i = 0; i < a.buffered.length; i++) {
        const e2 = a.buffered.end(i);
        if (a.buffered.start(i) <= dur && e2 > end) end = e2;
      }
      return Math.max(0, Math.min(1, end / dur));
    } catch (e) {
      return 0;
    }
  }

  /** 进度条的标记：全站唯一一根，摆在歌词上方 */
  function seekTrackHtml() {
    return (
      '<div class="nm3-seek-track">' +
        '<div class="nm3-seek-rail">' +
          '<div class="nm3-seek-buf"></div>' +
          '<div class="nm3-seek-fill"></div>' +
        '</div>' +
        '<div class="nm3-seek-knob"></div>' +
        '<div class="nm3-seek-tip"></div>' +
      '</div>'
    );
  }

  /** 刷新进度条（听歌页歌词上方那根，全站唯一） */
  function updateSeekBar() {
    const dur = durationSeconds();
    const cur = seeking && seekPreview != null ? seekPreview : (currentSeconds() || 0);
    const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
    const buf = bufferedRatio(dur);
    const idle = !(dur > 0);

    document.querySelectorAll('.nm3-seek-track').forEach((track) => {
      const fill = track.querySelector('.nm3-seek-fill');
      if (fill) fill.style.width = pct(ratio);
      const b = track.querySelector('.nm3-seek-buf');
      if (b) b.style.width = pct(buf);
      const knob = track.querySelector('.nm3-seek-knob');
      if (knob) knob.style.left = pct(ratio);
      const root = track.parentElement;   // .nm3-seek
      if (root) {
        root.classList.toggle('nm3-dragging', seeking && track === seekTrackEl);
        root.classList.toggle('nm3-idle', idle);
      }
    });

    const curText = fmtClock(cur);
    const durText = idle ? '--:--' : fmtClock(dur);
    document.querySelectorAll('.nm3-seek-cur').forEach((n) => { n.textContent = curText; });
    document.querySelectorAll('.nm3-seek-dur').forEach((n) => { n.textContent = durText; });
  }

  function placeTip(track, ratio, dur) {
    const tip = track.querySelector('.nm3-seek-tip');
    if (!tip) return;
    tip.style.left = pct(ratio);
    tip.textContent = fmtClock(ratio * dur);
    tip.classList.add('nm3-on');
  }

  function hideTips(except) {
    document.querySelectorAll('.nm3-seek-tip').forEach((tip) => {
      if (except && except.contains(tip)) return;
      tip.classList.remove('nm3-on');
    });
  }

  function onSeekDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.__nm3Forwarded) return;
    const track = e.target.closest && e.target.closest('.nm3-seek-track');
    if (!track) return;
    const dur = durationSeconds();
    const ratio = ratioFromEvent(e, track);
    e.preventDefault();
    seeking = true;
    seekTrackEl = track;
    seekPreview = ratio * dur;
    updateSeekBar();
    if (dur > 0) placeTip(track, ratio, dur);
  }

  function onSeekMove(e) {
    if (!seeking || !seekTrackEl) return;
    const dur = durationSeconds();
    const ratio = ratioFromEvent(e, seekTrackEl);
    seekPreview = ratio * dur;
    updateSeekBar();
    if (dur > 0) placeTip(seekTrackEl, ratio, dur);
  }

  function onSeekUp() {
    if (!seeking) return;
    seeking = false;
    seekTrackEl = null;
    const t = seekPreview;
    seekPreview = null;
    hideTips();
    if (t != null && isFinite(t)) {
      seekTo(t);
      lastCurLyric = -1;
      setTimeout(syncLyric, 80);
    }
    updateSeekBar();
  }

  /** 悬停在任意一根进度条上时，浮出那一处对应的目标时间 */
  function onSeekHover(e) {
    if (seeking) return;
    const track = e.target.closest && e.target.closest('.nm3-seek-track');
    const dur = durationSeconds();
    if (!track || !dur) { hideTips(); return; }
    const ratio = ratioFromEvent(e, track);
    hideTips(track);
    placeTip(track, ratio, dur);
  }

  /* ══════════════ 播放控制台（底部播放条的功能搬到这里） ══════════════
   *
   * 站点播放条上每个控件都是服务端渲染好的 <a data-action="…">：
   *
   *     prev / play / next        上一首 / 播放暂停 / 下一首
   *     like / share              收藏 / 分享
   *     volume / mode / panel     音量 / 播放模式 / 播放列表
   *
   * 它们只是被 visibility 藏起来了，元素、状态、事件都还在。所以本脚本搬
   * 过来的是「操作入口」而不是「播放逻辑」：自绘按钮按下时，朝对应元素合成
   * 一次点击（带元素矩形中心的真实坐标），剩下的全交给站点自己那套代码 ——
   * 播放状态机、模式轮换、队列浮层、收藏、音量持久化都不用重写，也就不会
   * 和站点打架。找不到控件（站点改版 / 还没渲染）时给个提示，不静默失败。
   */

  const AUDIO_FALLBACK = () => {
    try { return document.querySelector('audio'); } catch (e) { return null; }
  };

  function audioEl() {
    return capturedAudio || AUDIO_FALLBACK();
  }

  /** 原生播放条上的某个控件（data-action 是站点自己的分发键，很稳定） */
  function nativeCtl(action) {
    try {
      return document.querySelector('.m-playbar [data-action="' + action + '"]');
    } catch (e) {
      return null;
    }
  }

  function fireMouse(el, type, x, y, buttons) {
    if (!el) return;
    try {
      const ev = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: Math.round(x || 0), clientY: Math.round(y || 0),
        button: 0, buttons: buttons == null ? 0 : buttons
      });
      // ★ 标记：这是脚本自己合成的转发事件。它同样会冒泡到 document，而
      //   document 上挂着脚本自己的拖拽处理（进度条 / 音量），不打标记就会
      //   被自己再吃一遍 —— 音量的转发里正好又合成 mousemove，会无限递归。
      ev.__nm3Forwarded = true;
      el.dispatchEvent(ev);
    } catch (e) { /* noop */ }
  }

  /** 合成一次点击（坐标用元素矩形中心，站点有些浮层会按坐标定位） */
  function fireClick(el) {
    if (!el) return false;
    let x = 0;
    let y = 0;
    try {
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } catch (e) { /* noop */ }
    fireMouse(el, 'click', x, y, 0);
    return true;
  }

  /** 把动作转发给隐藏的原生控件 */
  function forwardCtl(action) {
    const el = nativeCtl(action);
    if (!el) {
      toast('播放条控件还没就绪，稍后再试');
      return false;
    }
    fireClick(el);
    return true;
  }

  /**
   * 播放/暂停按钮要单独找：站点会在播放状态变化时把它的 data-action 在
   * play / pause 之间来回换（class 也在 ply / pas 之间换），所以按类名或
   * 固定 data-action 都可能落空，这里按优先级都试一遍。
   */
  function nativePlayBtn() {
    const sel = [
      '.m-playbar .btns [data-action="play"]',
      '.m-playbar .btns [data-action="pause"]',
      '.m-playbar .btns .ply',
      '.m-playbar .btns .pas'
    ];
    for (const s of sel) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch (e) { /* noop */ }
    }
    return null;
  }

  function togglePlay() {
    const el = nativePlayBtn();
    if (!el) {
      toast('播放条控件还没就绪，稍后再试');
      return false;
    }
    fireClick(el);
    return true;
  }

  /* ── 音量：原生那根是 NEJ 竖滑条（.m-vol .vbg，顶=100%） ──
   * 站点自己的算法就是 `volume = 1 - y.rate`，所以把脚本自绘的横条换算成
   * 竖条上的 y，按下 / 移动 / 抬起各转发一次，等于用户亲自动手拖了它。
   */

  function volumeRatio() {
    const a = audioEl();
    if (a && isFinite(a.volume)) return Math.max(0, Math.min(1, a.volume));
    const cur = document.querySelector('.m-playbar .m-vol .curr');
    if (cur) {
      const h = parseFloat(cur.style.height);
      if (h > 0) return Math.max(0, Math.min(1, h / 93));   // 站点按 93px 满格
    }
    return 1;
  }

  function volGeometry() {
    const track = document.querySelector('.m-playbar .m-vol .vbg');
    if (!track) return null;
    const r = track.getBoundingClientRect();
    if (!r || r.height <= 4) return null;
    return { track: track, r: r, x: r.left + r.width / 2 };
  }

  function volY(r, ratio) {
    return r.bottom - Math.max(0, Math.min(1, ratio)) * r.height;
  }

  /** 兜底：原生滑条要是不认合成事件（站点改版），直接改音频元素的音量 */
  function setVolumeDirect(ratio) {
    const a = audioEl();
    if (!a) return false;
    try {
      a.volume = Math.max(0, Math.min(1, ratio));
      return true;
    } catch (e) {
      return false;
    }
  }

  function volumeBegin(ratio) {
    const g = volGeometry();
    if (!g) return setVolumeDirect(ratio);
    fireMouse(g.track, 'mousedown', g.x, volY(g.r, ratio), 1);
    return true;
  }

  function volumeMove(ratio) {
    const g = volGeometry();
    if (!g) return setVolumeDirect(ratio);
    fireMouse(document, 'mousemove', g.x, volY(g.r, ratio), 1);
    return true;
  }

  function volumeEnd(ratio) {
    fireMouse(document, 'mouseup', 0, 0, 0);
    // 转发成功的话站点已经改了音量，这里只是校验 + 兜底
    const a = audioEl();
    if (a && isFinite(a.volume) && Math.abs(a.volume - ratio) > 0.03) setVolumeDirect(ratio);
  }

  function volRatioFromEvent(e, vol) {
    const rail = vol.querySelector('.nm3-vol-rail') || vol;
    const r = rail.getBoundingClientRect();
    if (!r.width) return 0;
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  function onVolDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.__nm3Forwarded) return;
    const vol = e.target.closest && e.target.closest('.nm3-vol');
    if (!vol) return;
    e.preventDefault();
    volDragging = true;
    volLast = volRatioFromEvent(e, vol);
    volumeBegin(volLast);
    updateControlsUi();
  }

  function onVolMove(e) {
    if (!volDragging) return;
    const vol = document.getElementById('nm3-vol');
    if (!vol) { volDragging = false; return; }
    volLast = volRatioFromEvent(e, vol);
    volumeMove(volLast);
    updateControlsUi();
  }

  function onVolUp() {
    if (!volDragging) return;
    volDragging = false;
    volumeEnd(volLast);
    updateControlsUi();
  }

  /** 拖拽中鼠标移到别处也能继续（document 级监听统一在 buildPanel 里接） */

  /* ── 收藏状态：「我喜欢的音乐」的 trackId 集合 ──
   * 站点对普通歌曲并不在播放条按钮上标已收藏，所以自己维护一份。
   * 只取一次（换账号失效），点过收藏后延迟重取一次校验。
   */
  async function ensureLikedSet(force) {
    if (likedBusy) return;
    const id = await getUid();
    if (!id) { likedSet = false; return; }
    if (!force && likedFor === id && likedSet instanceof Set) return;

    likedBusy = true;
    likedFor = id;
    try {
      const d = await apiGet('/api/user/playlist', { uid: id, limit: 1000, offset: 0 });
      const liked = ((d && d.playlist) || []).find((p) => p && p.specialType === 5);
      if (!liked) { if (likedFor === id) likedSet = false; return; }
      // trackIds 才是完整列表（歌单很大时 tracks 会被截断）。万一某个接口版本
      // 没给 trackIds，就退回 tracks —— 把 n 放大到 1000 再取一次。
      let pl = ((await apiGet('/api/v6/playlist/detail', { id: liked.id, n: 1, s: 8 })) || {}).playlist || {};
      let ids = likedIdsOf(pl);
      if (!ids.length) {
        pl = ((await apiGet('/api/v6/playlist/detail', { id: liked.id, n: 1000, s: 8 })) || {}).playlist || {};
        ids = likedIdsOf(pl);
      }
      if (likedFor !== id) return;
      likedSet = new Set(ids);
    } catch (e) {
      if (likedFor === id) likedSet = false;   // 取不到就不假装知道状态
    } finally {
      likedBusy = false;
    }
  }

  /** 从歌单详情里挖出歌曲 id：优先 trackIds（完整），其次 tracks */
  function likedIdsOf(pl) {
    const pick = (arr) => (arr || []).map((x) => (x && x.id != null ? String(x.id) : '')).filter(Boolean);
    const ids = pick(pl && pl.trackIds);
    return ids.length ? ids : pick(pl && pl.tracks);
  }

  function isLiked(songId) {
    if (!(likedSet instanceof Set) || songId == null) return null;
    return likedSet.has(String(songId));
  }

  /**
   * 收藏 / 取消收藏当前这首歌。
   *
   * ★ 不能只调一下 window.subscribe 就当成功：站点那个 subscribe 在「内容 iframe
   *   还没起来 / 顶层 window.GUser 还没写进来」的时候会**静默什么都不做**
   *   （core.js 里 `if (bJ6O.nm && bJ6O.nm.x)` 没有 else 分支），脚本却当成收藏
   *   成功 —— 表现就是「点了收藏没反应」。所以这里按「先自己打接口 → 不成再退回
   *   复用站点自己的入口 → 最后校验真实状态 → 按结果说人话」来做。
   */
  async function doLike() {
    const np = nowPlaying();
    const track = np && np.track;
    if (!track) { toast('还没有正在播放的歌曲'); return; }
    if (likeBusy) { toast('上一次收藏还没处理完'); return; }

    likeBusy = true;
    const btn = document.getElementById('nm3-ctl-like');
    if (btn) btn.classList.add('nm3-busy');
    try {
      await ensureLikedSet(true);
      const cur = isLiked(track.id);
      const want = !cur;                     // 状态拿不到时按「收藏」来
      const res = await postRadioLike(track.id, want);
      let via = 'api';
      if (res.code !== 200) {
        // 接口这条路没成（风控 / 接口变了）：退回复用站点自己的收藏入口
        via = 'native';
        if (!callNativeSubscribe(track)) warn('站点 subscribe 用不了，收藏多半也没成', res);
      }
      await new Promise((r) => setTimeout(r, 900));
      await ensureLikedSet(true);
      const now = isLiked(track.id);
      if (now === want) {
        toast(want ? '已收藏到「我喜欢的音乐」' : '已取消收藏', 2000);
      } else {
        warn('收藏没生效', { via: via, want: want, now: now, res: res });
        toast(likeFailText(res) + '（收藏没生效，F12 里有 window.__nm3LikeLog）', 4400);
      }
    } finally {
      likeBusy = false;
      if (btn) btn.classList.remove('nm3-busy');
      updateControlsUi();
    }
  }

  /**
   * 直接打站点网页版自己的收藏接口 /api/radio/like。
   * 参数照抄站点实现：alg=itembased、trackId、like、time —— ★ time 是写死的 '3'，
   * 不是毫秒时间戳；like 只有**字符串 'false'** 才算取消，其它值一律当收藏。
   * 另外实测：不带客户端姿态（os=pc 那套 cookie）时这条接口会被风控直接回 -460，
   * 带上就回到正常的 301（未登录）/ 200 —— markClientCookie 已经在会话里补好了。
   */
  async function postRadioLike(songId, like) {
    const params = new URLSearchParams({
      alg: 'itembased',
      trackId: String(songId),
      like: like ? 'true' : 'false',
      time: '3',
      csrf_token: csrfToken()
    });
    Object.keys(CLIENT_SIGN).forEach((k) => { if (!params.has(k)) params.set(k, CLIENT_SIGN[k]); });
    const res = await sendForm('/api/radio/like', params);
    likeDiag('radio-like', { songId: songId, like: !!like, code: res.code, msg: res.msg });
    return res;
  }

  /** 站点自己的收藏入口：顶层 window.subscribe（播放条那个 ♡ 就是它），失败再退原生按钮 */
  function callNativeSubscribe(track) {
    try {
      const w = window.top;
      if (w && typeof w.subscribe === 'function') {
        w.subscribe(track, !!track.program);
        return true;
      }
    } catch (e) { warn('调用站点 subscribe 失败', e); }
    return forwardCtl('like');
  }

  /* ── 评论点赞 ──
   * 站点自己的实现（core.js 的 ievent-like）是：
   *     点赞   POST /api/v1/comment/like
   *     取消   POST /api/v1/comment/unlike
   * 请求体只有 threadId=R_SO_4_<歌曲>、commentId、csrf_token 三个字段。
   * ★ 早先脚本把「点赞 / 取消」做成了同一个路由上的 type=1/0 开关：**取消点赞发到了
   *   /comment/like 上**，而官方那条是 /comment/unlike；服务端认的 type 是「资源类型」
   *   （0=歌曲 1=MV 2=歌单…），不是点赞开关。实测（未登录探测）带不带 type、type 传 0
   *   还是 1，这条路由都只按 threadId 走、都回 301，所以这里按官方口径发：路由分
   *   点赞 / 取消，type 固定 0（歌曲）。
   * ★ 更要紧的是失败时的**可见性**：老代码把服务端的 code 吞成一句「点赞失败，稍后
   *   再试」，用户看不出到底是没登录（301）、被风控（-460/-462）还是接口变了（404）。
   *   现在把这些原因如实说出来，并写进 window.__nm3LikeLog。
   * 未登录回 code=301（HTTP 仍然是 200），参数问题回 400，接口不存在回 404。
   */
  function csrfToken() {
    const m = /(?:^|;\s*)__csrf=([^;]+)/.exec(document.cookie || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  /** 写操作诊断：记进 likeLog，同时挂到 window.__nm3LikeLog，出问题时好让人贴回来 */
  function likeDiag(tag, info) {
    try {
      likeLog.push(Object.assign({ at: new Date().toISOString(), tag: tag }, info));
      if (likeLog.length > 20) likeLog.shift();
      window.__nm3LikeLog = likeLog;
    } catch (e) { /* noop */ }
  }

  /** 统一的表单 POST：不管成功失败都返回 {code, msg}，不抛错（调用方好判断） */
  async function sendForm(path, params) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/plain, */*'
        },
        body: params.toString()
      });
    } catch (e) {
      return { code: 0, msg: (e && e.message) || '网络异常' };
    }
    if (!res.ok) return { code: res.status, msg: 'HTTP ' + res.status };
    let d = null;
    try { d = await res.json(); } catch (e) { return { code: 0, msg: '返回的不是 JSON' }; }
    const code = (d && d.code != null) ? Number(d.code) : 0;
    return { code: code, msg: (d && (d.message || d.msg)) || '', data: d };
  }

  async function postCommentLike(songId, commentId, type) {
    const like = Number(type) === 1;
    const params = new URLSearchParams({
      threadId: 'R_SO_4_' + songId,
      commentId: String(commentId),
      type: '0',                                  // 资源类型：0=歌曲
      csrf_token: csrfToken()
    });
    let res = await sendForm(like ? '/api/v1/comment/like' : '/api/v1/comment/unlike', params);
    if (res.code !== 200 && !like) {
      // 兼容另一种服务端口径：取消点赞也接受 /comment/like + type=0
      const alt = await sendForm('/api/v1/comment/like', params);
      if (alt.code === 200) res = alt;
    }
    likeDiag('comment-like', {
      path: like ? '/api/v1/comment/like' : '/api/v1/comment/unlike',
      songId: songId, commentId: String(commentId), want: like ? 1 : 0,
      code: res.code, msg: res.msg
    });
    return res;
  }

  /** 写操作失败时说人话（点赞 / 收藏共用） */
  function likeFailText(res) {
    const code = res && res.code;
    const detail = (res && res.msg) ? '：' + res.msg : '';
    if (code === 301) return '要先登录网易云音乐';
    if (code === 400) return '请求被服务端拒了（参数 / 资源 id 不被接受' + detail + '）';
    if (code === -460 || code === -462) return '被风控拦下了（提示网络环境有风险），换网络或过一会儿再试';
    if (code === 404) return '这个接口没找到（站点接口变了，控制台有详情）';
    if (code === 250) return '服务端返回 250（业务失败），稍后再试';
    if (!code) return '请求没发出去' + detail;
    return '失败（code=' + code + detail + '）';
  }

  /** 评论对象：热评的 key 是 h0/h1…，最新的是下标 */
  function commentByKey(key) {
    const k = String(key == null ? '' : key);
    if (!k) return null;
    if (k.charAt(0) === 'h') return cmHot[parseInt(k.slice(1), 10)] || null;
    return cmList[parseInt(k, 10)] || null;
  }

  async function likeComment(btn) {
    const cid = btn.getAttribute('data-cid');
    const songId = cmSongId || curTrackId;
    if (!cid || !songId) { toast('等评论加载完再点赞'); return; }
    if (btn.getAttribute('data-busy') === '1') return;

    const liked = btn.getAttribute('data-liked') === '1';
    const want = liked ? 0 : 1;
    const n0 = parseInt(btn.getAttribute('data-n'), 10) || 0;

    btn.setAttribute('data-busy', '1');
    btn.classList.add('nm3-busy');
    let res;
    try { res = await postCommentLike(songId, cid, want); }
    catch (e) { res = { code: 0, msg: (e && e.message) || '请求失败' }; }
    btn.setAttribute('data-busy', '');
    btn.classList.remove('nm3-busy');

    if (!res || res.code !== 200) {
      warn('评论点赞失败', res, '（诊断见 window.__nm3LikeLog）');
      toast(likeFailText(res), 4000);
      return;
    }

    const n1 = Math.max(0, n0 + (want ? 1 : -1));
    btn.setAttribute('data-n', String(n1));
    btn.setAttribute('data-liked', want ? '1' : '0');
    btn.classList.toggle('nm3-on', !!want);
    const span = btn.querySelector('span');
    if (span) span.textContent = n1 ? fmtCount(n1) : '赞';
    toast(want ? '已点赞' : '已取消点赞', 1500);

    // 同步到底层数据，重绘（切页签 / 加载更多）后状态还在
    const c = commentByKey(btn.getAttribute('data-ci'));
    if (c) {
      c.liked = !!want;
      c.likedCount = n1;
    }
  }

  function openArtist(id) {
    if (!id) return;
    // 歌手详情借用「搜索」那个视图（有返回按钮 + 曲目列表），所以先切过去，
    // openItem 就会把详情挂在搜索页上
    switchTab('search');
    openItem('artist', id, false);
  }

  /** 专辑详情同理：专辑名点一下就进（曲目走 /api/v1/album，见 loadDetail） */
  function openAlbum(id) {
    if (!id) return;
    switchTab('search');
    openItem('album', id, false);
  }

  /* ── 播放列表抽屉 ──
   * 面板内容与交互都是站点自己的（#g_playlist）：点行换歌、删除、收藏全部、
   * 清除、关闭，脚本只负责「点我们的按钮 → 帮它展开 / 收起」+ 摆好位置 + 换皮。
   * 站点收起时会给面板 display:none，所以「有没有尺寸」就是开关状态。
   */
  function queuePanelEl() {
    try {
      return document.getElementById('g_playlist');
    } catch (e) {
      return null;
    }
  }

  function queuePanelOpen() {
    const p = queuePanelEl();
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function syncQueuePanelUi() {
    const open = queuePanelOpen();
    const btn = document.getElementById('nm3-ctl-list');
    if (btn) btn.classList.toggle('nm3-on', open);
    return open;
  }

  function toggleQueuePanel() {
    const willOpen = !queuePanelOpen();
    if (!forwardCtl('panel')) return;
    // 面板是站点点开时才建的，等它渲染完再刷新按钮状态 / 让列表回到顶部
    setTimeout(() => {
      const p = queuePanelEl();
      const open = syncQueuePanelUi();
      if (!open || !p) return;
      const list = p.querySelector('.listbdc');
      if (list && willOpen) list.scrollTop = 0;
      const n = p.querySelectorAll('.listbdc li').length;
      toast(n ? '播放列表：' + n + ' 首，点歌名切换' : '播放列表是空的，先放一首歌');
    }, 90);
  }

  /* ── 控制台标记 ── */

  function controlsHtml() {
    return (
      '<div class="nm3-ctl" id="nm3-ctl">' +
        '<div class="nm3-ctl-grp">' +
          '<button class="nm3-cbtn" type="button" data-act="ctl-prev" title="上一首">' +
            SVG.prev(17, 'currentColor') + '</button>' +
          '<button class="nm3-cbtn nm3-cbtn-play" type="button" data-act="ctl-play" ' +
            'id="nm3-ctl-play" title="播放 / 暂停">' + SVG.play(20, INK) + '</button>' +
          '<button class="nm3-cbtn" type="button" data-act="ctl-next" title="下一首">' +
            SVG.next(17, 'currentColor') + '</button>' +
        '</div>' +
        '<div class="nm3-ctl-right">' +
          '<button class="nm3-cbtn" type="button" data-act="ctl-mode" id="nm3-ctl-mode" title="播放模式">' +
            SVG.mode(15, 'currentColor') + '<span id="nm3-ctl-mode-t">随机</span></button>' +
          '<div class="nm3-vol" id="nm3-vol" title="音量">' +
            '<div class="nm3-vol-rail"><div class="nm3-vol-fill" id="nm3-vol-fill"></div></div>' +
            '<div class="nm3-vol-knob" id="nm3-vol-knob"></div>' +
          '</div>' +
          '<button class="nm3-cbtn nm3-cbtn-like" type="button" data-act="ctl-like" ' +
            'id="nm3-ctl-like" title="收藏到「我喜欢的音乐」">' +
            SVG.like(15, 'currentColor') + '</button>' +
          '<button class="nm3-cbtn" type="button" data-act="ctl-list" id="nm3-ctl-list" title="播放列表">' +
            SVG.list(15, 'currentColor') + '<em id="nm3-ctl-count"></em></button>' +
          '<button class="nm3-cbtn" type="button" data-act="dl-current" id="nm3-ctl-dl" ' +
            'title="下载这首（按当前音质，存到音乐文件夹）；Shift + 点击重选文件夹">' +
            SVG.download(15, 'currentColor') + '<span></span></button>' +
          '<button class="nm3-cbtn" type="button" data-act="ctl-share" title="分享" ' +
            'id="nm3-ctl-share">' + SVG.share(15, 'currentColor') + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  /** 播放模式：原生按钮的 title 就是站点自己写的模式名 */
  function nativeModeLabel() {
    const el = nativeCtl('mode');
    const t = el && String(el.title || '').trim();
    if (t) return t;
    const cls = (el && el.className) || '';
    if (/icn-one/.test(cls)) return '单曲循环';
    if (/icn-shuffle/.test(cls)) return '随机';
    if (/icn-loop/.test(cls)) return '循环';
    return '播放模式';
  }

  /** 刷新控制台的状态显示（每 tick 调，尽量少写 DOM） */
  function updateControlsUi() {
    const host = document.getElementById('nm3-ctl');
    if (!host) return;

    // 播放 / 暂停
    const np = nowPlaying();
    const playing = !!(np && np.playing);
    const playBtn = document.getElementById('nm3-ctl-play');
    if (playBtn) {
      const want = playing ? 'pause' : 'play';
      if (playBtn.getAttribute('data-icon') !== want) {
        playBtn.setAttribute('data-icon', want);
        playBtn.innerHTML = playing ? SVG.pause(20, INK) : SVG.play(20, INK);
        playBtn.title = playing ? '暂停' : '播放';
      }
    }

    // 播放模式
    const modeT = document.getElementById('nm3-ctl-mode-t');
    if (modeT) {
      const label = nativeModeLabel();
      if (modeT.textContent !== label) modeT.textContent = label;
    }

    // 队列条数（原生列表按钮的文字就是条数）
    const countEl = document.getElementById('nm3-ctl-count');
    if (countEl) {
      const el = nativeCtl('panel');
      const n = el ? String(el.textContent || '').trim() : '';
      const text = /^\d+$/.test(n) && n !== '0' ? n : '';
      if (countEl.textContent !== text) countEl.textContent = text;
    }
    // 播放列表抽屉开着时，按钮保持点亮
    syncQueuePanelUi();

    // 收藏
    const likeBtn = document.getElementById('nm3-ctl-like');
    if (likeBtn) {
      const liked = isLiked(curTrackId);
      likeBtn.classList.toggle('nm3-on', liked === true);
      const title = liked === true ? '已收藏到「我喜欢的音乐」' : '收藏到「我喜欢的音乐」';
      if (likeBtn.title !== title) likeBtn.title = title;
    }

    // 音量
    const fill = document.getElementById('nm3-vol-fill');
    const knob = document.getElementById('nm3-vol-knob');
    const vol = document.getElementById('nm3-vol');
    if (fill) fill.style.width = pct(volumeRatio());
    if (knob) knob.style.left = pct(volumeRatio());
    if (vol) vol.classList.toggle('nm3-dragging', volDragging);
  }

  /* ═══════════════════════════ 音质 ═══════════════════════════
   * 网页版把音质写死在闭包里 —— core_*.js 里
   *     var DEFAULT_LEVEL = "exhigh";
   *     t0K.bc8G("/api/song/enhance/player/url/v1", {query:{ids:…, level:DEFAULT_LEVEL, …}})
   * 而且 DEFAULT_LEVEL 从不改变；那根音质图标打开的是 m-audioQuality-layer
   * （下载 / 去客户端的提示层），网页版并没有音质切换。
   *
   * 所以这里接管：在站点发出取流请求之前改写 URL 里的 level 参数，
   * 让站点用它自己的代码路径去取对应音质的流 —— 缓冲、切 CDN、续播
   * 全都仍由站点负责，不会和它自己的状态机打架。
   */

  const URL_API = '/api/song/enhance/player/url/v1';
  const QUALITY_KEY = 'nm3-quality';
  const DEFAULT_LEVEL = 'exhigh';

  const LEVELS = [
    { key: 'standard', label: '标准', note: '128kbps' },
    { key: 'higher', label: '较高', note: '192kbps' },
    { key: 'exhigh', label: '极高', note: '320kbps · 网页版默认' },
    { key: 'lossless', label: '无损', note: 'FLAC', vip: true },
    { key: 'hires', label: 'Hi-Res', note: '24bit', vip: true },
    { key: 'jymaster', label: '超清母带', note: 'Master', vip: true }
  ];

  let qualityPref = DEFAULT_LEVEL;    // 用户的选择（持久化）
  let qualityActive = DEFAULT_LEVEL;  // 当前实际请求的等级（可能因不支持而临时降级）
  let qualitySongId = null;

  function qualityLabel(key) {
    const l = LEVELS.find((x) => x.key === key);
    return l ? l.label : key;
  }

  function loadQuality() {
    try {
      const v = localStorage.getItem(QUALITY_KEY);
      if (v && LEVELS.some((l) => l.key === v)) {
        qualityPref = v;
        qualityActive = v;
      }
    } catch (e) { /* noop */ }
  }

  function saveQuality() {
    try { localStorage.setItem(QUALITY_KEY, qualityPref); } catch (e) { /* noop */ }
  }

  /** 带 __nm3probe=1 的是脚本自己的探测请求：只补客户端姿态参数，不动 level */
  function rewriteLevel(url) {
    if (typeof url !== 'string' || url.indexOf(URL_API) < 0) return url;
    if (/[?&]__nm3probe=1/.test(url)) return clientSignQuery(url);
    const withLevel = /[?&]level=/.test(url)
      ? url.replace(/([?&])level=[^&]*/, '$1level=' + encodeURIComponent(qualityActive))
      : url + (url.indexOf('?') >= 0 ? '&' : '?') + 'level=' + encodeURIComponent(qualityActive);
    // ★ 顺手补上 PC 客户端姿态参数（os/appver/channel/osver）：
    //   站点自己那次取流也按客户端口径问，能拿到的档位/资源就和客户端一致
    return clientSignQuery(withLevel);
  }

  /** 必须在站点脚本之前挂钩，否则首曲已经按 exhigh 取过流了 */
  function hookQuality() {
    try {
      const XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
      if (XO && !XO.__nm3Q) {
        const origOpen = XO.open;
        XO.open = function (method, url) {
          let u = url;
          try { u = rewriteLevel(url); } catch (e) { /* noop */ }
          const rest = Array.prototype.slice.call(arguments, 2);
          return origOpen.apply(this, [method, u].concat(rest));
        };
        XO.__nm3Q = true;
      }
      if (window.fetch && !window.fetch.__nm3Q) {
        const origFetch = window.fetch;
        const patched = function (input, init) {
          try {
            if (typeof input === 'string') {
              input = rewriteLevel(input);
            } else if (input && typeof input.url === 'string') {
              const u = rewriteLevel(input.url);
              if (u !== input.url && typeof Request === 'function') input = new Request(u, input);
            }
          } catch (e) { /* noop */ }
          return origFetch.call(this, input, init);
        };
        patched.__nm3Q = true;
        window.fetch = patched;
      }
    } catch (e) {
      warn('音质改写挂钩失败', e);
    }
  }

  /** 某个等级对这首歌是否真的能取到流 */
  async function probeLevel(songId, level) {
    const d = await apiGet(URL_API, {
      ids: JSON.stringify([songId]),
      level: level,
      encodeType: 'aac',
      __nm3probe: 1
    });
    const it = d && d.data && d.data[0];
    return !!(it && it.url);
  }

  /** 把当前这首的流换成指定等级，并保住播放位置与播放状态 */
  async function swapCurrentAudio(songId, level) {
    const a = capturedAudio;
    if (!a) return false;
    try {
      const d = await apiGet(URL_API, {
        ids: JSON.stringify([songId]),
        level: level,
        encodeType: 'aac',
        __nm3probe: 1
      });
      const it = d && d.data && d.data[0];
      if (!it || !it.url) return false;

      const wasPlaying = !a.paused;
      const pos = isFinite(a.currentTime) ? a.currentTime : 0;
      a.src = it.url;
      try { a.load(); } catch (e) { /* noop */ }
      const restore = () => {
        try { a.currentTime = pos; } catch (e) { /* noop */ }
        a.removeEventListener('loadedmetadata', restore);
      };
      a.addEventListener('loadedmetadata', restore);
      if (wasPlaying) {
        const pr = a.play();
        if (pr && typeof pr.catch === 'function') pr.catch(() => { /* 用户手势限制，忽略 */ });
      }
      return true;
    } catch (e) {
      warn('切换音质失败', e);
      return false;
    }
  }

  function qualityMenuHtml() {
    return LEVELS.map((l) =>
      '<a data-act="quality-set" data-level="' + l.key + '"' +
      (l.key === qualityActive ? ' class="nm3-on"' : '') + '>' +
        '<span class="nm3-q-name">' + esc(l.label) +
          (l.vip ? '<i class="nm3-q-vip">VIP</i>' : '') + '</span>' +
        '<span class="nm3-q-note">' + esc(l.note) + '</span>' +
        (l.key === qualityActive
          ? '<span class="nm3-q-tick">' + SVG.check(13, 'currentColor') + '</span>'
          : '') +
      '</a>'
    ).join('');
  }

  function refreshQualityUi() {
    const label = document.getElementById('nm3-q-label');
    if (label) label.textContent = qualityLabel(qualityActive);
    const menu = document.getElementById('nm3-q-menu');
    if (menu) menu.innerHTML = qualityMenuHtml();
  }

  function toggleQualityMenu(force) {
    const wrap = document.getElementById('nm3-q-wrap');
    if (!wrap) return;
    const open = force != null ? !!force : !wrap.classList.contains('nm3-open');
    wrap.classList.toggle('nm3-open', open);
    if (open) refreshQualityUi();
  }

  async function setQuality(level) {
    if (!LEVELS.some((l) => l.key === level)) return;
    if (level === qualityPref) return;

    const songId = curTrackId;
    const prevPref = qualityPref;
    const prevActive = qualityActive;

    // 1) 有在播的歌，先探测这首歌到底有没有该音质（拿不到就别切，免得把播放搞坏）
    if (songId && level !== DEFAULT_LEVEL) {
      let ok = false;
      try { ok = await probeLevel(songId, level); } catch (e) { ok = false; }
      if (!ok) {
        toast('这首没有「' + qualityLabel(level) + '」（可能需要黑胶 VIP）', 2800);
        return;
      }
    }

    // 2) 立刻把当前这首的流换过去；换不成就整体回滚
    qualityPref = level;
    qualityActive = level;
    if (songId) {
      const swapped = await swapCurrentAudio(songId, level);
      if (!swapped) {
        qualityPref = prevPref;
        qualityActive = prevActive;
        refreshQualityUi();
        toast('切到「' + qualityLabel(level) + '」失败，保持「' +
          qualityLabel(prevActive) + '」', 2800);
        return;
      }
      qualitySongId = songId;
    }

    // 3) 成功：持久化，后续歌曲也会走这个档位（靠 XHR 改写）
    saveQuality();
    refreshQualityUi();
    toast('音质已切换为「' + qualityLabel(level) + '」');
  }

  /**
   * 音质保险丝：万一某个档位取不到流（会员过期、单曲没有该音质），
   * 音频元素会报 error；这时把档位降回默认，站点自己的重试逻辑下一次
   * 请求就会带上 exhigh，从而自愈。不这么做会卡在"有歌但放不出来"。
   */
  function ensureAudioWatch() {
    const a = capturedAudio;
    if (!a || a.__nm3Watch) return;
    a.__nm3Watch = true;
    a.addEventListener('error', () => {
      if (qualityActive === DEFAULT_LEVEL) return;
      const from = qualityActive;
      qualityActive = DEFAULT_LEVEL;
      refreshQualityUi();
      toast('「' + qualityLabel(from) + '」放不出来，已回到「' +
        qualityLabel(DEFAULT_LEVEL) + '」', 3000);
    });
  }

  /** 换歌时同步一次音质：这首要是不支持就临时降级，并把当前这首救回来 */
  async function syncQualityForSong(songId) {
    if (qualitySongId === songId) return;
    qualitySongId = songId;

    if (qualityPref === DEFAULT_LEVEL) {
      qualityActive = DEFAULT_LEVEL;
      refreshQualityUi();
      return;
    }
    qualityActive = qualityPref;
    refreshQualityUi();

    let ok = true;
    try { ok = await probeLevel(songId, qualityPref); } catch (e) { ok = true; }
    if (ok || qualitySongId !== songId) return;

    qualityActive = DEFAULT_LEVEL;
    refreshQualityUi();
    toast('这首没有「' + qualityLabel(qualityPref) + '」，已按极高播放', 2800);
    swapCurrentAudio(songId, DEFAULT_LEVEL);
  }

  /* ════════════ 客户端姿态取流（模拟 PC 客户端）+ 下载 ════════════
   *
   * 网页版对一部分内容会「不给播」：网页播放器自己判定不可播、或站点只把资源
   * 放给客户端。而取流接口是按请求方的姿态 + 账号权限判定的，桌面客户端问的
   * 时候带的是 os=pc / appver / channel 这一套参数。所以脚本也照客户端那么问：
   *
   *   1. 站点自己发出的取流请求：hookQuality 里除了改写 level，再补上这套参数；
   *   2. 脚本自己发起的取流请求（音质探测 / 切档 / 下载 / 救场）同样带上；
   *   3. cookie 里补一个 os=pc（和真实 PC 端一致，接口模块读它）；
   *   4. 站点不播、但接口给了流的时候，脚本把流直接交给 <audio> 播出来
   *      （rescuePlayback）—— 这就是「客户端能听、网页不给听」那类的落地办法。
   *
   * 说清楚边界：**这不是绕付费**。账号没有的权限（VIP / 数字专辑）接口照样回
   * url=null，脚本只会如实提示；它解决的是「同一账号、客户端能放而网页播放器
   * 不放」这一类。
   */
  const CLIENT_SIGN = { os: 'pc', appver: '8.9.70', channel: 'netease', osver: '10.0.19045' };

  function clientSignQuery(url) {
    let out = url;
    Object.keys(CLIENT_SIGN).forEach((k) => {
      if (new RegExp('[?&]' + k + '=').test(out)) return;
      out += (out.indexOf('?') >= 0 ? '&' : '?') + k + '=' + encodeURIComponent(CLIENT_SIGN[k]);
    });
    return out;
  }

  /** cookie 里补 os=pc 等（只补不覆盖），让接口按 PC 客户端姿态看这次会话 */
  function markClientCookie() {
    try {
      Object.keys(CLIENT_SIGN).forEach((k) => {
        if (new RegExp('(?:^|;\\s*)' + k + '=').test(document.cookie || '')) return;
        document.cookie = k + '=' + encodeURIComponent(CLIENT_SIGN[k]) + '; path=/; domain=.music.163.com';
      });
    } catch (e) { /* noop */ }
  }

  /** 带客户端姿态取一次流；拿不到地址返回 null */
  async function fetchPlayUrl(songId, level) {
    const flac = level === 'lossless' || level === 'hires' || level === 'jymaster';
    const d = await apiGet(URL_API, Object.assign({
      ids: JSON.stringify([songId]),
      level: level,
      encodeType: flac ? 'flac' : 'aac',
      __nm3probe: 1
    }, CLIENT_SIGN));
    const it = d && d.data && d.data[0];
    return (it && it.url) ? it : null;
  }

  /** 从想要的档位往下退，直到取到一个真的能播的地址 */
  async function resolveStream(songId, preferLevel) {
    const want = preferLevel || qualityPref || DEFAULT_LEVEL;
    const idx = LEVELS.findIndex((l) => l.key === want);
    const order = LEVELS.slice(0, (idx < 0 ? LEVELS.length : idx + 1)).map((l) => l.key).reverse();
    [DEFAULT_LEVEL, 'standard'].forEach((k) => { if (order.indexOf(k) < 0) order.push(k); });

    for (const lv of order) {
      try {
        const it = await fetchPlayUrl(songId, lv);
        if (it && it.url) return { level: lv, item: it, url: it.url };
      } catch (e) { /* 这一档不行就退下一档 */ }
    }
    return null;
  }

  /* ── 救场：站点不播但接口有流 ── */

  let curTrackSince = 0;
  let rescuedTrackId = null;

  async function rescuePlayback(track) {
    const a = audioEl();
    if (!a || !track || !track.id) return;
    if (rescuedTrackId === track.id) return;
    rescuedTrackId = track.id;

    const got = await resolveStream(track.id, qualityPref);
    if (!got) return;                       // 没权限就是没权限，不打扰用户
    if (String(curTrackId) !== String(track.id)) return;   // 取流期间换歌了

    try {
      a.src = got.url;
      try { a.load(); } catch (e) { /* noop */ }
      const pr = a.play();
      if (pr && typeof pr.catch === 'function') pr.catch(() => { /* 等用户按一下播放 */ });
      toast('网页播放器不给这首，已按「' + qualityLabel(got.level) + '」直接取流播放', 3000);
    } catch (e) {
      warn('客户端姿态取流播放失败', e);
    }
  }

  function maybeRescue() {
    const a = audioEl();
    if (!a || !curTrackId) return;
    if (Date.now() - curTrackSince < 2200) return;      // 给站点正常的加载时间
    if (a.currentTime > 0.5 || (!a.paused && a.src)) return;   // 已经在放了
    if (a.src && a.readyState >= 2) return;             // 有流且元数据就绪
    const np = nowPlaying();
    if (!np || !np.track) return;
    rescuePlayback(np.track);
  }

  /* ── 下载 ── */

  const downloadState = { busy: false, pct: 0 };

  /**
   * ★ 下载位置：系统「音乐」文件夹。
   *
   *   网页没有「直接往某个磁盘路径写文件」的能力 —— `<a download>` 只能落进
   *   浏览器自己设置的默认下载目录，脚本改不了它。唯一能改的是
   *   File System Access API（Chrome / Edge 有）：`showDirectoryPicker` 的
   *   `startIn: 'music'` 会把选择框**直接开在系统「音乐」文件夹**，用户确认
   *   一次后把目录句柄存进 IndexedDB —— 之后每次下载都直接写进那个文件夹，
   *   不再弹框（权限过期时借着点击的用户手势 requestPermission 续期）。
   *   Shift + 点击下载按钮可以重新选一次。
   *
   *   拿不到句柄（Firefox / Safari 没这个 API，或用户取消了选择框）时，
   *   原样退回浏览器默认下载目录的 `<a download>`，不打断下载。
   */
  const DL_DB = 'nm3-download';
  const DL_STORE = 'handle';
  const DL_KEY = 'musicDir';
  const DL_DEFAULT_KEY = 'nm3-dl-use-default-dir';  // 用户明确要默认目录（取消过选择框）

  const hasFsApi = () => typeof window.showDirectoryPicker === 'function';

  /* IndexedDB：只用来记住那个目录句柄（FileSystemDirectoryHandle 可以结构化克隆） */
  function idbOpen() {
    return new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DL_DB, 1); } catch (e) { rej(e); return; }
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(DL_STORE)) req.result.createObjectStore(DL_STORE);
        } catch (e) { /* noop */ }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('indexedDB 打不开'));
    });
  }

  function idbRun(mode, fn) {
    return idbOpen().then((db) => new Promise((res, rej) => {
      let req;
      const tx = db.transaction(DL_STORE, mode);
      try { req = fn(tx.objectStore(DL_STORE)); } catch (e) { rej(e); return; }
      tx.oncomplete = () => {
        try { db.close(); } catch (e) { /* noop */ }
        res(req ? req.result : undefined);
      };
      tx.onerror = () => rej(tx.error || new Error('indexedDB 读写失败'));
      tx.onabort = () => rej(tx.error || new Error('indexedDB 事务中断'));
    }));
  }

  const dirStore = {
    get: () => idbRun('readonly', (s) => s.get(DL_KEY)).catch(() => null),
    put: (h) => idbRun('readwrite', (s) => s.put(h, DL_KEY)).catch(() => null),
    clear: () => idbRun('readwrite', (s) => s.delete(DL_KEY)).catch(() => null)
  };

  /** 句柄还在不在、还有没有写权限（ask=true 时借当前用户手势续期） */
  async function dirGranted(handle, ask) {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    const opt = { mode: 'readwrite' };
    try {
      if ((await handle.queryPermission(opt)) === 'granted') return true;
      if (ask && (await handle.requestPermission(opt)) === 'granted') return true;
    } catch (e) { /* noop */ }
    return false;
  }

  /** CONFIG.DOWNLOAD_SUBDIR 有值就再往下建一层（没有就在音乐文件夹根上） */
  async function subdirOf(dir) {
    const sub = String(CONFIG.DOWNLOAD_SUBDIR || '').trim();
    if (!sub) return dir;
    try { return await dir.getDirectoryHandle(fileSafe(sub), { create: true }); }
    catch (e) { return dir; }
  }

  /**
   * 取这次下载要用的目录句柄。
   * ★ 必须赶在取流之前调用：选择框和授权续期都要「用户手势」，等 await 完
   *   网络请求再弹，浏览器会当没有手势直接拒绝（NotAllowedError）。
   */
  async function ensureDownloadDir(forcePick) {
    if (!hasFsApi()) return null;   // Firefox / Safari：照旧走默认下载目录
    if (!forcePick) {
      let useDefault = false;
      try { useDefault = localStorage.getItem(DL_DEFAULT_KEY) === '1'; } catch (e) { /* noop */ }
      if (useDefault) return null;  // 上次明确取消了，别再弹
      const saved = await dirStore.get();
      if (saved) {
        if (await dirGranted(saved, true)) return subdirOf(saved);
        await dirStore.clear();     // 句柄失效（文件夹被删/改名/换机器）——下次重选
      }
    }

    let picked = null;
    try {
      picked = await window.showDirectoryPicker({ id: 'nm3-music', mode: 'readwrite', startIn: 'music' });
    } catch (e) {
      // AbortError：用户点了取消；NotAllowedError / SecurityError：这个环境不允许弹框
      // （没手势、页面没聚焦、跨源 iframe）。两种都当「这次就用默认下载目录」。
      picked = null;
    }
    if (!picked) {
      try { localStorage.setItem(DL_DEFAULT_KEY, '1'); } catch (e) { /* noop */ }
      toast('未指定音乐文件夹，本次存到浏览器默认下载目录（Shift + 点击下载按钮可重选）', 4200);
      return null;
    }
    try { localStorage.removeItem(DL_DEFAULT_KEY); } catch (e) { /* noop */ }
    await dirStore.put(picked);
    const dir = await subdirOf(picked);
    toast('下载位置已记住：' + dir.name + '（Shift + 点击下载按钮可重选）', 3800);
    return dir;
  }

  /** 同名文件不覆盖，改成「歌名 (2).mp3」——和浏览器自己下载的行为对齐 */
  async function freeName(dir, filename) {
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
    let name = filename;
    for (let i = 2; i <= 99; i++) {
      let exists = false;
      try { await dir.getFileHandle(name); exists = true; }
      catch (e) { if (e && e.name && e.name !== 'NotFoundError') throw e; }
      if (!exists) return name;
      name = base + ' (' + i + ')' + ext;
    }
    return filename;
  }

  /**
   * 写进那个文件夹，返回真正写下的文件名；写坏就删掉半截文件再抛错。
   * overwrite=true 时同名直接覆盖 —— 附带的 .lrc 用这个：本地播放器是靠
   * **同名**去配歌词的，叫「歌 (2).lrc」就配不上了。
   */
  async function writeToDir(dir, filename, blob, overwrite) {
    const name = overwrite ? filename : await freeName(dir, filename);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch (e2) { /* noop */ }
      try { await dir.removeEntry(name); } catch (e2) { /* noop */ }
      throw e;
    }
    return name;
  }

  /**
   * 把这首歌的歌词写成音频旁边的同名 .lrc（带时间轴的双语文件）。
   * 文件名跟**实际存下来的音频名**对齐（音频可能被改名成「… (2).mp3」），
   * 而且同名直接覆盖 —— 播放器靠同名配对，改成 (2).lrc 就配不上了。
   * 返回写下的文件名；没有歌词就返回空串（不算失败）。
   */
  async function writeLyricSidecar(dir, audioName, info) {
    const text = await lyricTextFor(info);
    if (!text) return '';
    const lrc = String(audioName).replace(/\.[^./\\]+$/, '') + '.lrc';
    // 带 BOM 的 UTF-8：国内不少本地播放器靠 BOM 才认 UTF-8，不然中文歌词会乱码
    await writeToDir(dir, lrc, new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' }), true);
    return lrc;
  }

  function extFromUrl(url, level) {
    const clean = String(url || '').split('?')[0];
    const m = /\.(mp3|m4a|flac|ape|wav|aac|ogg)$/i.exec(clean);
    if (m) return m[1].toLowerCase();
    return (level === 'lossless' || level === 'hires' || level === 'jymaster') ? 'flac' : 'm4a';
  }

  function fileSafe(s) {
    return String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '未命名';
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } a.remove(); }, 5000);
  }

  /**
   * 边下边读并报进度。
   * ★ 必须带超时：CDN 偶尔会「连着但不给数据」（实测在同时播放同一首歌时更容易
   *   出现），没有超时就会永远卡在进度上——所以既给整次下载设总超时，也给
   *   「两块数据之间」设停滞超时，超了就抛错走兜底（新标签页打开）。
   */
  function readStreamWithProgress(res, total, onPct) {
    const reader = res.body.getReader();
    const chunks = [];
    let have = 0;
    const readChunk = () => {
      let timer = null;
      const stall = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('下载停滞（15 秒没有新数据）')), 15000);
      });
      return Promise.race([reader.read(), stall]).finally(() => clearTimeout(timer));
    };
    const pump = () => readChunk().then((r) => {
      if (r.done) return chunks;
      chunks.push(r.value);
      have += r.value.length;
      if (total > 0) onPct(Math.min(99, Math.round((have / total) * 100)));
      return pump();
    });
    return pump();
  }

  function setDownloadUi(state) {
    const btn = document.getElementById('nm3-ctl-dl');
    if (!btn) return;
    const label = btn.querySelector('span');
    btn.classList.toggle('nm3-on', !!state);
    btn.classList.toggle('nm3-busy', !!state);
    if (label) label.textContent = state ? (state.pct > 0 ? state.pct + '%' : '…') : '';
  }

  async function downloadCurrent(level, opts) {
    const np = nowPlaying();
    const track = np && np.track;
    if (!track) { toast('还没有正在播放的歌曲'); return; }
    if (downloadState.busy) { toast('上一首还在下载中'); return; }

    const info = trackInfo(track);
    const wantLevel = level || qualityPref || DEFAULT_LEVEL;
    downloadState.busy = true;
    downloadState.pct = 0;
    setDownloadUi({ pct: 0 });

    let got = null;
    let dir = null;
    let hardTimer = null;
    const abort = ('AbortController' in window) ? new AbortController() : null;
    try {
      // ★ 目录必须在取流之前要：选择框 / 授权续期都要用户手势，等 await 完
      //   网络请求再弹会被浏览器当「没有手势」拒掉；拿不到就退回默认下载目录。
      try { dir = await ensureDownloadDir(!!(opts && opts.pickDir)); }
      catch (e) { warn('选择下载目录失败，改存浏览器默认下载目录', e); dir = null; }

      toast('开始下载：' + info.name + '（' + qualityLabel(wantLevel) + '）', 2000);

      // 整次下载的总超时（10 分钟）：网络卡死时别把按钮永远挂在「下载中」
      hardTimer = setTimeout(() => { if (abort) abort.abort(); }, 600000);

      got = await resolveStream(info.id, wantLevel);
      if (!got) {
        toast('这首取不到音频地址：多半需要 VIP / 客户端授权（账号有权限才行）', 3400);
        return;
      }
      const name = fileSafe(info.name) + ' - ' + fileSafe(info.artists) +
        ' [' + qualityLabel(got.level) + '].' + extFromUrl(got.url, got.level);

      const res = await fetch(got.url, { credentials: 'omit', signal: abort.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = Number(res.headers.get('content-length')) || Number(got.item.size) || 0;
      let blob;

      if (res.body && typeof res.body.getReader === 'function' && total > 0) {
        const chunks = await readStreamWithProgress(res, total, (pct) => {
          if (pct !== downloadState.pct) {
            downloadState.pct = pct;
            setDownloadUi({ pct: pct });
          }
        });
        blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
      } else {
        blob = await res.blob();
      }

      // 存盘：优先写进记住的「音乐」文件夹；写不进去（句柄失效 / 权限被撤）
      // 就把这份 blob 交给 <a download>，不让用户白下一趟。
      if (dir) {
        try {
          const saved = await writeToDir(dir, name, blob);
          // 附带歌词：音频旁边再写一份同名的双语 .lrc（本地播放器会自动加载它，
          // 靠同一时间戳两行 = 原文 + 翻译来同步显示）。写歌词失败不影响音频。
          if (CONFIG.DOWNLOAD_LRC) {
            try {
              const lrc = await writeLyricSidecar(dir, saved, info);
              toast('已下载到「' + dir.name + '」：' + saved + (lrc ? ' + ' + lrc : '') +
                '（' + (blob.size / 1048576).toFixed(1) + ' MB）', 4000);
              return;
            } catch (e) {
              warn('附带歌词写失败（音频已经存好了）', e);
            }
          }
          toast('已下载到「' + dir.name + '」：' + saved +
            '（' + (blob.size / 1048576).toFixed(1) + ' MB）', 3600);
          return;
        } catch (e) {
          warn('写入音乐文件夹失败，改存浏览器默认下载目录', e);
          await dirStore.clear();
          toast('写入「' + dir.name + '」失败，已改存到浏览器默认下载目录', 3800);
        }
      }
      saveBlob(blob, name);
      toast('已下载：' + name + '（' + (blob.size / 1048576).toFixed(1) + ' MB）', 3200);
    } catch (e) {
      warn('下载失败', e);
      if (got && got.url) {
        // 跨域 / 流式读取失败时，退回让浏览器自己打开（右键另存为）
        try { window.open(got.url, '_blank'); } catch (e2) { /* noop */ }
        toast('直接下载失败，已在新标签页打开音频地址，可右键另存为', 3600);
      } else {
        toast('下载失败：' + ((e && e.message) || '网络异常'), 3000);
      }
    } finally {
      if (hardTimer) clearTimeout(hardTimer);
      downloadState.busy = false;
      downloadState.pct = 0;
      setDownloadUi(null);
    }
  }

  function toggleDownloadMenu() {
    // 客户端姿态的下载入口只有一个按钮：按下即按当前音质档位下载；
    // Shift + 点击 = 重新挑一次音乐文件夹（默认路线不用换）
    downloadCurrent();
  }

  /**
   * 把「站点队列里的对象」和「/api/song/detail 的完整对象」合起来用。
   * 站点队列里的曲目可能只有 name/id/duration（实测遇到过：专辑显示"未知专辑"、
   * 封面空白），所以缺什么就用接口结果补什么。
   */
  function trackInfo(t) {
    const meta = (trackMeta && String(trackMeta.id) === String(t.id)) ? trackMeta : null;
    const pick = (a, b) => (a == null || a === '' ? b : a);

    const al = albumOf(t);
    const mal = meta ? albumOf(meta) : { id: '', name: '', picUrl: '' };
    const dur = pick(pick(t.duration, t.dt), meta ? pick(meta.duration, meta.dt) : 0) || 0;

    // 专辑 / 歌手的 id：站点各处给的字段名不统一（ar/al 与 artists/album），
    // 队列里的歌常常只有名字没 id（甚至是 0），这时候用 /api/song/detail 补回来的那份。
    const alId = pick(al.id, mal.id);
    const richOf = (s) => (s && artistNameList(s).some((a) => a.id) && albumOf(s).id) ? s : null;
    const rich = richOf(t) || richOf(meta) || meta || t;

    return {
      id: t.id,
      name: pick(t.name, meta && meta.name) || '未知歌曲',
      artists: pick(artistsOf(t), meta ? artistsOf(meta) : '') || '未知歌手',
      album: pick(al.name, mal.name) || '未知专辑',
      picUrl: pick(al.picUrl, mal.picUrl) || '',
      albumId: alId,
      rich: rich,          // 带 id 的那份歌曲对象，给专辑 / 歌手链接用
      duration: dur
    };
  }

  /** 拉一次完整歌曲信息，用来补封面/专辑/时长 */
  async function loadTrackMeta(songId) {
    trackMetaFor = songId;
    trackMeta = null;
    try {
      const songs = await songDetail([songId]);
      const s = songs[0];
      if (!s || String(s.id) !== String(songId)) return;
      if (String(curTrackId) !== String(songId)) return;   // 已经换歌了
      trackMeta = s;
      // 重绘一次：补封面、专辑名，以及「队列对象里没有 / 为 0 的歌手、专辑 id」——
      // 少了它，歌手和专辑就一直是不可点的纯文本（详见 renderNowPlaying 里的
      // data-meta 判断）。
      renderNowPlaying(true);
    } catch (e) {
      warn('歌曲详情补齐失败', e);
    }
  }

  /**
   * 歌曲详情（批量）。
   *
   * ★ /api/song/detail 在新版返回的是「精简版」：
   *     {name,id,position,alias,status,fee,copyrightId,disc,no,artist,…}
   *   —— 里面**没有 ar / al**，于是封面、专辑、歌手 id 全拿不到（专辑也就没法
   *   做成可点的链接，歌单补齐的曲目还会显示成「未知专辑 / 未知歌手」）。
   *   实测 /api/v3/song/detail?c=[{"id":…}] 与 /api/v1/song/detail?ids=[…]
   *   返回的是带 ar/al 的完整结构，所以按 v3 → v1 → 老接口 依次降级。
   */
  async function songDetail(ids) {
    const arr = (Array.isArray(ids) ? ids : [ids])
      .map((x) => Number(x))
      .filter((x) => x > 0);
    if (!arr.length) return [];

    const tries = [
      ['/api/v3/song/detail', { c: JSON.stringify(arr.map((id) => ({ id: id }))) }],
      ['/api/v1/song/detail', { ids: JSON.stringify(arr) }],
      ['/api/song/detail', { ids: JSON.stringify(arr) }]
    ];
    let lastErr = null;
    for (const [path, params] of tries) {
      try {
        const d = await apiGet(path, params);
        const songs = (d && d.songs) || [];
        if (songs.length) return songs;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }

  /** 封面：歌曲元数据 → 播放条上站点渲染好的那张 */
  function currentCoverUrl(track, info) {
    const url = (info && info.picUrl) || albumOf(track).picUrl;
    if (url) return url;
    try {
      const img = document.querySelector('#g_player .head img');
      const src = img && (img.getAttribute('src') || img.src);
      if (src && !/default_album/.test(src)) return src;
    } catch (e) { /* noop */ }
    return '';
  }

  /* ═══════════════════════════ 听歌页 ═══════════════════════════ */

  function renderNowPlaying(force) {
    const host = document.getElementById('nm3-np-host');
    if (!host) return;

    if (!getPlayer()) {
      host.innerHTML = stateBlock('播放器还在加载', '若长时间没有反应，刷新页面即可。');
      return;
    }

    const np = nowPlaying();
    if (!np || !np.track) {
      host.innerHTML = stateBlock(
        '还没有正在播放的歌曲',
        '去「我的音乐」挑一张歌单，或在右上角搜一首歌。'
      );
      return;
    }

    const t = np.track;
    const info = trackInfo(t);
    const playing = !!np.playing;
    const coverUrl = pic(currentCoverUrl(t, info), 500);

    const bg = document.getElementById('nm3-np-bg');
    if (bg) bg.style.backgroundImage = coverUrl ? 'url(' + JSON.stringify(coverUrl) + ')' : 'none';

    // 同曲通常只更新状态，不重绘（否则歌词滚动位置会丢）。
    // 例外有两个，都跟 /api/song/detail 的「补齐」有关：
    //   · 刚拿到封面（补上那张空白图）
    //   · 刚拿到完整元数据（队列对象里歌手/专辑 id 常常是缺失或 0，补齐后才
    //     能变成可点的链接）—— 少了这条判断，整首歌都停在不可点的纯文本上。
    const same = host.getAttribute('data-song') === String(info.id);
    const hadCover = host.getAttribute('data-cover') === '1';
    const hasMeta = !!(trackMeta && String(trackMeta.id) === String(info.id));
    const hadMeta = host.getAttribute('data-meta') === '1';
    if (same && hadMeta === hasMeta && !(force && coverUrl && !hadCover)) {
      const flag = host.querySelector('.nm3-flag');
      if (flag) flag.innerHTML = '<i></i>' + (playing ? '正在播放' : '已暂停');
      const em = host.querySelector('.nm3-seg a[data-pane="comment"] em');
      if (em && cmTotal) em.textContent = fmtCount(cmTotal);
      updateSeekBar();
      updateControlsUi();
      return;
    }

    host.setAttribute('data-song', String(info.id));
    host.setAttribute('data-cover', coverUrl ? '1' : '0');
    host.setAttribute('data-meta', hasMeta ? '1' : '0');
    host.innerHTML =
      '<div class="nm3-np">' +
        '<div class="nm3-np-left">' +
          '<div class="nm3-cover">' +
            (coverUrl ? '<img src="' + esc(coverUrl) + '" alt="">' : '') +
          '</div>' +
          '<div class="nm3-title">' + esc(info.name) + '</div>' +
          // 歌手名 / 专辑名都可点：分别进歌手详情、专辑详情（都借「搜索」视图展示）
          '<div class="nm3-sub">' + artistLinksHtml(info.rich) + '</div>' +
          '<div class="nm3-meta">' +
            (info.albumId
              ? '<a class="nm3-chip nm3-chip-link" data-act="album" data-id="' + esc(info.albumId) +
                '" title="查看专辑：' + esc(info.album) + '">' + esc(info.album) + '</a>'
              : '<span class="nm3-chip">' + esc(info.album) + '</span>') +
            '<span class="nm3-chip">' + fmtDuration(info.duration) + '</span>' +
            '<span class="nm3-flag"><i></i>' + (playing ? '正在播放' : '已暂停') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="nm3-np-right">' +
          // 进度条：全站唯一一根，就在歌词上方（底部那根原装的已藏掉）
          '<div class="nm3-seek" id="nm3-seek">' +
            '<span class="nm3-seek-time nm3-seek-cur">00:00</span>' +
            seekTrackHtml() +
            '<span class="nm3-seek-time nm3-seek-dur">--:--</span>' +
          '</div>' +
          // 播放控制台：原底部播放条的功能都在这儿（动作转发给隐藏的原生控件）
          controlsHtml() +
          '<div class="nm3-bar-row">' +
            '<div class="nm3-seg" id="nm3-seg">' +
              '<a data-act="pane" data-pane="lyric"' + (listenPane === 'lyric' ? ' class="nm3-on"' : '') +
                '>歌词</a>' +
              '<a data-act="pane" data-pane="comment"' + (listenPane === 'comment' ? ' class="nm3-on"' : '') +
                '>评论' + (cmTotal ? ' <em>' + fmtCount(cmTotal) + '</em>' : '') + '</a>' +
            '</div>' +
            '<div class="nm3-q-wrap" id="nm3-q-wrap">' +
              '<button class="nm3-q-btn" type="button" data-act="quality-menu">' +
                SVG.wave(13, 'currentColor') + '<span id="nm3-q-label">' +
                esc(qualityLabel(qualityActive)) + '</span>' +
              '</button>' +
              '<div class="nm3-q-menu" id="nm3-q-menu">' + qualityMenuHtml() + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="nm3-pane-wrap">' +
            '<div class="nm3-pane nm3-lyric' + (listenPane === 'lyric' ? '' : ' nm3-hide') +
              '" id="nm3-lyric"></div>' +
            '<div class="nm3-pane nm3-cm' + (listenPane === 'comment' ? '' : ' nm3-hide') +
              '" id="nm3-comment"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    renderLyric();
    renderComments();
    updateSeekBar();
    updateControlsUi();
    if (listenPane === 'comment') ensureComments(info.id);
  }

  function setListenPane(pane) {
    if (pane !== 'lyric' && pane !== 'comment') return;
    listenPane = pane;

    const seg = document.getElementById('nm3-seg');
    if (seg) {
      seg.querySelectorAll('a').forEach((a) => {
        a.classList.toggle('nm3-on', a.getAttribute('data-pane') === pane);
      });
    }
    const ly = document.getElementById('nm3-lyric');
    const cm = document.getElementById('nm3-comment');
    if (ly) ly.classList.toggle('nm3-hide', pane !== 'lyric');
    if (cm) cm.classList.toggle('nm3-hide', pane !== 'comment');
    if (pane === 'comment' && curTrackId) ensureComments(curTrackId);
  }

  /* ─────────────── 歌词（时间轴 + 翻译 + 罗马音 + 逐字） ───────────────
   *
   * 数据来自 /api/song/lyric/v1（拿不到就退回 /api/song/lyric）：
   *   lrc      主歌词，标准 LRC 时间轴 [mm:ss.xxx]
   *   tlyric   翻译，时间戳和主歌词一一对应
   *   romalrc  罗马音（日语歌多半有）
   *   yrc      逐字时间轴：[行起始ms,行时长ms](字起始ms,?,?)字 …（只有带 yv=-1 才返回）
   * 无歌词时接口**仍然是 code 200**，要靠 lrc.lyric 为空 / uncollected / sgc 判断，
   * 所以这里不用「有没有 code」当判据。
   */

  /** 解析 LRC：多时间戳、[offset:] 都认；返回按时间排好的行 */
  function parseLrc(text) {
    const out = [];
    let offset = 0;
    if (!text) return { lines: out, offset: offset };
    String(text).split('\n').forEach((raw) => {
      const off = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
      if (off) offset = parseInt(off[1], 10) || 0;
      const stamps = [];
      const re = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
      let m;
      while ((m = re.exec(raw)) !== null) {
        stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
      }
      const content = raw.replace(/\[[^\]]*\]/g, '').trim();
      if (!content || !stamps.length) return;   // [ti:] [ar:] [by:] 这类元数据行自然被丢掉
      stamps.forEach((t) => out.push({ t: t, text: content }));
    });
    // [offset:+500]：整体提前 0.5 秒（LRC 通行约定，正数=歌词来得更早）
    if (offset) out.forEach((l) => { l.t = Math.max(0, l.t - offset / 1000); });
    return { lines: out.sort((a, b) => a.t - b.t), offset: offset };
  }

  /** 逐字歌词（yrc）：只取每个字的**起始**时间，结束时间交给下一个字，避开单位争议 */
  function parseYrc(text) {
    const out = [];
    if (!text) return out;
    String(text).split('\n').forEach((raw) => {
      const head = /^\[(\d+),(\d+)\]/.exec(raw);
      if (!head) return;                        // JSON 元数据行（作词/作曲）直接跳过
      const chars = [];
      const re = /\((\d+),(\d+),(\d+)\)([^()]*)/g;
      let m;
      while ((m = re.exec(raw.slice(head[0].length))) !== null) {
        if (m[4]) chars.push({ t: parseInt(m[1], 10) / 1000, text: m[4] });
      }
      if (chars.length) {
        out.push({ t: parseInt(head[1], 10) / 1000, chars: chars, text: chars.map((c) => c.text).join('') });
      }
    });
    return out;
  }

  /**
   * 把翻译 / 罗马音挂到主歌词上（直接记在主行对象的 _subs 里）。
   * 时间戳一一对应（网易的翻译就是这样）就按顺序对齐；行数对不上（第三方上传的
   * 歌词常有半秒偏差）就退化成「找最近的一行」（±1 秒以内），对不上的直接丢掉。
   */
  function attachSubs(base, subs, kind) {
    const lines = (subs || []).filter((l) => l && l.text);
    if (!base.length || !lines.length) return;
    const put = (i, text) => {
      const l = base[i];
      if (!l) return;
      if (!l._subs) l._subs = [];
      l._subs.push({ kind: kind, text: text });
    };
    if (lines.length === base.length) {
      lines.forEach((s, i) => put(i, s.text));
      return;
    }
    let j = 0;
    base.forEach((l, i) => {
      let best = null;
      while (j < lines.length && lines[j].t < l.t - 1.0) j++;      // 追上来
      for (let k = j; k < lines.length && lines[k].t <= l.t + 1.0; k++) {
        if (!best || Math.abs(lines[k].t - l.t) < Math.abs(best.t - l.t)) best = lines[k];
      }
      if (best) put(i, best.text);
    });
  }

  /** 合并主歌词 / 翻译 / 罗马音 / 逐字 → 拍平的行数组（sub=true 的是翻译 / 罗马音） */
  function mergeLyric(mainText, transText, romaText, yrcText) {
    const base = parseLrc(mainText).lines;
    if (!base.length) return [];

    // 逐字：按行起始时间贴到主行上（对不上就按顺序贴，yrc 的行数和 lrc 一般一致）
    const yrc = parseYrc(yrcText);
    const byTime = {};
    yrc.forEach((y) => { byTime[Math.round(y.t * 100)] = y; });

    attachSubs(base, parseLrc(transText).lines, 'trans');
    attachSubs(base, parseLrc(romaText).lines, 'roma');

    const out = [];
    let yi = 0;
    base.forEach((l) => {
      const hit = byTime[Math.round(l.t * 100)] ||
        (yrc.length === base.length ? yrc[yi] : null);
      yi++;
      out.push({
        t: l.t, text: l.text, sub: false,
        chars: (hit && hit.chars) ? hit.chars : null
      });
      (l._subs || []).forEach((s) => {
        out.push({ t: l.t + 0.001, text: s.text, sub: true, kind: s.kind });
      });
    });
    return out;
  }

  function lyricLineHtml(l, i, isSub) {
    const cls = 'nm3-lyric-line' + (isSub ? (l.kind === 'roma' ? ' nm3-roma' : ' nm3-trans') : '');
    const inner = (l.chars && l.chars.length)
      ? l.chars.map((c) => '<span class="nm3-ch" data-ct="' + c.t + '">' + esc(c.text) + '</span>').join('')
      : esc(l.text);
    return '<div class="' + cls + '" data-i="' + i + '" data-act="seek" data-sec="' + l.t +
      '" data-t="' + fmtClock(l.t) + '" title="点击跳到 ' + fmtClock(l.t) + '">' + inner + '</div>';
  }

  function renderLyric() {
    const box = document.getElementById('nm3-lyric');
    if (!box) return;
    if (lyricFetching) {
      box.innerHTML = '<div class="nm3-lyric-empty">歌词加载中…</div>';
      return;
    }
    if (!lyricLines.length) {
      box.innerHTML = '<div class="nm3-lyric-empty">' + esc(lyricEmptyText) + '</div>';
      return;
    }
    // 主行开一组，紧跟其后的翻译 / 罗马音进同一组 —— 这样「当前行」点亮时
    // 它的翻译、罗马音是一起点亮的，不会各亮各的。
    const groups = [];
    let cur = null;
    lyricLines.forEach((l, i) => {
      if (!l.sub) { cur = { i: i, subs: [] }; groups.push(cur); return; }
      if (cur) cur.subs.push({ l: l, i: i });
    });
    box.innerHTML = groups.map((g) => {
      const main = lyricLineHtml(lyricLines[g.i], g.i, false);
      const subs = g.subs.map((s) => lyricLineHtml(s.l, s.i, true)).join('');
      return '<div class="nm3-lyric-grp" data-g="' + g.i + '">' + main + subs + '</div>';
    }).join('');
    lastCurLyric = -1;
    lastCharOn = -1;
    lastCharSec = -1;
    curCharNodes = null;
    syncLyric();
  }

  function syncLyric() {
    const box = document.getElementById('nm3-lyric');
    if (!box || !lyricLines.length || box.classList.contains('nm3-hide')) return;
    const sec = currentSeconds();
    if (sec == null) return;

    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      const l = lyricLines[i];
      if (l.sub) continue;
      if (l.t <= sec) idx = i;
      else break;
    }

    if (idx !== lastCurLyric) {
      lastCurLyric = idx;
      lastCharOn = -1;
      lastCharSec = sec;
      curCharNodes = null;
      box.querySelectorAll('.nm3-lyric-grp.nm3-cur').forEach((n) => {
        n.classList.remove('nm3-cur');
        // 离开这一行时把它里面已点亮的字一起收掉，不然会在别处留着半行亮字
        n.querySelectorAll('.nm3-ch.nm3-ch-on').forEach((c) => c.classList.remove('nm3-ch-on'));
      });
      if (idx < 0) return;
      const grp = box.querySelector('.nm3-lyric-grp[data-g="' + idx + '"]');
      if (!grp) return;
      grp.classList.add('nm3-cur');
      const chs = grp.querySelectorAll('.nm3-ch');
      if (chs && chs.length) curCharNodes = Array.prototype.slice.call(chs);
      // 当前这一组滚到可视区中间
      const target = grp.offsetTop - box.clientHeight / 2 + grp.offsetHeight / 2;
      if (typeof box.scrollTo === 'function') {
        box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    }

    // 逐字点亮：往回拖（或往回跳）时先清掉，再按时间从后往前点亮
    if (!curCharNodes || !curCharNodes.length) return;
    if (sec + 0.25 < lastCharSec) {
      curCharNodes.forEach((n) => n.classList.remove('nm3-ch-on'));
      lastCharOn = -1;
    }
    lastCharSec = sec;
    let n = lastCharOn;
    while (n + 1 < curCharNodes.length &&
           Number(curCharNodes[n + 1].getAttribute('data-ct')) <= sec) n++;
    for (let i = lastCharOn + 1; i <= n; i++) curCharNodes[i].classList.add('nm3-ch-on');
    lastCharOn = n;
  }

  /**
   * 取歌词原始返回。v1 才有 romalrc（罗马音）和 yrc（逐字），
   * 老接口拿不到就退回 /api/song/lyric —— 两个都不需要登录。
   */
  async function fetchLyricPayload(songId) {
    let lastErr = null;
    const tries = [
      ['/api/song/lyric/v1', { id: songId, cp: 'false', lv: -1, kv: -1, tv: -1, rv: -1, yv: -1, ytv: -1, yrv: -1 }],
      ['/api/song/lyric', { id: songId, lv: -1, kv: -1, tv: -1 }]
    ];
    for (let i = 0; i < tries.length; i++) {
      try {
        return await apiGet(tries[i][0], tries[i][1]);
      } catch (e) {
        lastErr = e;
        // 只有「接口不存在」才值得换下一个；别的错误（网络 / 限流）直接抛
        if (!e || Number(e.code) !== 404) throw e;
      }
    }
    throw lastErr || new Error('歌词接口不可用');
  }

  /** 没有歌词时到底为什么没有：纯音乐 / 还没收集 / 就是没有 */
  function lyricEmptyReason(d) {
    if (!d) return '这首歌暂时没有歌词';
    if (d.nolyric || d.sgc) return '纯音乐，请欣赏';
    if (d.uncollected || d.needDesc) return '歌词还在收集，暂时没有';
    return '这首歌暂时没有歌词';
  }

  async function loadLyric(songId) {
    lyricFetching = true;
    lyricLines = [];
    lyricPayload = null;
    lyricPayloadFor = null;
    lyricEmptyText = '这首歌暂时没有歌词';
    lastCurLyric = -1;
    lastCharOn = -1;
    lastCharSec = -1;
    curCharNodes = null;
    renderLyric();
    try {
      const d = await fetchLyricPayload(songId);
      if (curTrackId !== songId) return;
      lyricPayload = d || null;
      lyricPayloadFor = songId;
      lyricEmptyText = lyricEmptyReason(d);
      lyricLines = mergeLyric(
        (d && d.lrc && d.lrc.lyric) || '',
        (d && d.tlyric && d.tlyric.lyric) || '',
        (d && d.romalrc && d.romalrc.lyric) || '',
        (d && d.yrc && d.yrc.lyric) || ''
      );
    } catch (e) {
      warn('歌词获取失败', e);
      lyricLines = [];
      lyricPayload = null;
      lyricPayloadFor = null;
    } finally {
      lyricFetching = false;
      if (curTrackId === songId) renderLyric();
    }
  }

  /** 写 .lrc 用的时间戳： [mm:ss.xxx] */
  function lrcStamp(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (rest < 10 ? '0' : '') + rest.toFixed(3);
  }

  /**
   * 拼一份带时间轴的双语 .lrc。
   * ★ 国内播放器（网易云 PC、foobar+ESLyric、Poweramp…）认的双语写法是
   *   「同一个时间戳两行：第一行原文，第二行翻译」，所以这里按原文 / 翻译成对输出。
   */
  function lyricFileText(lines, info) {
    if (!lines || !lines.length) return '';
    const head = [];
    if (info && info.name) head.push('[ti:' + info.name + ']');
    if (info && info.artists) head.push('[ar:' + info.artists + ']');
    if (info && info.album) head.push('[al:' + info.album + ']');
    head.push('[by:网易云音乐·精简版]');
    head.push('[offset:0]');
    // ★ 翻译行要和原文**同一个时间戳**（sub 行内部带着 +0.001 的排序偏移，
    //   写文件时要用它上面那行的主行时间戳，否则播放器认不出这是双语）。
    let mainT = 0;
    const body = lines.map((l) => {
      if (!l.sub) mainT = l.t;
      return '[' + lrcStamp(l.sub ? mainT : l.t) + ']' + l.text;
    });
    return head.join('\n') + '\n' + body.join('\n') + '\n';
  }

  /** 下载时用的歌词文本：优先复用当前这首已经取回来的（省一次请求），否则现取 */
  async function lyricTextFor(info) {
    let d = (lyricPayloadFor === info.id) ? lyricPayload : null;
    if (!d) {
      try { d = await fetchLyricPayload(info.id); }
      catch (e) { warn('下载歌词失败', e); return ''; }
    }
    const lines = mergeLyric(
      (d && d.lrc && d.lrc.lyric) || '',
      (d && d.tlyric && d.tlyric.lyric) || '',
      '',                       // .lrc 里只放原文 + 翻译，罗马音不进文件（三行会互相打架）
      ''
    );
    return lyricFileText(lines, info);
  }

  /* ─────────────── 评论 ─────────────── */

  function ensureComments(songId) {
    if (!songId) return;
    if (cmSongId === songId) return; // 已经为这首歌加载过（含失败态，失败有重试按钮）
    loadComments(songId, false);
  }

  async function loadComments(songId, append) {
    if (!songId || cmBusy) return;

    if (!append) {
      cmSongId = songId;
      cmHot = [];
      cmList = [];
      cmTotal = 0;
      cmMore = false;
      cmError = null;
      renderComments();
    }
    cmBusy = true;
    renderComments();

    const offset = append ? cmList.length : 0;
    try {
      // /api/comment/music 在 music.163.com 上是 404；兜底用热评接口
      let d = null;
      let lastErr = null;
      const paths = [
        '/api/v1/resource/comments/R_SO_4_' + songId,
        '/api/v1/resource/hotcomments/R_SO_4_' + songId
      ];
      for (const path of paths) {
        try {
          d = await apiGet(path, { limit: CONFIG.COMMENT_LIMIT, offset: offset });
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (cmSongId !== songId) return;
      if (!d) throw lastErr || new Error('评论加载失败');

      if (!append) cmHot = d.hotComments || [];
      cmList = append ? cmList.concat(d.comments || []) : (d.comments || []);
      cmTotal = Number(d.total) || cmList.length;
      cmMore = d.more != null ? !!d.more : !!d.hasMore;
    } catch (e) {
      warn('评论获取失败', e);
      if (cmSongId === songId) cmError = { message: (e && e.message) || '网络异常' };
    } finally {
      if (cmSongId === songId) {
        cmBusy = false;
        renderComments();
        const em = document.querySelector('.nm3-seg a[data-pane="comment"] em');
        if (em && cmTotal) em.textContent = fmtCount(cmTotal);
      }
    }
  }

  function commentItem(c, i) {
    const u = c.user || {};
    const avatar = u.avatarUrl ? pic(u.avatarUrl, 80) : '';
    const reply = (c.beReplied && c.beReplied[0]) || null;
    const n = Number(c.likedCount) || 0;
    const liked = !!c.liked;
    return (
      '<div class="nm3-cm-item" data-ci="' + esc(i) + '">' +
        (avatar
          ? '<img class="nm3-cm-avatar" src="' + esc(avatar) + '" alt="" loading="lazy">'
          : '<div class="nm3-cm-avatar"></div>') +
        '<div class="nm3-cm-body">' +
          '<div class="nm3-cm-meta">' +
            '<b>' + esc(u.nickname || '匿名用户') + '</b>' +
            '<span>' + esc(fmtTime(c.time)) + '</span>' +
          '</div>' +
          '<div class="nm3-cm-text">' + esc(c.content || '') + '</div>' +
          (reply
            ? '<div class="nm3-cm-reply"><b>@' +
                esc((reply.user && reply.user.nickname) || '已删除') + '：</b>' +
                esc(reply.content || '') + '</div>'
            : '') +
          // 点赞：可点（走 /api/v1/comment/like），未登录会提示
          '<div class="nm3-cm-foot">' +
            '<button class="nm3-cm-like' + (liked ? ' nm3-on' : '') + '" type="button" ' +
              'data-act="cm-like" data-cid="' + esc(c.commentId) + '" data-ci="' + esc(i) + '" ' +
              'data-liked="' + (liked ? '1' : '0') + '" data-n="' + n + '" ' +
              'title="' + (liked ? '取消点赞' : '点赞') + '">' +
              SVG.like(12, 'currentColor') + '<span>' + (n ? fmtCount(n) : '赞') + '</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderComments() {
    const box = document.getElementById('nm3-comment');
    if (!box) return;

    if (cmBusy && !cmList.length && !cmHot.length) {
      box.innerHTML = stateBlock('评论加载中…', '', { loading: true });
      return;
    }
    if (cmError && !cmList.length && !cmHot.length) {
      box.innerHTML = stateBlock(cmError.message || '评论加载失败', '可以点下面重试。', {
        action: 'cm-retry', actionLabel: '重试'
      });
      return;
    }
    if (!cmHot.length && !cmList.length) {
      box.innerHTML = stateBlock('还没有评论', '来听这首歌的人都很安静。');
      return;
    }

    let html = '';
    if (cmHot.length) {
      html += '<div class="nm3-cm-grp">最热</div>' +
        cmHot.map((c, i) => commentItem(c, 'h' + i)).join('');
    }
    if (cmList.length) {
      html += '<div class="nm3-cm-grp">最新</div>' +
        cmList.map((c, i) => commentItem(c, i)).join('');
    }
    if (cmMore) {
      html += '<button class="nm3-btn nm3-cm-more" data-act="cm-more"' +
        (cmBusy ? ' disabled' : '') + '>' + (cmBusy ? '加载中…' : '加载更多评论') + '</button>';
    } else if (cmTotal) {
      html += '<div class="nm3-cm-end">共 ' + fmtCount(cmTotal) + ' 条评论</div>';
    }
    box.innerHTML = html;
  }

  /* ═══════════════════════════ 账号数据 ═══════════════════════════ */

  async function getUid() {
    if (uid) return uid;
    // 只信接口：GUser 可能是过期的登录态，拿它去查会读到别人的公开歌单
    try {
      const d = await apiGet('/api/nuser/account/get');
      const v = (d && d.profile && d.profile.userId) || (d && d.account && d.account.id);
      if (v) uid = v;
    } catch (e) { /* noop */ }
    return uid;
  }

  function allMinePlaylists() {
    return [mineLiked].concat(mineMade, mineSubs).filter(Boolean);
  }

  /* ═══════════════════════════ 我的音乐 ═══════════════════════════ */

  async function ensureMine(force) {
    if (mineBusy) return;
    if (mineLoaded && !force) { renderMine(); return; }
    await loadMine();
  }

  async function loadMine() {
    mineBusy = true;
    mineError = null;
    renderMine();
    try {
      if (!(await checkLogin())) { mineError = { needLogin: true }; return; }
      const id = await getUid();
      if (!id) { mineError = { needLogin: true }; return; }
      const d = await apiGet('/api/user/playlist', { uid: id, limit: 1000, offset: 0 });
      const list = (d && d.playlist) || [];
      if (!list.length) throw new Error('没有读到歌单，登录可能已过期。');
      mineLiked = list.find((p) => p && p.specialType === 5) || null;
      mineMade = list.filter((p) => p && p.specialType !== 5 && !p.subscribed);
      mineSubs = list.filter((p) => p && p.subscribed);
      mineLoaded = true;
    } catch (e) {
      warn('我的音乐加载失败', e);
      mineError = { message: (e && e.message) || '网络异常' };
    } finally {
      mineBusy = false;
      renderMine();
    }
  }

  function renderMine() {
    const host = document.getElementById('nm3-mine-host');
    if (!host) return;

    if (detail.active && detail.owner === 'mine') { host.innerHTML = detailHtml(); return; }
    if (mineBusy) { host.innerHTML = stateBlock('正在读取你的音乐库…', '', { loading: true }); return; }
    if (mineError) {
      host.innerHTML = mineError.needLogin
        ? stateBlock('请先登录网易云音乐', '「我的音乐」要读取你的歌单，必须登录。', {
            action: 'login', actionLabel: '立即登录', primary: true
          })
        : stateBlock(mineError.message || '加载失败', '可以点下面重试一次。', {
            action: 'mine-retry', actionLabel: '重试'
          });
      return;
    }
    host.innerHTML = renderMineList();
  }

  function playlistCard(p) {
    const cover = pic(p.coverImgUrl, 300);
    const sub = p.creator && p.creator.nickname ? p.creator.nickname : '';
    return (
      '<div class="nm3-card" data-card="' + esc(p.id) + '" data-kind="playlist">' +
        '<div class="nm3-card-cover">' +
          (cover ? '<img src="' + esc(cover) + '" alt="" loading="lazy">' : '') +
          '<span class="nm3-card-play" data-act="openplay" data-kind="playlist" data-id="' +
            esc(p.id) + '" title="播放">' + SVG.play(15, INK) + '</span>' +
        '</div>' +
        '<div class="nm3-card-name" title="' + esc(p.name) + '">' + esc(p.name) + '</div>' +
        '<div class="nm3-card-count">' + fmtCount(p.trackCount) + ' 首' +
          (sub ? ' · ' + esc(sub) : '') + '</div>' +
      '</div>'
    );
  }

  function renderMineList() {
    if (!mineLiked && !mineMade.length && !mineSubs.length) {
      return stateBlock('你的音乐库还是空的', '去网页版收藏一些歌，再回来看看。');
    }

    let html = '';
    if (mineLiked) {
      const cover = pic(mineLiked.coverImgUrl, 300);
      html +=
        '<div class="nm3-hero">' +
          '<div class="nm3-hero-cover">' +
            (cover ? '<img src="' + esc(cover) + '" alt="">' : '') +
          '</div>' +
          '<div class="nm3-hero-info">' +
            '<div class="nm3-hero-label">' + SVG.heart(19, 'currentColor') + '我喜欢的音乐</div>' +
            '<div class="nm3-hero-count">' + fmtCount(mineLiked.trackCount) + ' 首 · 你的红心收藏</div>' +
            '<div class="nm3-hero-actions">' +
              '<button class="nm3-btn nm3-primary" data-act="openplay" data-kind="playlist" data-id="' +
                esc(mineLiked.id) + '">' + SVG.play(12, INK) + '播放全部</button>' +
              '<button class="nm3-btn" data-act="open" data-kind="playlist" data-id="' +
                esc(mineLiked.id) + '">查看歌曲</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }
    if (mineMade.length) {
      html += '<section class="nm3-sec">' +
        '<h3 class="nm3-sec-title">创建的歌单 <span>' + mineMade.length + '</span></h3>' +
        '<div class="nm3-grid">' + mineMade.map(playlistCard).join('') + '</div></section>';
    }
    if (mineSubs.length) {
      html += '<section class="nm3-sec">' +
        '<h3 class="nm3-sec-title">收藏的歌单 <span>' + mineSubs.length + '</span></h3>' +
        '<div class="nm3-grid">' + mineSubs.map(playlistCard).join('') + '</div></section>';
    }
    return html;
  }

  /* ═══════════════════════════ 搜索 ═══════════════════════════ */

  const HISTORY_KEY = 'nm3-search-history';
  const SEARCH_SUGGEST = ['周杰伦', '五月天', '陈奕迅', '林俊杰', '纯音乐', '粤语经典'];

  function getHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 10) : [];
    } catch (e) {
      return [];
    }
  }

  function pushHistory(kw) {
    const q = String(kw || '').trim();
    if (!q) return;
    try {
      const list = [q].concat(getHistory().filter((x) => x !== q)).slice(0, 10);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) { /* noop */ }
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
  }

  /** 搜索空态：做成有设计的一屏，而不是一句干提示 */
  function searchEmptyHtml() {
    const hist = getHistory();
    const items = hist.length ? hist : SEARCH_SUGGEST;
    const label = hist.length ? '最近搜索' : '试试这些';
    return (
      '<div class="nm3-empty">' +
        '<div class="nm3-empty-icon">' + SVG.search(26, 'currentColor') + '</div>' +
        '<div class="nm3-empty-title">搜点什么吧</div>' +
        '<div class="nm3-empty-sub">在右上角的搜索框里输入歌名、歌手、专辑或歌单</div>' +
        '<div class="nm3-empty-grp">' +
          '<div class="nm3-empty-label"><span>' + label + '</span>' +
            (hist.length ? '<a data-act="search-clear">清空</a>' : '') + '</div>' +
          '<div class="nm3-chips">' +
            items.map((k) =>
              '<a class="nm3-chip-btn" data-act="search-chip" data-kw="' + esc(k) +
              '" title="' + esc(k) + '">' + esc(k) + '</a>'
            ).join('') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /**
   * 搜索。用站点上真实存在的两个接口，谁先返回合法结构就用谁：
   *   /api/cloudsearch/pc  —— weapi 形态（al/ar + privilege + 封面），结果最全
   *   /api/search/get      —— 老的 api 形态兜底（album/artists，且 album.picUrl 为空）
   *
   * 注意两点：
   *   · 参数名是 s，不是 keywords —— keywords 是 NeteaseCloudMusicApi 服务端的参数；
   *   · /api/cloudsearch（没有 /pc）在 music.163.com 上是 404，别用。
   */
  async function searchApi(q, type) {
    const attempts = [
      ['/api/cloudsearch/pc', { s: q, type: type.type, limit: CONFIG.SEARCH_LIMIT, offset: 0 }],
      ['/api/search/get', { s: q, type: type.type, limit: CONFIG.SEARCH_LIMIT, offset: 0 }]
    ];
    let lastErr = null;
    for (const [path, params] of attempts) {
      try {
        const d = await apiGet(path, params);
        const r = d && d.result;
        if (r && Array.isArray(r[type.key])) return r;
        lastErr = new Error('接口返回结构不符（' + path + '）');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('搜索失败');
  }

  async function runSearch(kw, force, type) {
    const q = String(kw == null ? '' : kw).trim();
    if (type) searchType = type;

    if (!q) {
      searchKw = '';
      searchDone = false;
      searchData = {};
      searchError = null;
      detail.active = false;
      searchSeq++;
      switchTab('search');
      renderSearch();
      return;
    }

    // 同关键词同类型、结果还在，就不重复请求
    if (!force && searchDone && q === searchKw && !detail.active) { switchTab('search'); return; }

    const seq = ++searchSeq;
    const wantType = searchType;

    searchKw = q;
    pushHistory(q);
    searchBusy = true;
    searchError = null;
    searchDone = true;
    searchData = {};
    detail.active = false;

    const input = document.getElementById('nm3-input');
    if (input && input.value !== q) input.value = q;

    switchTab('search');
    renderSearch();

    try {
      const type = SEARCH_TYPES.find((t) => t.type === wantType) || SEARCH_TYPES[0];
      const result = await searchApi(q, type);
      if (seq !== searchSeq) return;
      searchData = result;
    } catch (e) {
      if (seq !== searchSeq) return;
      warn('搜索失败', e);
      searchError = { message: (e && e.message) || '网络异常' };
    } finally {
      if (seq === searchSeq) {
        searchBusy = false;
        renderSearch();
      }
    }
  }

  function searchMetaHtml() {
    if (!searchKw) return '在右上角输入关键词开始搜索';
    if (searchBusy) return '搜索中…';
    const type = SEARCH_TYPES.find((t) => t.type === searchType) || SEARCH_TYPES[0];
    const list = (searchData && searchData[type.key]) || [];
    const total = (searchData && searchData[type.total]) || list.length;
    return '「<b>' + esc(searchKw) + '</b>」找到 ' + fmtCount(total) + ' 个' + esc(type.label);
  }

  function renderSearch() {
    const host = document.getElementById('nm3-search-host');
    if (!host) return;

    if (detail.active && detail.owner === 'search') { host.innerHTML = detailHtml(); return; }

    const seg =
      '<div class="nm3-sh">' +
        '<div class="nm3-seg">' +
          SEARCH_TYPES.map((t) =>
            '<a data-act="stype" data-type="' + t.type + '"' +
            (t.type === searchType ? ' class="nm3-on"' : '') + '>' + esc(t.label) + '</a>'
          ).join('') +
        '</div>' +
        '<div class="nm3-sh-meta">' + searchMetaHtml() + '</div>' +
      '</div>';

    if (searchBusy) { host.innerHTML = seg + stateBlock('正在搜索…', '', { loading: true }); return; }
    if (searchError) {
      host.innerHTML = seg + stateBlock(searchError.message || '搜索失败', '可以点下面重试。', {
        action: 'search-retry', actionLabel: '重试'
      });
      return;
    }
    if (!searchDone || !searchKw) {
      host.innerHTML = searchEmptyHtml();
      return;
    }

    const type = SEARCH_TYPES.find((t) => t.type === searchType) || SEARCH_TYPES[0];
    const list = (searchData && searchData[type.key]) || [];

    if (!list.length) {
      host.innerHTML = seg + stateBlock('没有找到「' + searchKw + '」', '换个关键词，或切到别的类型试试。');
      return;
    }

    if (type.key === 'songs') {
      host.innerHTML = seg + trackListHtml(list, { list: 'detail' });
      return;
    }

    const cards = list.map((x) => {
      if (type.key === 'artists') {
        const cover = pic(x.picUrl, 300);
        const alias = (x.alias && x.alias[0]) || '';
        return '<div class="nm3-card" data-card="' + esc(x.id) + '" data-kind="artist">' +
          '<div class="nm3-card-cover nm3-round">' +
            (cover ? '<img src="' + esc(cover) + '" alt="" loading="lazy">' : '') +
            '<span class="nm3-card-play" data-act="openplay" data-kind="artist" data-id="' +
              esc(x.id) + '" title="播放热门">' + SVG.play(15, INK) + '</span>' +
          '</div>' +
          '<div class="nm3-card-name" title="' + esc(x.name) + '">' + esc(x.name) + '</div>' +
          '<div class="nm3-card-count">' + (alias ? esc(alias) + ' · ' : '') +
            fmtCount(x.albumSize || 0) + ' 张专辑</div></div>';
      }
      if (type.key === 'albums') {
        const cover = pic(x.picUrl, 300);
        const ar = (x.artist && x.artist.name) || '';
        return '<div class="nm3-card" data-card="' + esc(x.id) + '" data-kind="album">' +
          '<div class="nm3-card-cover">' +
            (cover ? '<img src="' + esc(cover) + '" alt="" loading="lazy">' : '') +
            '<span class="nm3-card-play" data-act="openplay" data-kind="album" data-id="' +
              esc(x.id) + '" title="播放">' + SVG.play(15, INK) + '</span>' +
          '</div>' +
          '<div class="nm3-card-name" title="' + esc(x.name) + '">' + esc(x.name) + '</div>' +
          '<div class="nm3-card-count">' + (ar ? esc(ar) + ' · ' : '') +
            fmtCount(x.size || 0) + ' 首</div></div>';
      }
      const cover = pic(x.coverImgUrl, 300);
      const cr = (x.creator && x.creator.nickname) || '';
      return '<div class="nm3-card" data-card="' + esc(x.id) + '" data-kind="playlist">' +
        '<div class="nm3-card-cover">' +
          (cover ? '<img src="' + esc(cover) + '" alt="" loading="lazy">' : '') +
          '<span class="nm3-card-play" data-act="openplay" data-kind="playlist" data-id="' +
            esc(x.id) + '" title="播放">' + SVG.play(15, INK) + '</span>' +
        '</div>' +
        '<div class="nm3-card-name" title="' + esc(x.name) + '">' + esc(x.name) + '</div>' +
        '<div class="nm3-card-count">' + fmtCount(x.trackCount) + ' 首' +
          (cr ? ' · ' + esc(cr) : '') + '</div></div>';
    }).join('');

    host.innerHTML = seg + '<section class="nm3-sec"><div class="nm3-grid">' + cards + '</div></section>';
  }

  /* ═══════════════════════════ 共用详情 ═══════════════════════════ */

  function lookupItem(kind, id) {
    const same = (a, b) => String(a) === String(b);
    if (kind === 'playlist') {
      const mine = allMinePlaylists().find((p) => same(p.id, id));
      if (mine) {
        return { title: mine.name, cover: mine.coverImgUrl, sub: (mine.creator && mine.creator.nickname) || '' };
      }
      const s = ((searchData && searchData.playlists) || []).find((p) => same(p.id, id));
      if (s) return { title: s.name, cover: s.coverImgUrl, sub: (s.creator && s.creator.nickname) || '' };
    }
    if (kind === 'album') {
      const a = ((searchData && searchData.albums) || []).find((x) => same(x.id, id));
      if (a) return { title: a.name, cover: a.picUrl, sub: (a.artist && a.artist.name) || '' };
    }
    if (kind === 'artist') {
      const a = ((searchData && searchData.artists) || []).find((x) => same(x.id, id));
      if (a) return { title: a.name, cover: a.picUrl, sub: (a.alias && a.alias[0]) || '' };
    }
    return { title: '', cover: '', sub: '' };
  }

  async function fetchSongsByIds(ids) {
    const out = [];
    const batch = CONFIG.SONG_DETAIL_BATCH;
    for (let i = 0; i < ids.length; i += batch) {
      const part = ids.slice(i, i + batch);
      const songs = await songDetail(part);
      const map = {};
      songs.forEach((s) => { if (s && s.id) map[s.id] = s; });
      part.forEach((id) => { if (map[id]) out.push(map[id]); });
    }
    return out;
  }

  async function loadDetail(kind, id) {
    if (kind === 'playlist') {
      const d = await apiGet('/api/v6/playlist/detail', {
        id: id, n: CONFIG.MAX_PLAYLIST_TRACKS, s: 8
      });
      const p = d && d.playlist;
      if (!p) throw new Error('歌单读取失败，可能是私密歌单或登录已过期。');
      let tracks = (p.tracks || []).filter(Boolean);
      // v6 的 n 只回前 n 首，用完整的 trackIds 补齐
      const ids = (p.trackIds || [])
        .map((x) => x && x.id).filter(Boolean).slice(0, CONFIG.MAX_PLAYLIST_TRACKS);
      if (ids.length > tracks.length) tracks = await fetchSongsByIds(ids);
      return {
        title: p.name,
        cover: p.coverImgUrl,
        sub: (p.creator && p.creator.nickname) || '',
        tracks: tracks
      };
    }
    if (kind === 'album') {
      // ★ 这里原来只读 d.songs，于是「搜索 → 专辑点进去」永远一首歌都看不到：
      //   /api/album/<id> 在 music.163.com 上把曲目塞在 **album.songs** 里，
      //   顶层没有 songs（实测：{"code":200,"album":{"songs":[…]}}）。
      //   网页版自己用的是 /api/v1/album/<id>：songs 在顶层，而且是 ar/al 的
      //   新结构（正好对上 artistsOf() / albumOf()），体积也只有一半。优先它，
      //   拿不到再退回老接口，并且两种位置都读。
      let a = null;
      let songs = null;
      try {
        const d = await apiGet('/api/v1/album/' + id);
        a = d && d.album;
        songs = d && d.songs;
      } catch (e) {
        warn('v1 专辑接口不可用，改用 /api/album', e);
      }
      if (!a || !songs || !songs.length) {
        const d2 = await apiGet('/api/album/' + id);
        a = (d2 && d2.album) || a;
        songs = (d2 && (d2.songs || (d2.album && d2.album.songs))) || songs;
      }
      if (!a) throw new Error('专辑读取失败。');
      const list = (songs || []).filter(Boolean);
      return {
        title: a.name,
        cover: a.picUrl,
        sub: (a.artist && a.artist.name) || (list[0] ? artistsOf(list[0]) : ''),
        tracks: list
      };
    }
    if (kind === 'artist') {
      // ★ 原来这里只取「热门歌曲」，所以从听歌页点歌手进来时标题是空的、也没有
      //   头像。名字 / 封面 / 简介在 /api/v1/artist/<id>（实测可用，返回 artist
      //   对象），曲目仍在 /api/artist/top/song。
      let info = null;
      try {
        const d = await apiGet('/api/v1/artist/' + id);
        info = (d && d.artist) || null;
      } catch (e) {
        warn('歌手信息读取失败', e);
      }
      const d2 = await apiGet('/api/artist/top/song', { id: id });
      const songs = ((d2 && d2.songs) || []).filter(Boolean);
      if (!info && !songs.length) throw new Error('这位歌手暂时没有可播放的歌曲。');
      return {
        title: info && info.name,
        cover: info && info.picUrl,
        sub: (info && ((info.alias && info.alias[0]) || '')) || '',
        brief: (info && (info.briefDesc || '')) || '',
        tracks: songs
      };
    }
    throw new Error('未知的资源类型');
  }

  function openItem(kind, id, autoPlay) {
    if (!kind || !id) return;
    const owner = tab === 'search' ? 'search' : 'mine';
    const meta = lookupItem(kind, id);

    detail = {
      active: true, owner: owner, kind: kind, id: id,
      title: meta.title || '', cover: meta.cover || '', sub: meta.sub || '',
      brief: '', briefOpen: false,
      tracks: [], busy: true, error: null
    };
    renderCurrent();

    const alive = () => detail.active && String(detail.id) === String(id) && detail.owner === owner;

    loadDetail(kind, id)
      .then((r) => {
        if (!alive()) return;
        if (r.title) detail.title = r.title;
        if (r.cover) detail.cover = r.cover;
        if (r.sub) detail.sub = r.sub;
        if (r.brief) detail.brief = r.brief;
        detail.tracks = r.tracks || [];
      })
      .catch((e) => {
        warn('详情读取失败', e);
        if (alive()) detail.error = { message: (e && e.message) || '加载失败' };
      })
      .then(() => {
        if (!alive()) return;
        detail.busy = false;
        renderCurrent();
        if (autoPlay && detail.tracks.length) playDetailAll();
      });
  }

  function closeDetail() {
    detail.active = false;
    detail.tracks = [];
    detail.error = null;
    renderCurrent();
  }

  function renderCurrent() {
    if (detail.owner === 'search' || tab === 'search') renderSearch();
    else renderMine();
  }

  /** 歌手简介：默认收着几行，点一下展开/收起 */
  function briefHtml() {
    if (detail.kind !== 'artist' || !detail.brief) return '';
    const open = !!detail.briefOpen;
    return (
      '<div class="nm3-bio' + (open ? ' nm3-open' : '') + '" id="nm3-bio" data-act="bio-toggle" ' +
        'title="' + (open ? '收起简介' : '展开简介') + '">' +
        esc(detail.brief) +
        '<span class="nm3-bio-more">' + (open ? '收起' : '展开全部') + '</span>' +
      '</div>'
    );
  }

  function detailHtml() {
    const kindLabel = { playlist: '歌单', album: '专辑', artist: '歌手热门' }[detail.kind] || '歌单';
    const cover = pic(detail.cover, 220);
    const round = detail.kind === 'artist' ? ' nm3-round' : '';

    const head =
      '<div class="nm3-dh">' +
        '<button class="nm3-back" data-act="back">' + SVG.back(13, 'currentColor') + '返回</button>' +
        '<div class="nm3-dh-cover' + round + '">' +
          (cover ? '<img src="' + esc(cover) + '" alt="">' : '') +
        '</div>' +
        '<div class="nm3-dh-info">' +
          '<div class="nm3-dh-name" title="' + esc(detail.title || '') + '">' +
            esc(detail.title || kindLabel) + '</div>' +
          '<div class="nm3-dh-meta">' + esc(kindLabel) + ' · ' +
            (detail.busy ? '加载中…' : fmtCount(detail.tracks.length) + ' 首') +
            (detail.sub ? ' · ' + esc(detail.sub) : '') + '</div>' +
        '</div>' +
        '<button class="nm3-btn nm3-primary" data-act="playdetail"' +
          (detail.busy || !detail.tracks.length ? ' disabled' : '') + '>' +
          SVG.play(13, INK) + '播放全部</button>' +
      '</div>';

    const bio = briefHtml();
    if (detail.busy) return head + stateBlock('正在读取…', '', { loading: true });
    if (detail.error) return head + bio + stateBlock(detail.error.message || '加载失败', '返回上一页可以换一个。');
    if (!detail.tracks.length) return head + bio + stateBlock('这里没有可播放的歌曲', '换一个试试。');
    return head + bio + trackListHtml(detail.tracks, { list: 'detail' });
  }

  /* ═══════════════════════════ 播放 ═══════════════════════════ */

  /**
   * 播放一张列表的第 index 首。
   *
   * 只用 `player.addTo(list, true, true)` —— 也就是站点自己「播放」按钮走的那条路。
   * 做法是把目标曲排到队首（其余顺延），一次调用就能开播。
   *
   * 为什么不用「先 addTo(list,true,false) 换队列、再 addTo([list[i]],false,true)
   * 靠合并模式跳号」那套：它依赖播放器内部（每次构建都随机化标识符的）实现细节，
   * 第二跳一旦没生效，就会留下**"队列里有歌但完全没播"**的僵尸状态 ——
   * 表现正是：歌名显示、进度 00:00、封面空白、按钮显示"已暂停"。
   */
  function playList(songs, index) {
    if (!songs || !songs.length) return false;
    const i = (typeof index === 'number' && index >= 0 && index < songs.length) ? index : 0;
    const target = songs[i];

    const p = getPlayer();
    if (p && typeof p.addTo === 'function') {
      try {
        const ordered = songs.slice(i).concat(songs.slice(0, i));
        p.addTo(ordered, true, true);
        return true;
      } catch (e) {
        warn('player.addTo 调用失败，改用 DOM 兜底', e);
      }
    }
    return playViaDom(target && target.id);
  }

  /** DOM 兜底：合成站点自己的播放按钮（core_*.js 对 [data-res-action=play] 做事件委托） */
  function playViaDom(songId) {
    if (!songId) return false;
    let ok = false;
    try {
      const a = document.createElement('a');
      a.className = 'ply';
      a.setAttribute('data-res-type', '18');
      a.setAttribute('data-res-id', String(songId));
      a.setAttribute('data-res-action', 'play');
      a.setAttribute('data-res-from', '32');
      a.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
      document.body.appendChild(a);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      setTimeout(() => a.remove(), 0);
      ok = true;
    } catch (e) { /* noop */ }
    if (!ok) toast('播放失败，请手动播放一次任意歌曲');
    return ok;
  }

  function playDetailAll() {
    if (!detail.tracks.length) { toast('这里还没有歌曲'); return; }
    if (playList(detail.tracks, 0)) {
      toast('播放全部 · ' + detail.tracks.length + ' 首');
      refreshCurrentSoon();
    }
  }

  function playDetailAt(i) {
    const s = detail.tracks[i];
    if (!s) return;
    if (playList(detail.tracks, i)) { toast('正在播放：' + (s.name || '')); refreshCurrentSoon(); }
  }

  function refreshCurrentSoon() {
    setTimeout(refreshCurrentViews, 400);
    setTimeout(refreshCurrentViews, 1400);
  }

  function refreshCurrentViews() {
    if (tab === 'mine' && detail.active && detail.owner === 'mine') {
      updateCurrentRows('nm3-mine-host', detail.tracks);
    }
    if (tab === 'search') {
      if (detail.active && detail.owner === 'search') updateCurrentRows('nm3-search-host', detail.tracks);
      else if (searchType === 1) updateCurrentRows('nm3-search-host', (searchData && searchData.songs) || []);
    }
  }

  /* ═══════════════════════════ 主循环 ═══════════════════════════ */

  function tick() {
    layout();
    ensureUser();
    ensureAudioWatch();

    const np = nowPlaying();
    const id = np && np.track ? np.track.id : null;

    // 换歌检测放在页签判断之外：歌词、封面、音质要一直跟着当前歌曲走
    if (id !== curTrackId) {
      curTrackId = id;
      curTrackSince = Date.now();
      rescuedTrackId = null;
      cmSongId = null;
      cmHot = []; cmList = []; cmTotal = 0; cmMore = false; cmError = null;
      if (id) {
        loadLyric(id);
        loadTrackMeta(id);      // 补齐封面 / 专辑 / 时长
        syncQualityForSong(id);
      } else {
        lyricLines = [];
        lyricPayload = null;
        lyricPayloadFor = null;
        lyricEmptyText = '这首歌暂时没有歌词';
        lastCurLyric = -1;
        curCharNodes = null;
        renderLyric();               // 没在播了就把歌词区切回空态，别留着上一首的
        trackMeta = null;
        trackMetaFor = null;
        const bg = document.getElementById('nm3-np-bg');
        if (bg) bg.style.backgroundImage = 'none';
      }
    }

    if (tab === 'listen') {
      renderNowPlaying();
      updateControlsUi();
      if (id) syncLyric();
      // 收藏状态要一份「我喜欢的音乐」的 id 集合，登录后懒取一次
      if (id && likedSet === null && !likedBusy) ensureLikedSet();
    } else if (id && trackMetaFor !== id) {
      // 不在听歌页时也要补元数据，切回去就能直接看到封面
      loadTrackMeta(id);
    }

    // 网页播放器不播、但接口能给流时，脚本用客户端姿态救场
    if (id) maybeRescue();
  }

  /* ═══════════════════════════ 启动 ═══════════════════════════ */

  function boot() {
    // 这两个都必须在站点脚本之前挂钩
    hookAudioElement();
    loadQuality();
    hookQuality();
    markClientCookie();      // 会话按 PC 客户端姿态（os=pc 等）
    injectStyle(CSS, 'nm3-style');

    const start = () => {
      if (!document.body) {
        requestAnimationFrame(start);
        return;
      }
      try {
        buildBar();
        buildPanel();
        renderUser();
        switchTab('listen');
        layout();

        window.addEventListener('resize', layout);
        window.addEventListener('scroll', layout, true);

        setInterval(tick, CONFIG.TICK);
        log('已启动：听歌 / 搜索 / 我的音乐（底栏功能已搬到歌词上方）');
      } catch (e) {
        // 启动阶段出岔子别静默：至少让控制台说清楚，也别把 tick 留在半路
        warn('启动失败', e);
      }
    };

    // document-start 时 body 可能还没有；两种情况都要能起来
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  boot();
})();
