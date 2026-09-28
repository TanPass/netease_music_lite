/* 歌词时间轴 + 点赞/收藏 回归测试
 *
 * 和 download-dir 那个测试一样：把 netease-music-lite.user.js 里的相关代码段
 * **原样抽出来**，喂给桩（fetch / DOM / 站点 API），验证行为：
 *
 *   歌词：LRC 多时间戳、[offset:] 位移、翻译/罗马音挂行（行数对不上时按时间就近）、
 *         yrc 逐字时间轴解析与按行贴合、分组渲染（主行 + 翻译 + 罗马音同一组）、
 *         当前组点亮与逐字点亮、双语 .lrc 文件文本（同时间戳两行 = 原文 + 翻译）。
 *   点赞：走 /api/v1/comment/like，取消走 /api/v1/comment/unlike；type 是资源类型
 *         而不是点赞开关；301/400/-460 各自的提示语；取消那条路失败会换口径重试。
 *   收藏：先自己打 /api/radio/like（alg/trackId/like/time=3 + csrf），失败退站点
 *         subscribe，最后用真实状态校验 —— 成功才说成功，失败说人话并留诊断。
 *
 * 用法：node netease-music-lite.lyric-like.test.cjs
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, 'netease-music-lite.user.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(startMark, endMark) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  assert(a > 0 && b > a, '定位代码段失败：' + startMark);
  return src.slice(a, b);
}

/* ═══════════════════ 一个够用的 DOM 桩（认得自己生成的那几种标签） ═══════════════════ */

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c, on) => {
      if (on === undefined) { if (set.has(c)) set.delete(c); else set.add(c); }
      else if (on) set.add(c);
      else set.delete(c);
    },
    _set: set
  };
}

function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null, text: '' };
  const stack = [root];
  const re = /<\/?([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*>/g;
  let last = 0;
  let m;
  const pushText = (t) => { if (t) stack[stack.length - 1].text += t; };
  while ((m = re.exec(html)) !== null) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    const attrs = {};
    const ar = /([a-zA-Z-]+)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[2] || '')) !== null) attrs[a[1]] = a[2];
    if (m[0][1] === '/') {
      if (stack.length > 1) stack.pop();
    } else {
      const el = { tag: m[1], attrs: attrs, children: [], parent: stack[stack.length - 1], text: '' };
      el.classList = makeClassList();
      (attrs.class || '').split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
      el.offsetTop = el.classList.contains('nm3-lyric-grp') ? 100 * (Number(attrs['data-g']) + 1) : 30;
      el.offsetHeight = 40;
      el.clientHeight = 300;
      el.scrollTo = (o) => { el.scrollTop = o && o.top; };
      el.getAttribute = (k) => (attrs[k] === undefined ? null : attrs[k]);
      el.setAttribute = (k, v) => { attrs[k] = String(v); };
      el.querySelectorAll = (sel) => collect(el, sel);
      el.querySelector = (sel) => collect(el, sel)[0] || null;
      Object.defineProperty(el, 'innerHTML', {
        get() { return el._html || ''; },
        set(v) {
          el._html = v;
          const parsed = parseHtml(v);
          el.children = parsed.children;
          el.children.forEach((c) => { c.parent = el; });
        }
      });
      stack[stack.length - 1].children.push(el);
      if (!/^(br|img|input)$/i.test(el.tag)) stack.push(el);
    }
  }
  pushText(html.slice(last));
  return root;
}

function walk(el, fn) {
  el.children.forEach((c) => { fn(c); walk(c, fn); });
}

function matchSel(el, sel) {
  const attrs = [];
  const attrR = /\[([a-zA-Z-]+)="([^"]*)"\]/g;
  let a;
  while ((a = attrR.exec(sel)) !== null) attrs.push([a[1], a[2]]);
  const bare = sel.replace(/\[[^\]]*\]/g, '');
  const classes = (bare.match(/\.[a-zA-Z0-9_-]+/g) || []).map((s) => s.slice(1));
  const tag = bare.replace(/\.[a-zA-Z0-9_-]+/g, '').trim();
  if (tag && el.tag !== tag) return false;
  if (!classes.every((c) => el.classList && el.classList.contains(c))) return false;
  return attrs.every(([k, v]) => (el.attrs ? el.attrs[k] : null) === v);
}

