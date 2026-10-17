/* 全功能版构建 —— 回归测试
 *
 * 钉死三件事：
 *   ① 公开版（netease-music-lite.user.js）的三个开关**永远是 false**，
 *      且 FULL_BUILD 也是 false —— 页头不该有「全功能版」标。
 *   ② tools/build-full.cjs 的生成物里三个开关 + FULL_BUILD 都是 true，
 *      @name 写明「全功能版」，头部带构建说明，能被 node --check 解析。
 *   ③ 生成是**不破坏性**的：公开版字节不变、连跑两次结果一致（幂等）；
 *      找不到锚点时必须抛错，不能生成一份「看起来像全功能版」的半成品。
 *
 * 用法：node netease-music-lite.full.test.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const LITE = path.join(ROOT, 'netease-music-lite.user.js');
const { buildFull, inspect } = require(path.join(ROOT, 'tools', 'build-full.cjs'));

const lite = fs.readFileSync(LITE, 'utf8');

function slice(text, startMark, endMark) {
  const a = text.indexOf(startMark);
  const b = text.indexOf(endMark, a);
  assert(a > 0 && b > a, '定位代码段失败：' + startMark);
  return text.slice(a, b);
}

/* 页头标记那两个小函数：fullBadge / fullNotice */
function buildBadge(full) {
  const block = slice(lite, '  function fullBadge() {', '  function buildBar() {');
  const toasts = [];
  const factory = new Function('CONFIG', 'toast', block + '\n return { fullBadge, fullNotice };');
  return { api: factory({ FULL_BUILD: full }, (m) => toasts.push(m)), toasts };
}

function main() {
  /* ── 1. 公开版：三个开关 + FULL_BUILD 全是 false ── */
  {
    assert.ok(/ALLOW_CLIENT_SPOOF: false,/.test(lite), '公开版 ALLOW_CLIENT_SPOOF 必须是 false');
    assert.ok(/ALLOW_DOWNLOAD: false,/.test(lite), '公开版 ALLOW_DOWNLOAD 必须是 false');
    assert.ok(/DOWNLOAD_LRC: false,/.test(lite), '公开版 DOWNLOAD_LRC 必须是 false');
    assert.ok(/FULL_BUILD: false/.test(lite), '公开版 FULL_BUILD 必须是 false');
    console.log('ok 1 公开版：三个开关与 FULL_BUILD 都是 false');
  }

  /* ── 2. 公开版页头：没有「全功能版」标，启动也不提示 ── */
  {
    const b = buildBadge(false);
    assert.strictEqual(b.api.fullBadge(), '', '公开版不该输出任何标记 HTML');
    b.api.fullNotice();
    assert.strictEqual(b.toasts.length, 0, '公开版启动不该弹提示');
    assert.ok(!/nm3-full/.test(b.api.fullBadge()), '公开版不该出现 nm3-full');
    console.log('ok 2 公开版：页头无标、启动无提示');
  }

  /* ── 3. 全功能版标记：有 id、有 title、字样是「全功能版」 ── */
  {
    const b = buildBadge(true);
    const html = b.api.fullBadge();
    assert.ok(/id="nm3-full"/.test(html), '标记要带 id=nm3-full');
    assert.ok(/全功能版/.test(html), '标记文字要是「全功能版」');
    assert.ok(/title="[^"]*客户端姿态取流/.test(html), 'title 要说清楚开了哪些功能');
    b.api.fullNotice();
    assert.strictEqual(b.toasts.length, 1, '全功能版启动要提示一次');
    assert.ok(/全功能版/.test(b.toasts[0]) && /下载/.test(b.toasts[0]), '提示里要说明开了下载');
    console.log('ok 3 全功能版：页头标记 + 启动提示');
  }

  /* ── 4. buildBar 真的把标记插进去了（防止有人删掉那一行） ── */
  {
    assert.ok(/'<span class="nm3-brand">[\s\S]{0,200}fullBadge\(\)/.test(lite),
      'buildBar 的品牌区后面必须调用 fullBadge()');
    assert.ok(/setInterval\(tick, CONFIG\.TICK\);[\s\S]{0,120}fullNotice\(\);/.test(lite),
      'boot 里 tick 之后要调用 fullNotice()');
    console.log('ok 4 页头与启动两处接线都在');
  }

  /* ── 5. 生成物：开关全开、名字对、带构建说明 ── */
  {
    const out = buildFull(lite, { builtAt: '2026-01-01 00:00' });
    const info = inspect(out);
    assert.strictEqual(info.spoof, true, '生成物 ALLOW_CLIENT_SPOOF 要 true');
    assert.strictEqual(info.download, true, '生成物 ALLOW_DOWNLOAD 要 true');
    assert.strictEqual(info.lrc, true, '生成物 DOWNLOAD_LRC 要 true');
    assert.strictEqual(info.full, true, '生成物 FULL_BUILD 要 true');
    assert.strictEqual(info.banner, true, '生成物要带构建说明');
    assert.ok(/全功能版/.test(info.name), '@name 要写明「全功能版」');
    assert.ok(/请勿分发/.test(out.slice(0, 2000)), '@description 要写明请勿分发');
    assert.ok(/2026-01-01 00:00/.test(out), '构建说明要带生成时间');
    assert.ok(/@version\s+4\./.test(out), '@version 要与主脚本一致（4.x）');
    console.log('ok 5 生成物：开关全开 + 头字段 + 构建说明');
  }

  /* ── 6. 生成物可被 node 解析（真的能装） ── */
  {
    const out = buildFull(lite, { builtAt: 'x' });
    const tmp = path.join(os.tmpdir(), 'nm3-full-' + process.pid + '.user.js');
    fs.writeFileSync(tmp, out);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
      console.log('ok 6 生成物 node --check 通过');
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
    }
  }

  /* ── 7. 幂等 + 公开版字节不变 ── */
  {
    const before = fs.readFileSync(LITE, 'utf8');
    const a = buildFull(lite, { builtAt: 'x' });
    const b = buildFull(lite, { builtAt: 'x' });
    assert.strictEqual(a, b, '同样的输入要得到同样的输出');
    assert.strictEqual(fs.readFileSync(LITE, 'utf8'), before, '生成过程绝不能改到公开版');
    console.log('ok 7 幂等，且公开版一个字节都没动');
  }

  /* ── 8. 锚点缺失就炸（不生成半成品） ── */
  {
    const broken = lite.replace('    ALLOW_DOWNLOAD: false,', '    ALLOW_DOWNLOAD: literally-off,');
    assert.throws(() => buildFull(broken, { builtAt: 'x' }), /ALLOW_DOWNLOAD/,
      '找不到开关定位点时必须抛错');
    const dup = lite.replace('    FULL_BUILD: false', '    FULL_BUILD: false\n    FULL_BUILD: false');
    assert.throws(() => buildFull(dup, { builtAt: 'x' }), /多次/, '锚点重复也必须抛错');
    console.log('ok 8 锚点缺失 / 重复时明确报错');
  }

  console.log('\n全部通过');
}

try {
  main();
} catch (e) {
  console.error('FAILED:', (e && e.message) ? e.message.split('\n').filter(Boolean).join(' / ') : e);
  process.exit(1);
}
