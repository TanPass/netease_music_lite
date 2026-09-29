/* 封面 / 点行播放 / 歌手详情（全部歌曲 + 专辑）—— 回归测试
 *
 * 这一套盯的是三类真实缺陷：
 *
 *   ① 封面（pic / imgHtml / onCoverError）
 *      约 13% 的歌单封面自带一长串 imageView ops（站点给自定义封面做的服务端合成：
 *      底图是模糊占位，真封面作为 watermark 合上去）。以前一律拼 `&param=WxH`，
 *      而合成 URL 会**忽略** param —— 于是列表里每次去下 800×800 的大图
 *      （实测单张 0.5~1.1 MB），慢到看着就是「这些歌单没有封面」。
 *      正确做法：尺寸追加在 ops 链末尾（末尾那段本来就是个空操作）。
 *      同时：整串 query 绝不能丢（丢了只剩模糊底图），已有 param 要改写不要叠加。
 *
 *   ② 点行播放（listOf / playTrackAt / onPanelClick）
 *      搜索结果与详情页共用同一套曲目行，但对应不同数组。以前不管行属于哪一份、
 *      点下去一律播 detail.tracks —— 于是「搜索页点歌，播出来的是上次那个歌单」。
 *
 *   ③ 歌手详情（loadArtistMore / setArtistTab / 详情栈）
 *      以前只有 /api/artist/top/song（热门 50 首），看不到全部歌曲和专辑；
 *      现在全部歌曲 / 专辑都能翻页，而且「歌手 → 专辑 → 返回」要能回歌手页。
 *
 * 用法：node netease-music-lite.cover-artist.test.cjs
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

/* ── 真实抓到的合成封面 URL（歌单 2800713929，实测 1.1 MB 那张） ── */
const COMPOSITE = 'http://p1.music.163.net/efUk62-O69YKLJ51Gguhrw==/109951173960223962.jpg'
  .replace('.163.net', '.126.net') +
  '?imageView=1&thumbnail=800y800&enlarge=1%7CimageView=1&watermark&type=1' +
  '&image=b2JqL3dvbkRsc0tVd3JMQ2xHakNtOEt4LzI3NjEwNDk3MDYyLnBuZw==&dx=0&dy=0%7CimageView=1';
const PLAIN = 'http://p1.music.126.net/WFQ4EKF5QabD33U3NUOPWQ==/109951169535051638.jpg';

const eq = (a, b, msg) => assert.strictEqual(a, b, msg);

/* ═══════════════════ 封面 ═══════════════════ */

