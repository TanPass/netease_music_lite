/* 免责声明 + 两个默认关闭的敏感开关 —— 回归测试
 *
 * 目的：把「默认关着」这件事**钉死**。任何人不小心把默认值改回 true、或者把闸门
 * 删掉一处，这个测试就会红。
 *
 *   ① ALLOW_CLIENT_SPOOF（客户端姿态伪装 os=pc / appver）：默认 false
 *      —— 不写 cookie、不追加查询参数、取流不带客户端字段、不做救场。
 *   ② ALLOW_DOWNLOAD（下载）：默认 false —— 控件栏里不出现下载按钮，
 *      downloadCurrent() 直接拦下并提示去哪里开开关。
 *   ③ DOWNLOAD_LRC（附带双语 .lrc）：默认 false。
 *   ④ 脚本头部必须带免责声明（非商业 / 24 小时内删除 / 开关说明），
 *      @description 里必须写明"默认关闭"。
 *
 * 用法：node netease-music-lite.switches.test.cjs
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

/* ── 客户端姿态那一小段：CLIENT_SIGN / clientSpoofOn / clientSignQuery / markClientCookie / fetchPlayUrl ── */
function buildClientApi(allowSpoof) {
  const block = slice('  const CLIENT_SIGN = {', '  /** 从想要的档位往下退');
  const cookieWrites = [];
  const apiCalls = [];
  const doc = {
    get cookie() { return ''; },
    set cookie(v) { cookieWrites.push(v); }
  };
  const factory = new Function(
    'CONFIG', 'document', 'apiGet', 'URL_API',
    block + `
    return { clientSpoofOn, clientSignQuery, markClientCookie, fetchPlayUrl, CLIENT_SIGN };
  `);
  const api = factory(
    { ALLOW_CLIENT_SPOOF: allowSpoof },
    doc,
    async (p, params) => { apiCalls.push({ path: p, params: params }); return { code: 200, data: [] }; },
    '/api/song/enhance/player/url/v1'
  );
  return { api, cookieWrites, apiCalls };
}

/* ── maybeRescue：只看它有没有被开关挡住 ── */
function buildRescue(allowSpoof) {
  const block = slice('  function maybeRescue() {', '  /* ── 下载 ── */');
  let audioElCalls = 0;
  let rescueCalls = 0;
  const factory = new Function(
    'CONFIG', 'clientSpoofOn', 'audioEl', 'nowPlaying', 'rescuePlayback', 'curTrackId', 'curTrackSince', 'Date',
    block + '\n return { maybeRescue };'
  );
  const api = factory(
    { ALLOW_CLIENT_SPOOF: allowSpoof },
    () => allowSpoof,                       // clientSpoofOn 本身在第 2/3 组里单独验过
    () => { audioElCalls++; return null; },
    () => ({ track: { id: 1 } }),
    () => { rescueCalls++; },
    1, Date.now() - 10000, Date
  );
  return { api, calls: () => ({ audioElCalls, rescueCalls }) };
}

/* ── 下载开关 ── */
function buildDownloadFlag(allow) {
  const block = slice('  function downloadAllowed() {', '  const downloadState = {');
  const factory = new Function('CONFIG', block + '\n return { downloadAllowed };');
  return factory({ ALLOW_DOWNLOAD: allow });
}