function collect(root, sel) {
  const out = [];
  walk(root, (el) => { if (matchSel(el, sel)) out.push(el); });
  return out;
}

/* ═══════════════════ 歌词部分 ═══════════════════ */

const LRC = [
  '[ti:测试]',
  '[00:00.851]夢ならばどれほどよかったでしょう',
  '[00:06.650]未だにあなたのことを夢にみる',
  '[00:12.340]忘れた物を取りに帰るように',
  '[00:17.660]古びた思い出の埃を払う',
  '[00:28.480]我带着比身体重的行李'
].join('\n');
const TLYRIC = [
  '[00:00.851]如果这一切都是梦境该有多好',
  '[00:06.650]至今仍能与你在梦中相遇',
  '[00:12.340]如同取回遗忘之物一般',
  '[00:17.660]细细拂去将回忆覆盖的尘埃',
  '[00:28.480]我带着比身体重的行李'
].join('\n');
const ROMA = [
  '[00:00.851]yu me na ra ba do re ho do yo ka tta de syo u',
  '[00:06.650]i ma da ni a na ta no ko to wo yu me ni mi ru',
  '[00:12.340]wa su re ta mo no wo to ri ni ka e ru yo u ni',
  '[00:17.660]fu ru bi ta o mo i de no ho ko ri wo ha ra u',
  '[00:28.480]wo dai zhe bi shen ti zhong de xing li'
].join('\n');
// 真实 yrc 片段（id=1974443814）：行首 [行起始ms,行时长ms]，每字 (字起始ms,?,?)
const YRC = '[28480,11820](28480,160,0)我(28640,420,0)带(29060,230,0)着(29290,160,0)比' +
  '(29450,290,0)身(29740,190,0)体(29930,240,0)重(30170,110,0)的(30280,440,0)行(30720,500,0)李 ' +
  '(31220,240,0)游(31460,210,0)入(31670,230,0)尼(31900,210,0)罗(32110,400,0)河(32510,420,0)底';

let LYRIC_API = {};       // 桩：路径 → payload/函数（抛错就当接口不可用）