function buildPic() {
  const block = slice('  function pic(url, size) {', '  /**\n   * 同源 GET JSON（自动带上登录 Cookie）。');
  const factory = new Function('esc', block +
    '\n return { pic, rawPic, DEAD_COVER, imgHtml, onCoverError };');
  return factory((v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
}

(async () => {

/* ── 1. pic()：合成封面要拿到真尺寸，普通封面照旧 ── */
{
  const { pic, rawPic } = buildPic();

  eq(pic('', 300), '', '空地址不拼参数');
  eq(pic(PLAIN, 300),
    'https://p1.music.126.net/WFQ4EKF5QabD33U3NUOPWQ==/109951169535051638.jpg?param=300y300',
    '普通封面：http→https + ?param=');

  const c = pic(COMPOSITE, 300);
  assert.ok(/^https:\/\//.test(c), '合成封面也要升成 https');
  assert.ok(c.indexOf('imageView=1') > 0, '★ 合成那串 query 不能丢（丢了只剩模糊底图）');
  assert.ok(/&image=[^&]+/.test(c), '★ watermark 的 image 参数必须原样保留');
  assert.ok(/&thumbnail=300y300$/.test(c), '尺寸要追加在 ops 链**末尾**才生效：' + c);
  assert.ok(!/param=/.test(c), '合成封面不该再拼 param（会被忽略）');
  assert.ok(/thumbnail=800y800/.test(c), '★ 前面那个 thumbnail=800y800 不能改写（改了就丢合成）');

  // 万一 CDN 换成别的收尾（没有末尾的空操作）也能补一个 op 进去
  const other = COMPOSITE.replace('%7CimageView=1', '%7Cwatermark&type=1');
  const o = pic(other, 200);
  assert.ok(/%7CimageView=1&thumbnail=200y200$/.test(o), '非标准收尾要新起一个 op：' + o);

  // 已经有 param 的：改写，不要拼第二份
  const hasParam = 'https://p1.music.126.net/x.jpg?param=999y999';
  eq(pic(hasParam, 300), 'https://p1.music.126.net/x.jpg?param=300y300', 'param 要改写而不是叠加');

  // 只有 thumbnail 的（少见）：同样改写
  const hasThumb = 'https://p1.music.126.net/x.jpg?thumbnail=999y999';
  eq(pic(hasThumb, 300), 'https://p1.music.126.net/x.jpg?thumbnail=300y300', 'thumbnail 要改写');

  eq(rawPic(PLAIN), PLAIN.replace('http://', 'https://'), 'rawPic 只做 http→https');
  eq(rawPic(''), '', 'rawPic 空值安全');
  console.log('ok 1 pic()：合成封面拿尺寸 / param 改写 / query 不丢');
}

/* ── 2. imgHtml + onCoverError：一张封面永远不该是空白或破图 ── */
{
  const { pic, imgHtml, onCoverError, DEAD_COVER } = buildPic();

  eq(imgHtml('', 300), '', '没地址就不渲染 img');
  const html = imgHtml(COMPOSITE, 220);
  assert.ok(/^<img src="/.test(html), '要渲染 img');
  assert.ok(/data-nm3raw="/.test(html), '★ 要留一份站点原图用于兜底');
  assert.ok(/loading="lazy"/.test(html), '列表封面懒加载');
  assert.ok(!/&(?!amp;|quot;|lt;|gt;|#39;)/.test(html), '属性里的 & 必须转义');
  const extra = imgHtml(PLAIN, 80, 'class="abc"');
  assert.ok(/class="abc"/.test(extra) && /param=80y80/.test(extra), '额外属性要拼进去');

  // 加载失败 → 先回退站点原图 → 再不行换占位图（不会再循环）
  const attrs = {};
  const img = {
    tagName: 'IMG',
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; }
  };
  attrs.src = pic(COMPOSITE, 220);
  attrs['data-nm3raw'] = COMPOSITE.replace('http://', 'https://');
  onCoverError({ target: img });
  eq(attrs.src, attrs['data-nm3raw'] || COMPOSITE.replace('http://', 'https://'), '第一次失败退回站点原图');
  onCoverError({ target: img });
  eq(attrs.src, DEAD_COVER, '原图也失败才换占位图');
  eq(attrs['data-nm3raw'], undefined, '兜底用完要清掉标记，避免死循环');
  onCoverError({ target: { tagName: 'DIV' } });   // 非 img 不炸
  onCoverError({});
  console.log('ok 2 imgHtml / onCoverError：原图兜底 → 占位图');
}

/* ═══════════════════ 点行播放 ═══════════════════ */

/* ── 3. trackListHtml 把 data-list 写进 DOM，并登记对应数组 ── */
{
  const block = slice('  function trackListHtml(list, opts) {', '  /** 某个列表键当前对应的数组');
  const lists = {};
  const factory = new Function('TRACK_LISTS', 'nowPlaying', 'trackRow', 'esc',
    block + '\n return { trackListHtml };');
  const { trackListHtml } = factory(lists, () => null, (i) => '<i data-i="' + i + '"></i>',
    (v) => String(v));
  const songs = [{ id: 1 }, { id: 2 }];
  const html = trackListHtml(songs, { list: 'search' });
  assert.ok(/data-list="search"/.test(html), '容器要标出这份列表属于谁：' + html);
  eq(lists.search, songs, '要登记进 TRACK_LISTS');
  assert.ok(/data-i="1"/.test(html), '行号照旧');
  console.log('ok 3 trackListHtml：data-list + 数组登记');
}

/* ── 4. listOf / playTrackAt：搜索行只能播搜索结果（★ 就是那个 bug） ── */
function buildRowPlay(state) {
  const block = slice('  /** 某个列表键当前对应的数组', '  function updateCurrentRows(hostId, list) {');
  const played = [];
  const factory = new Function('TRACK_LISTS', 'searchData', 'detail', 'playList', 'toast',
    'refreshCurrentSoon',
    block + '\n return { listOf, playTrackAt };');
  const api = factory(state.lists, state.searchData, state.detail,
    (list, i) => { played.push({ list: list, i: i }); return true; },
    () => {}, () => {});
  return { api, played };
}

{
  const searchSongs = [{ id: 11, name: '搜索结果一' }, { id: 12, name: '搜索结果二' }];
  const detailTracks = [{ id: 91, name: '上次歌单第一首' }, { id: 92, name: '上次歌单第二首' }];
  const state = {
    lists: {},
    searchData: { songs: searchSongs },
    detail: { kind: 'playlist', tracks: detailTracks }
  };
  const { api, played } = buildRowPlay(state);

  eq(api.listOf('search'), searchSongs, 'search 键要实时读 searchData.songs');
  eq(api.listOf('detail'), detailTracks, 'detail 键读 detail.tracks');

  api.playTrackAt('search', 1);
  eq(played.length, 1);
  eq(played[0].list, searchSongs, '★ 搜索页点第 2 行必须播搜索结果里的第 2 首');
  eq(played[0].i, 1, '序号不能错位');

  api.playTrackAt('detail', 0);
  eq(played[1].list, detailTracks, '详情页点行还是播详情那份');

  // 详情已经被清掉（换关键词）时，不能退回去播空/旧数组
  state.detail.tracks = [];
  eq(api.playTrackAt('detail', 0), false, '没有那一行就不该播');
  eq(played.length, 2, '不该多发一次播放');
  console.log('ok 4 playTrackAt：搜索行播搜索结果，不会再播到上次歌单');
}

/* ── 5. onPanelClick 按容器的 data-list 分派（接线对了才有效） ── */
{
  const block = slice('  function onPanelClick(e) {', '  function doLogin() {');
  const calls = [];
  const factory = new Function('FORWARD_ACTS', 'doAction', 'playTrackAt', 'openItem',
    block + '\n return { onPanelClick };');
  const { onPanelClick } = factory({}, () => {}, (key, i) => calls.push(['play', key, i]),
    (kind, id) => calls.push(['open', kind, id]));

  const row = { getAttribute: (k) => (k === 'data-i' ? '3' : null) };
  const wrap = { getAttribute: (k) => (k === 'data-list' ? 'search' : null) };
  row.closest = (sel) => (sel === '.nm3-tracks' ? wrap : null);
  const target = { closest: (sel) => (sel === '.nm3-track' ? row : null) };
  onPanelClick({ target: target, stopPropagation: () => {} });
  eq(calls.length, 1);
  eq(calls[0].join(','), 'play,search,3', '★ 必须按行所在容器的 data-list 播');

  // 没有容器信息时退回 detail（老 DOM / 兜底）
  const row2 = { getAttribute: () => '0', closest: () => null };
  onPanelClick({ target: { closest: (s) => (s === '.nm3-track' ? row2 : null) }, stopPropagation: () => {} });
  eq(calls[1].join(','), 'play,detail,0', '没有 data-list 时兜底到 detail');

  // 搜索结果渲染时必须真的标成 search（源码级接线）
  assert.ok(/trackListHtml\(list, \{ list: 'search' \}\)/.test(src),
    'renderSearch 的单曲列表要标 data-list=search');
  console.log('ok 5 onPanelClick：读容器 data-list 分派');
}

/* ═══════════════════ 歌手详情：全部歌曲 + 专辑 ═══════════════════ */

/* ── 6. loadArtistMore / setArtistTab ── */
function buildArtist(state) {
  const block = slice('  async function setArtistTab(nextTab) {', '  function renderCurrent() {');
  const calls = [];
  const factory = new Function('detail', 'apiGet', 'CONFIG', 'warn', 'toast', 'renderCurrent',
    block + '\n return { setArtistTab, loadArtistMore };');
  const api = factory(state.detail, state.apiGet, { ARTIST_PAGE: 50, ARTIST_ALBUM_PAGE: 30 },
    () => {}, (m) => calls.push(['toast', m]), () => calls.push(['render']));
  return { api, calls };
}

{
  const songPage = (offset) => ({
    songs: Array.from({ length: offset >= 100 ? 6 : 50 }, (_, i) => ({ id: offset + i, name: 's' + (offset + i) })),
    more: offset < 100,
    total: 106
  });
  const albumPage = (offset) => ({
    hotAlbums: Array.from({ length: offset >= 30 ? 14 : 30 }, (_, i) => ({ id: 'a' + (offset + i), name: 'alb' })),
    more: offset < 30
  });
  const state = {
    detail: {
      active: true, kind: 'artist', id: 6452, artistTab: 'songs',
      tracks: Array.from({ length: 50 }, (_, i) => ({ id: i, name: 's' + i })),
      tracksMore: true, tracksTotal: 106,
      albums: [], albumsMore: false, listBusy: false, busy: false, error: null
    },
    apiGet: async (p, params) => {
      calls.push([p, params.offset]);
      if (p === '/api/v1/artist/songs') return songPage(params.offset);
      if (p === '/api/artist/albums/6452') return albumPage(params.offset);
      throw new Error('未预期的接口 ' + p);
    }
  };
  const calls = [];
  const { api } = buildArtist(state);

  // 第一次「加载更多」：50 → 100，还有下一页
  await api.loadArtistMore();
  eq(state.detail.tracks.length, 100, '全部歌曲要能翻页累加');
  eq(state.detail.tracksMore, true, '还有下一页时要留着 more');
  eq(state.detail.tracksTotal, 106, '总数照接口给的来');
  eq(calls[0].join(','), '/api/v1/artist/songs,50', '第二页按 offset=已加载数取');

  // 第二页之后没有更多了
  await api.loadArtistMore();
  eq(state.detail.tracks.length, 106, '最后一页也要收下');
  eq(state.detail.tracksMore, false, 'more=false 时按钮要消失');
  const before = calls.length;
  await api.loadArtistMore();
  eq(calls.length, before, '没有更多时不该再打接口');

  // 切到「专辑」页签才第一次拉专辑
  eq(state.detail.albums.length, 0, '默认停在全部歌曲');
  await api.setArtistTab('albums');
  eq(state.detail.artistTab, 'albums');
  eq(state.detail.albums.length, 30, '切到专辑页签才拉专辑');
  eq(calls[calls.length - 1].join(','), '/api/artist/albums/6452,0', '专辑从 offset=0 开始');

  // 专辑也能「加载更多」
  await api.loadArtistMore();
  eq(state.detail.albums.length, 44, '专辑要能翻页累加');
  eq(state.detail.albumsMore, false, '专辑取完就不再有更多');

  // 切回全部歌曲不会重新拉
  const c2 = calls.length;
  await api.setArtistTab('songs');
  eq(state.detail.artistTab, 'songs');
  eq(calls.length, c2, '切回已加载过的页签不该重新请求');
  console.log('ok 6 歌手详情：全部歌曲 / 专辑分页 + 页签懒加载');
}

/* ── 7. 详情栈：歌手 → 专辑 → 返回 能回歌手；换关键词时彻底清干净 ── */
{
  const snapBlock = slice('  function snapshotDetail() {', '  function openItem(kind, id, autoPlay) {');
  const closeBlock = slice('  function deactivateDetail() {', '  async function setArtistTab(nextTab) {');
  const factory = new Function('initial', 'renderCurrent',
    'let detailStack = [];\nlet detail = initial;\n' + snapBlock + closeBlock +
    '\n return { snapshotDetail, closeDetail, deactivateDetail,' +
    ' get: () => detail, set: (d) => { detail = d; }, stack: () => detailStack };');
  const renders = [];
  const api = factory({ active: false, tracks: [], albums: [] }, () => renders.push(1));

  const artist = {
    active: true, owner: 'search', kind: 'artist', id: 6452, title: '周杰伦',
    cover: '', sub: '', brief: 'b', briefOpen: false, artistTab: 'songs',
    tracks: [{ id: 1 }], tracksMore: true, tracksTotal: 566,
    albums: [{ id: 'a1' }], albumsMore: true, busy: false, listBusy: false, error: null
  };
  api.set(artist);
  const snap = api.snapshotDetail();
  assert.ok(snap, '活着的详情才有快照');
  assert.notStrictEqual(snap.tracks, artist.tracks, '快照要拷贝数组，别被后面的翻页带着改');
  api.stack().push(snap);

  // 用户点进专辑
  api.set({
    active: true, owner: 'search', kind: 'album', id: 274336916, title: '即兴曲',
    cover: '', sub: '', brief: '', briefOpen: false, artistTab: 'songs',
    tracks: [{ id: 2 }], tracksMore: false, tracksTotal: 1,
    albums: [], albumsMore: false, busy: false, listBusy: false, error: null
  });

  api.closeDetail();
  eq(api.get().kind, 'artist', '★ 从专辑返回要回到歌手页');
  eq(api.get().title, '周杰伦');
  eq(api.get().tracksTotal, 566, '歌手页的状态（总数 / more）要原样回来');
  eq(api.stack().length, 0, '栈用完要清空');

  api.closeDetail();
  eq(api.get().active, false, '没有上一页时才真的退出详情');

  // 歌手页 → 专辑 → 换关键词搜索：必须彻底清掉，否则点行会播到旧数组
  api.set(artist);
  api.stack().push(api.snapshotDetail());
  api.deactivateDetail();
  eq(api.get().active, false);
  eq(api.get().tracks.length, 0, '★ 换关键词要连曲目一起清掉（点行播错歌的燃料）');
  eq(api.get().albums.length, 0);
  eq(api.stack().length, 0, '★ 详情栈也要一起丢');
  assert.ok(renders.length >= 2, '返回 / 退出都要重绘（实际 ' + renders.length + ' 次）');
  eq(api.snapshotDetail(), null, '没开着详情时不要产生快照');
  console.log('ok 7 详情栈：歌手 ↔ 专辑 返回；换关键词彻底清干净');
}

/* ── 8. 歌手详情接的是新接口（源码级接线） ── */
{
  assert.ok(/'\/api\/v1\/artist\/songs'/.test(src) || /apiGet\('\/api\/v1\/artist\/songs'/.test(src),
    '全部歌曲要走 /api/v1/artist/songs');
  assert.ok(/'\/api\/artist\/albums\/'/.test(src) || /apiGet\('\/api\/artist\/albums\/'/.test(src),
    '专辑要走 /api/artist/albums/<id>（v1 那个路由是 404）');
  assert.ok(/'artist-tab'/.test(src) && /'artist-more'/.test(src), 'data-act 要接进 ACTIONS');
  assert.ok(/\{ playlist: '歌单', album: '专辑', artist: '歌手' \}/.test(src),
    '歌手详情头不该再写「歌手热门」');
  assert.ok(/ARTIST_PAGE: 50/.test(src) && /ARTIST_ALBUM_PAGE: 30/.test(src), '每页条数可调');
  console.log('ok 8 歌手详情：接口与 ACTION 接线');
}

/* ── 9. detailHtml() 真的渲染出来（歌手：页签 / 全部歌曲 / 专辑 / 加载更多） ── */
function tagsBalanced(html) {
  const VOID = { img: 1, br: 1, hr: 1, input: 1, meta: 1, link: 1, path: 1, circle: 1, rect: 1, line: 1, polyline: 1 };
  const stack = [];
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[2].toLowerCase();
    if (VOID[tag] || /\/>$/.test(m[0])) continue;
    if (m[1] === '/') { if (stack.pop() !== tag) return false; }
    else stack.push(tag);
  }
  return stack.length === 0;
}

function buildDetailRender() {
  const picBlock = slice('  function pic(url, size) {', '  /**\n   * 同源 GET JSON（自动带上登录 Cookie）。');
  const stateBlock = slice('  function stateBlock(title, sub, opts) {', '  /** 统一的曲目行');
  const trackRow = slice('  function trackRow(i, song, o) {', '  /**\n   * 曲目列表。');
  const trackList = slice('  const TRACK_LISTS = {};', '  /** 某个列表键当前对应的数组');
  const albumCard = slice('  function albumCard(a) {', '  /* ═══════════════════════════ 共用详情');
  const brief = slice('  function briefHtml() {', '  /** 歌手详情的「全部歌曲 / 专辑」页签');
  const detailBlock = slice('  /** 歌手详情的「全部歌曲 / 专辑」页签（挂在详情头下面） */',
    '  /* ═══════════════════════════ 播放');

  const factory = new Function(
    'detail', 'esc', 'nowPlaying', 'albumOf', 'artistsOf', 'artistLinksHtml', 'fmtDuration',
    'fmtCount', 'SVG', 'INK',
    picBlock + stateBlock + trackRow + trackList + albumCard + brief + detailBlock +
    '\n return { detailHtml, artistTabsHtml, moreHtml };'
  );
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const detail = {
    active: true, owner: 'search', kind: 'artist', id: 6452, title: '周杰伦',
    cover: PLAIN, sub: 'Jay Chou', brief: '简介文本', briefOpen: false, artistTab: 'songs',
    tracks: [
      { id: 1, name: '即兴曲', album: { id: 9, name: '即兴曲', picUrl: PLAIN }, artists: [{ id: 6452, name: '周杰伦' }], duration: 99000 },
      { id: 2, name: 'Six Degrees', album: { id: 10, name: 'SD', picUrl: PLAIN }, artists: [{ id: 6452, name: '周杰伦' }], duration: 194000 }
    ],
    tracksMore: true, tracksTotal: 566,
    albums: [{ id: 274336916, name: '即兴曲', picUrl: PLAIN, size: 1, artist: { name: '周杰伦' } }],
    albumsMore: false, busy: false, listBusy: false, error: null
  };
  const api = factory(detail, esc, () => null,
    (s) => s.album || {}, (s) => (s.artists || []).map((a) => a.name).join(' / '),
    (s) => (s.artists || []).map((a) => a.name).join(' / '),
    (ms) => '01:39', (n) => String(n),
    { back: () => '<svg></svg>', play: () => '<svg></svg>' }, '#0B0E19');
  return { detail, api, esc };
}

{
  const { detail, api } = buildDetailRender();

  const songsView = api.detailHtml();
  assert.ok(/class="nm3-dh"/.test(songsView), '要有详情头');
  assert.ok(/nm3-dh-tabs/.test(songsView), '歌手详情要有页签');
  assert.ok(/data-act="artist-tab" data-tab="songs"[^>]*class="nm3-on"|class="nm3-on"[^>]*data-tab="songs"/.test(songsView),
    '默认选中「全部歌曲」：' + songsView.slice(0, 400));
  assert.ok(/全部歌曲/.test(songsView) && /专辑/.test(songsView), '两个页签都在');
  assert.ok(/566/.test(songsView), '页签/头上要显示总数');
  assert.ok(/data-act="artist-more"/.test(songsView), '还有下一页时要给「加载更多」');
  assert.ok(/data-list="detail"/.test(songsView), '全部歌曲列表要标 detail');
  assert.ok(/data-i="1"/.test(songsView), '两首歌都要渲染成行');
  assert.ok(/&#39;|&amp;/.test(songsView) || songsView.indexOf("'") < 0, '文本要转义');
  assert.ok(tagsBalanced(songsView), '全部歌曲视图标签要闭合');

  // 取完最后一页：按钮要消失
  detail.tracksMore = false;
  assert.ok(!/data-act="artist-more"/.test(api.detailHtml()), '没有下一页就不该出现按钮');

  // 切到专辑页签：卡片栅格 + 专辑卡片
  detail.artistTab = 'albums';
  detail.tracksMore = true;
  const albumsView = api.detailHtml();
  assert.ok(/data-kind="album"/.test(albumsView), '专辑卡片要标 data-kind=album');
  assert.ok(/data-card="274336916"/.test(albumsView), '专辑卡片要带 id');
  assert.ok(/nm3-grid/.test(albumsView), '专辑走卡片栅格');
  assert.ok(/即兴曲/.test(albumsView) && /周杰伦/.test(albumsView), '专辑名与歌手都要显示');
  assert.ok(/param=300y300/.test(albumsView), '专辑封面要带缩放参数');
  assert.ok(tagsBalanced(albumsView), '专辑视图标签要闭合');

  // 专辑还在加载时给 loading，而不是空态
  detail.albums = [];
  detail.listBusy = true;
  const loadingView = api.detailHtml();
  assert.ok(/正在读取专辑/.test(loadingView), '专辑加载中要有 loading 态：' + loadingView);

  // 加载中 + 还有更多 → 按钮变灰并写「正在加载…」
  detail.albums = [{ id: 1, name: 'a', picUrl: PLAIN, size: 1, artist: { name: 'x' } }];
  detail.albumsMore = true;
  assert.ok(/disabled/.test(api.detailHtml()) && /正在加载/.test(api.detailHtml()), '加载中按钮要禁用');

  // 歌手页的「播放全部」在没歌时禁用
  detail.artistTab = 'songs';
  detail.tracks = [];
  detail.tracksTotal = 0;
  detail.listBusy = false;
  const emptyView = api.detailHtml();
  assert.ok(/disabled/.test(emptyView), '没有歌时「播放全部」要禁用');
  assert.ok(/这里没有可播放的歌曲/.test(emptyView), '空态要说人话');
  console.log('ok 9 detailHtml：歌手页签 / 全部歌曲 / 专辑栅格 / 加载更多');
}

console.log('\n全部通过');

})().catch((e) => {
  console.error('FAILED:', (e && e.message) ? e.message.split('\n').filter(Boolean).join(' / ') : e);
  process.exit(1);
});