(async () => {
  /* ── 1. 默认值就是关着的（源码级断言，防止有人改回 true）── */
  {
    assert.ok(/ALLOW_CLIENT_SPOOF:\s*false/.test(src), 'CONFIG.ALLOW_CLIENT_SPOOF 默认必须是 false');
    assert.ok(/ALLOW_DOWNLOAD:\s*false/.test(src), 'CONFIG.ALLOW_DOWNLOAD 默认必须是 false');
    assert.ok(/DOWNLOAD_LRC:\s*false/.test(src), 'CONFIG.DOWNLOAD_LRC 默认必须是 false');
    console.log('ok 1 三个开关的默认值都是 false');
  }

  /* ── 2. 关着时：不写 cookie、不追加参数、取流不带客户端字段 ── */
  {
    const off = buildClientApi(false);
    assert.strictEqual(off.api.clientSpoofOn(), false);
    assert.strictEqual(off.api.clientSignQuery('/api/a?x=1'), '/api/a?x=1', '不改 URL');
    off.api.markClientCookie();
    assert.strictEqual(off.cookieWrites.length, 0, '一个 cookie 都不该写');
    await off.api.fetchPlayUrl(123, 'exhigh');
    const p = off.apiCalls[0].params;
    assert.strictEqual(p.os, undefined, '不该带 os=pc');
    assert.strictEqual(p.appver, undefined, '不该带 appver');
    assert.strictEqual(p.channel, undefined);
    assert.strictEqual(p.osver, undefined);
    assert.strictEqual(p.level, 'exhigh', '音质参数照旧（那不是敏感功能）');
    console.log('ok 2 关着时：无 cookie、无客户端参数、无救场');
  }

  /* ── 3. 开着时：三处都补上（证明开关真的有效，不是死代码）── */
  {
    const on = buildClientApi(true);
    assert.strictEqual(on.api.clientSpoofOn(), true);
    assert.ok(/os=pc/.test(on.api.clientSignQuery('/api/a?x=1')), 'URL 要补 os=pc');
    on.api.markClientCookie();
    assert.ok(on.cookieWrites.some((c) => /^os=pc/.test(c)), '要写 os=pc cookie');
    assert.ok(on.cookieWrites.some((c) => /^appver=/.test(c)), '要写 appver cookie');
    await on.api.fetchPlayUrl(123, 'lossless');
    const q = on.apiCalls[0].params;
    assert.strictEqual(q.os, 'pc');
    assert.strictEqual(q.appver, '8.9.70');
    assert.strictEqual(q.encodeType, 'flac', '无损时 encodeType 仍按原逻辑');
    console.log('ok 3 打开后：cookie / 查询参数 / 取流参数都补上');
  }

  /* ── 4. 救场跟着同一个开关走 ── */
  {
    const off = buildRescue(false);
    off.api.maybeRescue();
    assert.strictEqual(off.calls().audioElCalls, 0, '关着时连音频元素都不该去碰');
    assert.strictEqual(off.calls().rescueCalls, 0);
    const on = buildRescue(true);
    on.api.maybeRescue();
    assert.ok(on.calls().audioElCalls > 0, '打开后流程要往下走');
    console.log('ok 4 救场播放由 ALLOW_CLIENT_SPOOF 控制');
  }

  /* ── 5. 下载开关 + 界面/入口都要有闸门 ── */
  {
    assert.strictEqual(buildDownloadFlag(false).downloadAllowed(), false);
    assert.strictEqual(buildDownloadFlag(true).downloadAllowed(), true);
    // 按钮是条件渲染的
    assert.ok(/downloadAllowed\(\)\s*\n?\s*\?\s*'<button class="nm3-cbtn" type="button" data-act="dl-current"/.test(src),
      '下载按钮必须在 downloadAllowed() 的条件里渲染');
    // downloadCurrent 开头有兜底拦截（控制台直接调也挡得住）
    const fn = src.slice(src.indexOf('async function downloadCurrent('), src.indexOf('async function downloadCurrent(') + 400);
    assert.ok(/if \(!downloadAllowed\(\)\)/.test(fn), 'downloadCurrent() 开头必须有开关判断');
    assert.ok(/toast\(/.test(fn), '被拦下时要告诉用户去哪儿开');
    // 附带歌词是独立的第二道开关
    assert.ok(/if \(CONFIG\.DOWNLOAD_LRC\)/.test(src), 'DOWNLOAD_LRC 要独立判断');
    console.log('ok 5 下载：按钮条件渲染 + downloadCurrent 兜底拦截 + .lrc 独立开关');
  }

  /* ── 6. 免责声明 & @description ── */
  {
    assert.ok(/免责声明（请先读完再使用/.test(src), '脚本头部要有免责声明');
    const head = src.slice(0, src.indexOf('(function () {'));
    ['个人学习', '严禁任何商业用途', '不绕过任何付费', '24 小时内删除', '服务条款',
      'ALLOW_CLIENT_SPOOF', 'ALLOW_DOWNLOAD', '自行承担', '现状'].forEach((k) => {
      assert.ok(head.indexOf(k) >= 0, '免责声明里应当有「' + k + '」');
    });
    assert.ok(/@description[\s\S]{0,600}默认关闭/.test(head), '@description 要写明敏感功能默认关闭');
    assert.ok(/@description[\s\S]{0,600}仅供个人学习研究/.test(head), '@description 要写明仅供个人学习研究');
    assert.ok(/@author\s+TanPass/.test(head));
    console.log('ok 6 免责声明齐全，@description 已注明默认关闭');
  }

  console.log('\n全部通过');
})().catch((e) => {
  console.error('FAILED:', (e && e.message) ? e.message.split('\n').filter(Boolean).join(' / ') : e);
  process.exit(1);
});