function buildLyricApi() {
  const block = slice('  /** 解析 LRC：多时间戳、[offset:] 都认；返回按时间排好的行 */',
    '  /* ─────────────── 评论 ─────────────── */');
  let box = null;
  const calls = [];
  const doc = { getElementById: (id) => (id === 'nm3-lyric' ? box : null) };
  const prelude = `
    let curTrackId = 123;
    let lyricLines = [];
    let lyricPayload = null, lyricPayloadFor = null;
    let lyricEmptyText = '这首歌暂时没有歌词';
    let lyricFetching = false;
    let lastCurLyric = -1, lastCharOn = -1, lastCharSec = -1, curCharNodes = null;
  `;
  const factory = new Function(
    'document', 'esc', 'fmtClock', 'currentSeconds', 'apiGet', 'warn', 'toast', 'Blob',
    prelude + block + `
    return {
      parseLrc, parseYrc, mergeLyric, lrcStamp, lyricFileText, lyricEmptyReason,
      renderLyric, syncLyric, loadLyric, lyricTextFor, lyricLineHtml,
      lines: () => lyricLines,
      setLines: (v) => { lyricLines = v; },
      setPayload: (p, id) => { lyricPayload = p; lyricPayloadFor = id; }
    };
  `);
  let seconds = 0;
  const warns = [];
  const api = factory(
    doc,
    (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    (t) => {
      const s = Math.max(0, Number(t) || 0);
      const m = Math.floor(s / 60);
      const rest = s - m * 60;
      return (m < 10 ? '0' : '') + m + ':' + (rest < 10 ? '0' : '') + rest.toFixed(0);
    },
    () => seconds,
    async (p) => {
      calls.push(p);
      const f = LYRIC_API[p];
      if (typeof f === 'function') return f();
      if (f) return f;
      const e = new Error('接口不存在：' + p);
      e.code = 404;
      throw e;
    },
    (...a) => warns.push(a),
    () => {},
    Blob
  );
  const setBox = () => {
    const root = parseHtml('<div id="nm3-lyric"></div>');
    box = root.children[0];
    box.scrollTo = (o) => { box.scrollTop = o && o.top; };
    box.clientHeight = 300;
    return box;
  };
  return {
    api, setBox, box: () => box, calls,
    setSeconds: (s) => { seconds = s; },
    warns
  };
}

(async () => {
  /* ── 1. parseLrc：多时间戳 / offset / 元数据行 ── */
  {
    const { api } = buildLyricApi();
    const multi = api.parseLrc('[00:01.00][00:02.50]同一句\n[ti:x]\n[by:y]\n[00:05]五秒');
    assert.strictEqual(multi.lines.length, 3, '多时间戳要展开成多行，元数据行要丢掉');
    assert.deepStrictEqual(multi.lines.map((l) => l.t), [1, 2.5, 5]);
    const off = api.parseLrc('[offset:+500]\n[00:10.00]词');
    assert.strictEqual(off.offset, 500);
    assert.strictEqual(off.lines[0].t, 9.5, '[offset:+500] 应当把歌词整体提前 0.5 秒');
    console.log('ok 1 LRC 解析：多时间戳 + offset + 元数据行');
  }

  /* ── 2. parseYrc：逐字时间轴（毫秒 → 秒），JSON 元数据行跳过 ── */
  {
    const { api } = buildLyricApi();
    const parsed = api.parseYrc('{"t":0,"c":[{"tx":"作词: "}]}\n' + YRC);
    assert.strictEqual(parsed.length, 1, 'JSON 元数据行要跳过');
    assert.strictEqual(parsed[0].t, 28.48);
    assert.strictEqual(parsed[0].chars.length, 16, '每个字一项');
    assert.strictEqual(parsed[0].chars[0].text, '我');
    assert.strictEqual(parsed[0].chars[1].t, 28.64);
    assert.strictEqual(parsed[0].text, '我带着比身体重的行李 游入尼罗河底', '整行文本由逐字拼回（保留空格）');
    console.log('ok 2 yrc 逐字解析');
  }

  /* ── 3. mergeLyric：翻译 / 罗马音挂行 + 逐字贴行 ── */
  {
    const { api } = buildLyricApi();
    const lines = api.mergeLyric(LRC, TLYRIC, ROMA, YRC);
    assert.strictEqual(lines.length, 15, '5 主行 × (1 主 + 1 译 + 1 罗)');
    assert.strictEqual(lines.filter((l) => !l.sub).length, 5);
    assert.strictEqual(lines.filter((l) => l.kind === 'trans').length, 5);
    assert.strictEqual(lines.filter((l) => l.kind === 'roma').length, 5);
    assert.strictEqual(lines[0].text, '夢ならばどれほどよかったでしょう');
    assert.strictEqual(lines[1].text, '如果这一切都是梦境该有多好', '翻译紧跟主行');
    assert.strictEqual(lines[1].sub, true);
    assert.strictEqual(lines[2].kind, 'roma');
    assert.ok(lines[1].t > lines[0].t && lines[1].t - lines[0].t < 0.01, '翻译时间戳挂在主行上');
    const withChars = lines.filter((l) => !l.sub && l.chars);
    assert.strictEqual(withChars.length, 1, '只有 00:28.480 那行有逐字');
    assert.strictEqual(withChars[0].chars.length, 16);

    // 翻译行数对不上（第三方歌词常见）：按时间就近挂
    const offbeat = api.mergeLyric('[00:10.00]A\n[00:20.00]B', '[00:10.30]甲\n[00:20.40]乙', '', '');
    assert.strictEqual(offbeat[1].text, '甲');
    assert.strictEqual(offbeat[3].text, '乙');
    // 行数一样就按顺序对齐：第三方翻译常整体偏移几十秒，只有对齐才对得上
    const same = api.mergeLyric('[00:10.00]A', '[00:40.00]整体偏移的一行翻译', '', '');
    assert.strictEqual(same.length, 2);
    assert.strictEqual(same[1].text, '整体偏移的一行翻译');
    // 行数对不上、时间又差得远 → 丢掉，不硬挂到错误的行上
    const stray = api.mergeLyric('[00:10.00]A\n[00:20.00]B', '[00:40.00]不相关', '', '');
    assert.strictEqual(stray.length, 2, '翻译对不上任何一行时应当被丢掉');
    // 没有翻译 / 罗马音时就是主行
    assert.strictEqual(api.mergeLyric('[00:01.00]只有主歌词', '', '', '').length, 1);
    console.log('ok 3 合并：翻译 / 罗马音 / 逐字');
  }

  /* ── 4. 渲染：主行 + 翻译 + 罗马音在同一组，逐字带 span ── */
  {
    const { api, setBox, box } = buildLyricApi();
    api.setLines(api.mergeLyric(LRC, TLYRIC, ROMA, YRC));
    setBox();
    api.renderLyric();
    const root = box();
    const groups = collect(root, '.nm3-lyric-grp');
    assert.strictEqual(groups.length, 5, '每组一行主歌词');
    assert.strictEqual(collect(groups[0], '.nm3-lyric-line').length, 3, '第一组：主 + 译 + 罗');
    assert.strictEqual(collect(groups[0], '.nm3-lyric-line.nm3-trans').length, 1);
    assert.strictEqual(collect(groups[0], '.nm3-lyric-line.nm3-roma').length, 1);
    assert.strictEqual(collect(groups[4], '.nm3-ch').length, 16, '最后一行有逐字 span');
    assert.strictEqual(groups[0].getAttribute('data-g'), '0');
    assert.ok(/data-act="seek"/.test(root.innerHTML) && /data-sec="/.test(root.innerHTML), '每行都能点着跳时间');
    console.log('ok 4 分组渲染 + 逐字 span');
  }

  /* ── 5. 同步：当前组点亮（翻译跟着亮）、逐字随播放点亮、往回拖会重置 ── */
  {
    const { api, setBox, box, setSeconds } = buildLyricApi();
    api.setLines(api.mergeLyric(LRC, TLYRIC, ROMA, YRC));
    setBox();
    api.renderLyric();
    const root = box();

    setSeconds(7.0);
    api.syncLyric();
    let cur = collect(root, '.nm3-lyric-grp.nm3-cur');
    assert.strictEqual(cur.length, 1);
    assert.strictEqual(cur[0].getAttribute('data-g'), '3', '第 2 行主歌词（每组 1 主 + 2 附，下标 3）应该亮着');
    assert.strictEqual(collect(cur[0], '.nm3-lyric-line.nm3-trans').length, 1, '翻译在同一组里一起亮');
    assert.ok(root.scrollTop > 0, '当前组要滚到可视区');

    // 逐字：28.48 开始那行，走到 29.1 秒应当点亮前三字
    setSeconds(29.1);
    api.syncLyric();
    cur = collect(root, '.nm3-lyric-grp.nm3-cur');
    assert.strictEqual(cur[0].getAttribute('data-g'), '12');
    const on = collect(cur[0], '.nm3-ch.nm3-ch-on');
    assert.strictEqual(on.length, 3, '28.48 / 28.64 / 29.06 三个字');
    const n1 = on.length;

    setSeconds(30.0);
    api.syncLyric();
    const n2 = collect(cur[0], '.nm3-ch.nm3-ch-on').length;
    assert.ok(n2 > n1, '时间往后走，点亮的字只增不减');

    setSeconds(28.5);
    api.syncLyric();
    assert.ok(collect(cur[0], '.nm3-ch.nm3-ch-on').length < n2, '往回拖之后不该还留着后面那些已点亮的字');

    setSeconds(1.0);
    api.syncLyric();
    const cur2 = collect(root, '.nm3-lyric-grp.nm3-cur');
    assert.strictEqual(cur2.length, 1);
    assert.strictEqual(cur2[0].getAttribute('data-g'), '0', '回到第一行');
    assert.strictEqual(collect(root, '.nm3-ch.nm3-ch-on').length, 0, '第一行没有逐字，不该有残留点亮');
    console.log('ok 5 时间轴同步 + 逐字点亮 + 往回拖重置');
  }

  /* ── 6. 双语 .lrc 文本 ── */
  {
    const { api } = buildLyricApi();
    const lines = api.mergeLyric(LRC, TLYRIC, '', '');
    const text = api.lyricFileText(lines, { name: 'Lemon', artists: '米津玄師', album: 'BOOTLEG' });
    const body = text.split('\n');
    assert.strictEqual(body[0], '[ti:Lemon]');
    assert.strictEqual(body[1], '[ar:米津玄師]');
    assert.strictEqual(body[2], '[al:BOOTLEG]');
    assert.ok(/\[by:网易云音乐·精简版\]/.test(text));
    const rows = body.filter((l) => /^\[\d\d:\d\d\.\d\d\d\]/.test(l));
    assert.strictEqual(rows.length, 10, '5 行主歌词 + 5 行翻译');
    assert.strictEqual(rows[0], '[00:00.851]夢ならばどれほどよかったでしょう');
    assert.strictEqual(rows[1], '[00:00.851]如果这一切都是梦境该有多好',
      '翻译与原文同一时间戳两行 —— 国内播放器按这个认双语');
    assert.strictEqual(api.lrcStamp(65.5), '01:05.500');
    assert.strictEqual(api.lrcStamp(5.25), '00:05.250');
    console.log('ok 6 双语 .lrc 文本');
  }

  /* ── 7. 空歌词的说法 + v1 不可用时回退老接口 ── */
  {
    const { api } = buildLyricApi();
    assert.strictEqual(api.lyricEmptyReason({ sgc: true }), '纯音乐，请欣赏');
    assert.strictEqual(api.lyricEmptyReason({ uncollected: true }), '歌词还在收集，暂时没有');
    assert.strictEqual(api.lyricEmptyReason(null), '这首歌暂时没有歌词');

    LYRIC_API = {
      '/api/song/lyric/v1': () => { const e = new Error('接口不存在'); e.code = 404; throw e; },
      '/api/song/lyric': { lrc: { lyric: LRC }, tlyric: { lyric: TLYRIC } }
    };
    const t = buildLyricApi();
    await t.api.loadLyric(123);
    assert.deepStrictEqual(t.calls, ['/api/song/lyric/v1', '/api/song/lyric'], 'v1 拿不到要退回老接口');
    assert.strictEqual(t.api.lines().length, 10, '退回老接口也要有歌词（翻译照挂）');
    LYRIC_API = {};
    console.log('ok 7 空歌词说法 + 接口回退');
  }

  /* ═══════════════════ 点赞 / 收藏 ═══════════════════ */

  function buildLikeApi(opts) {
    const o = opts || {};
    const server = { liked: new Set(o.liked || []) };
    const block = slice('  async function ensureLikedSet(force) {', '  function openArtist(id) {');
    const prelude = `
      let likedSet = null, likedFor = null, likedBusy = false, likeBusy = false;
      const likeLog = [];
      let cmHot = [], cmList = [], cmSongId = null, curTrackId = 123;
      const CLIENT_SIGN = { os: 'pc', appver: '8.9.70', channel: 'netease', osver: '10.0.19045' };
    `;
    const factory = new Function(
      'document', 'window', 'fetch', 'apiGet', 'getUid', 'nowPlaying', 'forwardCtl',
      'updateControlsUi', 'fmtCount', 'toast', 'warn', 'URLSearchParams',
      prelude + block + `
      return { doLike, postCommentLike, postRadioLike, likeComment, likeFailText, likedIdsOf,
               ensureLikedSet, isLiked, log: () => likeLog,
               setComments: (sid) => { cmSongId = sid; }, setHot: (h) => { cmHot = h; } };
    `);

    const fetched = [];
    const toasts = [];
    const warns = [];
    const subscribeCalls = [];
    const btn = {
      attrs: {}, _cls: new Set(),
      getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      classList: {
        add: (c) => btn._cls.add(c), remove: (c) => btn._cls.delete(c),
        toggle: (c, on) => { if (on) btn._cls.add(c); else btn._cls.delete(c); },
        contains: (c) => btn._cls.has(c)
      },
      querySelector: () => null
    };
    const doc = { getElementById: () => btn, cookie: '__csrf=dummy' };
    const win = { top: {} };
    if (o.nativeWorks) {
      win.top.subscribe = (track) => { server.liked.add(String(track.id)); subscribeCalls.push(String(track.id)); };
    } else if (o.nativeExists) {
      win.top.subscribe = () => { subscribeCalls.push('noop'); };
    }

    const fetchStub = async (p, init) => {
      const params = new URLSearchParams(init && init.body);
      const asObj = {};
      params.forEach((v, k) => { asObj[k] = v; });
      fetched.push({ path: p, body: params });
      const reply = o.reply ? o.reply(p, asObj, server) : { code: 200 };
      return { ok: true, status: 200, json: async () => reply };
    };

    const apiGetStub = async (p, params) => {
      if (p === '/api/user/playlist') {
        return o.noPlaylist ? { playlist: [] } : { playlist: [{ id: 501, specialType: 5 }] };
      }
      if (p === '/api/v6/playlist/detail') {
        const ids = Array.from(server.liked).map((id) => ({ id: Number(id) }));
        if (o.trackIdsBroken) {
          if (params.n === 1) return { playlist: {} };
          return { playlist: { tracks: ids.map((x) => ({ id: x.id, name: 'x' })) } };
        }
        return { playlist: { trackIds: ids } };
      }
      return {};
    };

    const api = factory(
      doc, win, fetchStub, apiGetStub,
      async () => (o.notLoggedIn ? null : 777),
      () => ({ track: { id: o.trackId || 999, name: '测试歌' } }),
      () => { subscribeCalls.push('forwardCtl'); return true; },
      () => {}, (n) => String(n),
      (m) => toasts.push(m), (...a) => warns.push(a),
      URLSearchParams
    );
    return { api, fetched, toasts, warns, server, subscribeCalls, btn };
  }

  /* ── 8. 评论点赞：路径、参数、type 的语义 ── */
  {
    const h = buildLikeApi({ reply: () => ({ code: 200 }) });
    const res = await h.api.postCommentLike(186016, 987654321, 1);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(h.fetched[0].path, '/api/v1/comment/like');
    assert.strictEqual(h.fetched[0].body.get('threadId'), 'R_SO_4_186016');
    assert.strictEqual(h.fetched[0].body.get('commentId'), '987654321');
    assert.strictEqual(h.fetched[0].body.get('type'), '0', 'type 是资源类型（0=歌曲），不是点赞开关');
    assert.strictEqual(h.fetched[0].body.get('csrf_token'), 'dummy');

    const h2 = buildLikeApi({ reply: () => ({ code: 200 }) });
    await h2.api.postCommentLike(186016, 5, 0);
    assert.strictEqual(h2.fetched[0].path, '/api/v1/comment/unlike', '取消点赞走 /unlike');
    assert.strictEqual(h2.fetched.length, 1);

    // 取消那条路不通（服务端只认 /like + type=0）→ 自动换口径重试一次
    const h3 = buildLikeApi({ reply: (p) => (p === '/api/v1/comment/unlike' ? { code: 400 } : { code: 200 }) });
    const r3 = await h3.api.postCommentLike(186016, 5, 0);
    assert.strictEqual(r3.code, 200);
    assert.deepStrictEqual(h3.fetched.map((f) => f.path),
      ['/api/v1/comment/unlike', '/api/v1/comment/like']);

    assert.ok(/登录/.test(h3.api.likeFailText({ code: 301 })));
    assert.ok(/风控/.test(h3.api.likeFailText({ code: -460, msg: '检测到您的网络环境存在风险' })));
    assert.ok(/参数/.test(h3.api.likeFailText({ code: 400, msg: '参数错误' })));
    assert.ok(h3.api.log().length >= 1, '每次写操作都要留诊断');
    console.log('ok 8 评论点赞：/like + /unlike + type=0 + 诊断');
  }

  /* ── 9. 评论点赞的 UI 更新（成功才动数字） ── */
  {
    const mkBtn = () => {
      const b = {
        attrs: { 'data-cid': '55', 'data-ci': 'h0', 'data-liked': '0', 'data-n': '7' },
        _cls: new Set(),
        getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        classList: {
          add: (c) => b._cls.add(c), remove: (c) => b._cls.delete(c),
          toggle: (c, on) => { if (on) b._cls.add(c); else b._cls.delete(c); },
          contains: (c) => b._cls.has(c)
        },
        querySelector: () => null
      };
      return b;
    };
    const h = buildLikeApi({ reply: () => ({ code: 200 }) });
    h.api.setComments(186016);
    h.api.setHot([{ commentId: 55, liked: false, likedCount: 7 }]);
    const b = mkBtn();
    await h.api.likeComment(b);
    assert.strictEqual(b.attrs['data-liked'], '1');
    assert.strictEqual(b.attrs['data-n'], '8');

    const h2 = buildLikeApi({ reply: () => ({ code: -460, msg: '风控' }) });
    h2.api.setComments(186016);
    const b2 = mkBtn();
    await h2.api.likeComment(b2);
    assert.strictEqual(b2.attrs['data-n'], '7', '失败时数字不能假装加上了');
    assert.strictEqual(b2.attrs['data-liked'], '0');
    assert.ok(/风控/.test(h2.toasts[h2.toasts.length - 1]));
    console.log('ok 9 点赞 UI：成功才动数字，失败说原因');
  }

  /* ── 10. 收藏：接口参数 ── */
  {
    const h = buildLikeApi({ reply: () => ({ code: 301 }) });
    await h.api.postRadioLike(186016, true);
    const q = h.fetched[0];
    assert.strictEqual(q.path, '/api/radio/like');
    assert.strictEqual(q.body.get('alg'), 'itembased');
    assert.strictEqual(q.body.get('trackId'), '186016');
    assert.strictEqual(q.body.get('like'), 'true');
    assert.strictEqual(q.body.get('time'), '3', "time 是站点写死的 '3'，不是毫秒时间戳");
    assert.strictEqual(q.body.get('csrf_token'), 'dummy');
    assert.strictEqual(q.body.get('os'), 'pc', '带客户端姿态（实测不带会被 -460 风控）');
    await h.api.postRadioLike(186016, false);
    assert.strictEqual(h.fetched[1].body.get('like'), 'false', "只有字符串 'false' 才是取消收藏");
    console.log('ok 10 收藏接口参数（alg/trackId/like/time=3/csrf/客户端姿态）');
  }

  /* ── 11. 收藏全流程：成功 / 接口失败退站点 / 全失败说人话 ── */
  {
    // a) 接口成功 → 状态真的变成已收藏 → 报成功
    const ok = buildLikeApi({
      reply: (p, body, server) => { server.liked.add(body.trackId); return { code: 200 }; }
    });
    await ok.api.doLike();
    assert.ok(ok.server.liked.has('999'), '接口成功应当把歌加进「我喜欢的音乐」');
    assert.ok(/已收藏/.test(ok.toasts[ok.toasts.length - 1]), '成功提示：' + ok.toasts[ok.toasts.length - 1]);
    assert.strictEqual(ok.subscribeCalls.length, 0, '接口成功就不用劳烦站点');

    // b) 接口被风控 → 退回复用站点 subscribe（它就是播放条那个 ♡）→ 成功
    const fallback = buildLikeApi({
      nativeWorks: true,
      reply: () => ({ code: -460, msg: '检测到您的网络环境存在风险' })
    });
    await fallback.api.doLike();
    assert.strictEqual(fallback.subscribeCalls.length, 1, '要退回复用站点自己的收藏入口');
    assert.ok(fallback.server.liked.has('999'));
    assert.ok(/已收藏/.test(fallback.toasts[fallback.toasts.length - 1]));

    // c) 两条路都不成 → 不能假装成功，要说原因并留诊断
    const fail = buildLikeApi({ nativeExists: true, reply: () => ({ code: -460, msg: '风控' }) });
    await fail.api.doLike();
    const last = fail.toasts[fail.toasts.length - 1];
    assert.ok(/风控/.test(last), '失败提示要带原因：' + last);
    assert.ok(!fail.server.liked.has('999'), '失败时状态不能变');
    assert.ok(fail.api.log().some((x) => x.tag === 'radio-like' && x.code === -460), '要有诊断留痕');

    // d) 未登录：接口回 301 → 提示先登录
    const nologin = buildLikeApi({ notLoggedIn: true, reply: () => ({ code: 301 }) });
    await nologin.api.doLike();
    assert.ok(/登录/.test(nologin.toasts[nologin.toasts.length - 1]));

    // e) 已收藏的歌点一下 = 取消收藏
    const unlike = buildLikeApi({
      liked: ['999'],
      reply: (p, body, server) => {
        if (body.like === 'false') server.liked.delete(body.trackId);
        else server.liked.add(body.trackId);
        return { code: 200 };
      }
    });
    await unlike.api.doLike();
    assert.strictEqual(unlike.fetched[0].body.get('like'), 'false', '已经收藏过的应当是取消');
    assert.ok(!unlike.server.liked.has('999'));
    assert.ok(/已取消收藏/.test(unlike.toasts[unlike.toasts.length - 1]));
    console.log('ok 11 收藏全流程：接口 → 站点入口 → 状态校验 → 说人话');
  }

  /* ── 12. 收藏集合：trackIds 优先，缺了就退 tracks ── */
  {
    const h = buildLikeApi({ trackIdsBroken: true, liked: ['1', '2', '3'] });
    await h.api.ensureLikedSet(true);
    assert.strictEqual(h.api.isLiked(2), true, 'trackIds 为空时要退回 tracks 取到完整集合');
    const h2 = buildLikeApi({ liked: ['9'] });
    await h2.api.ensureLikedSet(true);
    assert.strictEqual(h2.api.isLiked(9), true);
    assert.strictEqual(h2.api.isLiked(8), false);
    assert.deepStrictEqual(h2.api.likedIdsOf({ trackIds: [{ id: 1 }], tracks: [{ id: 2 }] }), ['1']);
    assert.deepStrictEqual(h2.api.likedIdsOf({ tracks: [{ id: 2 }] }), ['2']);
    console.log('ok 12 收藏集合：trackIds → tracks 回退');
  }

  /* ── 13. 下载附带歌词：内容双语，且不带罗马音 ── */
  {
    const { api } = buildLyricApi();
    api.setPayload({
      lrc: { lyric: LRC }, tlyric: { lyric: TLYRIC },
      romalrc: { lyric: ROMA }, yrc: { lyric: YRC }
    }, 123);
    const text = await api.lyricTextFor({ id: 123, name: 'Lemon', artists: '米津玄師', album: 'BOOTLEG' });
    assert.ok(/\[ti:Lemon\]/.test(text));
    assert.strictEqual(text.split('\n').filter((l) => /^\[\d\d:/.test(l)).length, 10, '文件里是原文 + 翻译成对');
    assert.ok(!/yu me na ra/.test(text), '罗马音不进 .lrc（三行会互相打架）');
    console.log('ok 13 下载用歌词文本');
  }

  console.log('\n全部通过');
})().catch((e) => {
  console.error('FAILED:', (e && e.message) ? e.message.split('\n').filter(Boolean).join(' / ') : e);
  process.exit(1);
});
