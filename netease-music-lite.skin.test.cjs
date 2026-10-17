/* 皮肤（原皮 / 莱茵生命·晨雾 / 莱茵生命·月影）—— 回归测试
 *
 * 目的：换皮肤这条链路很容易被后续改动悄悄弄坏，而坏了往往只是「看着不对」，
 * 不会报错，所以用测试把它钉住：
 *
 *   ① 三套皮肤都注册了，chip 文案与名字对得上
 *   ② 默认是原皮，且原皮**不设** data-nm3-skin（CSS 里靠属性缺失表示原皮）
 *   ③ 循环切换：原皮 → 晨雾 → 月影 → 原皮，每次都写进 localStorage
 *   ④ 记住的皮肤第一帧就生效（localeStorage 预置 → 立刻挂属性，不闪原皮）
 *   ⑤ 存了个非法值 → 回落原皮，不炸
 *   ⑥ 页头按钮的文案跟着皮肤走
 *   ⑦ document-start 阶段还没有 <html> 时不抛错，等 DOMContentLoaded 补上
 *   ⑧ 样式层：两套莱茵皮肤都定义了 accent / solid / channel，且**没有**硬编码原皮色
 *   ⑨ 页头确实渲染了按钮，点击绑到 nextSkin，boot 里注入了 SKIN_CSS 并 applySkin
 *
 * 用法：node netease-music-lite.skin.test.cjs
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

/* ── 假的 document / localStorage，够 applySkin 用就行 ── */
function makeDoc(opts) {
  const o = opts || {};
  const attrs = Object.create(null);
  const listens = [];
  const docEl = o.noHtml ? null : {
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; }
  };
  let btn = null;
  if (o.chip != null) {
    btn = {
      _chip: o.chip,
      attrs: Object.create(null),
      querySelector: (sel) => (sel === 'em' ? {
        get textContent() { return btn._chip; },
        set textContent(v) { btn._chip = v; }
      } : null),
      setAttribute: (k, v) => { btn.attrs[k] = String(v); },
      getAttribute: (k) => (k in btn.attrs ? btn.attrs[k] : null)
    };
  }
  const doc = {
    readyState: o.readyState || 'complete',
    documentElement: docEl,
    getElementById: (id) => (id === 'nm3-skin' ? btn : null),
    addEventListener: (type, fn) => { listens.push({ type, fn }); }
  };
  return { doc, attrs, listens, btn, setHtml: () => {
    doc.documentElement = {
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; }
    };
  } };
}

function makeStore(initial) {
  const map = Object.assign(Object.create(null), initial || {});
  return {
    map,
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; }
  };
}

/* ── 把真实的皮肤代码段抽出来跑（不是抄一份，所以改了源码这里立刻能发现）── */
function buildSkin(opts) {
  const o = opts || {};
  const block = slice('  const SKIN_KEY = ', '  const PREFIX = ');
  const env = makeDoc({ chip: o.chip == null ? null : o.chip, noHtml: !!o.noHtml, readyState: o.readyState });
  const store = makeStore(o.store);
  const toasts = [];
  const rafs = [];
  const factory = new Function(
    'document', 'localStorage', 'requestAnimationFrame', 'toast',
    block + `
    return { SKINS, SKIN_KEY, skinOf, applySkin, nextSkin, renderSkinChip, getSkin: () => skinId };
  `);
  const api = factory(
    env.doc,
    store,
    (fn) => { rafs.push(fn); },
    (msg, ms) => { toasts.push({ msg, ms }); }
  );
  return { api, env, store, toasts, rafs };
}

/* ── 样式层：SKIN_CSS 那段 ── */
const skinCss = slice('  const SKIN_CSS = `', '  /* ═══════════════════════════ 状态 ═══════════════════════════ */');
function skinBlockOf(id) {
  const a = skinCss.indexOf('html[data-nm3-skin="' + id + '"] {');
  assert(a > 0, '找不到皮肤块：' + id);
  const b = skinCss.indexOf('}', a);
  return skinCss.slice(a, b);
}

(async () => {
  /* ── 1. 三套皮肤都注册了 ── */
  {
    const { api } = buildSkin();
    assert.strictEqual(api.SKINS.length, 3, '应当正好三套皮肤');
    assert.deepStrictEqual(api.SKINS.map((s) => s.id), ['ink', 'rhine-day', 'rhine-night']);
    assert.deepStrictEqual(api.SKINS.map((s) => s.chip), ['原皮', '晨雾', '月影']);
    assert.ok(/莱茵生命/.test(api.SKINS[1].name) && /莱茵生命/.test(api.SKINS[2].name), '名字要写明莱茵生命');
    assert.strictEqual(api.SKIN_KEY, 'nm3.skin');
    console.log('ok 1 三套皮肤：原皮 / 莱茵生命·晨雾 / 莱茵生命·月影');
  }

  /* ── 2. 默认原皮，且不设属性 ── */
  {
    const { api, env } = buildSkin();
    assert.strictEqual(api.getSkin(), 'ink', '默认应当是原皮');
    api.applySkin();
    assert.strictEqual(env.attrs['data-nm3-skin'], undefined, '原皮不该给 <html> 挂属性');
    assert.strictEqual(api.skinOf('nope').id, 'ink', '认不出的 id 回落原皮');
    console.log('ok 2 默认原皮：不设 data-nm3-skin，未知 id 回落原皮');
  }

  /* ── 3. 循环切换 + 记住 ── */
  {
    const { api, env, store, toasts } = buildSkin();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      api.nextSkin();
      seen.push(api.getSkin());
    }
    assert.deepStrictEqual(seen, ['rhine-day', 'rhine-night', 'ink', 'rhine-day'], '切换顺序：晨雾 → 月影 → 原皮');
    assert.strictEqual(store.map['nm3.skin'], 'rhine-day', 'localStorage 要跟着写');
    // 属性：原皮摘掉，莱茵挂上
    api.applySkin('ink');
    assert.strictEqual(env.attrs['data-nm3-skin'], undefined, '切回原皮要摘属性');
    api.applySkin('rhine-night');
    assert.strictEqual(env.attrs['data-nm3-skin'], 'rhine-night', '莱茵皮肤要挂属性');
    assert.strictEqual(toasts.length, 4, '每次切换都要给一句提示');
    assert.ok(/莱茵生命/.test(toasts[0].msg), '提示里要有皮肤名');
    console.log('ok 3 循环切换 + 写入 localStorage + 属性挂/摘');
  }

  /* ── 4. 记住的皮肤第一帧就生效 ── */
  {
    const { api, env } = buildSkin({ store: { 'nm3.skin': 'rhine-night' } });
    assert.strictEqual(api.getSkin(), 'rhine-night', '存过的皮肤应当在启动时读回来');
    api.applySkin();
    assert.strictEqual(env.attrs['data-nm3-skin'], 'rhine-night', '启动即挂属性（避免先闪一帧原皮）');
    console.log('ok 4 记住的皮肤启动即生效');
  }

  /* ── 5. 非法存值回落原皮 ── */
  {
    const { api, env } = buildSkin({ store: { 'nm3.skin': 'midnight-blue' } });
    assert.strictEqual(api.getSkin(), 'ink', '非法值必须回落原皮');
    api.applySkin();
    assert.strictEqual(env.attrs['data-nm3-skin'], undefined);
    console.log('ok 5 非法存值回落原皮');
  }

  /* ── 6. 按钮文案跟着皮肤走 ── */
  {
    const { api, env } = buildSkin({ chip: '原皮' });
    api.applySkin('rhine-day');
    assert.strictEqual(env.btn._chip, '晨雾', '按钮上要显示当前皮肤');
    assert.ok(/莱茵生命 · 晨雾/.test(env.btn.attrs.title || ''), 'title 要给完整名字和操作说明');
    api.applySkin('ink');
    assert.strictEqual(env.btn._chip, '原皮');
    console.log('ok 6 页头按钮文案 / title 跟着皮肤走');
  }

  /* ── 7. document-start：还没有 <html> 也不能炸 ── */
  {
    const { api, env, rafs } = buildSkin({ noHtml: true, readyState: 'loading' });
    const listens = env.listens;
    assert.doesNotThrow(() => api.applySkin('rhine-day'), '没有 <html> 时不能抛错');
    assert.ok(listens.some((l) => l.type === 'DOMContentLoaded'), '应当挂 DOMContentLoaded 补挂');
    // 文档就绪后补上
    env.setHtml();
    const l = listens.find((x) => x.type === 'DOMContentLoaded');
    l.fn();
    assert.strictEqual(env.attrs['data-nm3-skin'], 'rhine-day', 'DOM 就绪后要补上属性');
    assert.ok(rafs.length === 0, '走 DOMContentLoaded 分支就不该再用 rAF');
    console.log('ok 7 document-start 无 <html> 也不炸，就绪后补挂');
  }

  /* ── 8. 样式层：变量齐全、不硬编码原皮色 ── */
  {
    ['rhine-day', 'rhine-night'].forEach((id) => {
      const b = skinBlockOf(id);
      ['--nm3-bg:', '--nm3-card:', '--nm3-accent:', '--nm3-fg:', '--nm3-accent-rgb:',
        '--nm3-solid:', '--nm3-solid-fg:', '--nm3-channel-rgb:', '--nm3-bar-grad:', '--nm3-hero-a:'
      ].forEach((k) => {
        assert.ok(b.indexOf(k) >= 0, id + ' 里缺变量 ' + k);
      });
    });
    // 皮肤层不许把原皮的蓝抄进来（抄了就等于换了皮肤还是蓝的）
    ['#4EA4EF', '#4ea4ef', '218,226,237', '78,164,239'].forEach((bad) => {
      assert.ok(skinCss.toLowerCase().indexOf(bad.toLowerCase()) < 0, 'SKIN_CSS 里不该出现原皮色 ' + bad);
    });
    // 装饰规则必须挂在皮肤属性前缀下，别影响到原皮
    const decor = skinCss.match(/html\[data-nm3-skin\^="rhine"\]/g) || [];
    assert.ok(decor.length >= 10, '装饰规则应当都以莱茵属性为前缀（当前 ' + decor.length + ' 条）');
    // 听歌页背景：莱茵皮肤不用「封面模糊铺底」
    assert.ok(/\.nm3-np-bg \{[\s\S]{0,1200}filter: none !important/.test(skinCss), '莱茵皮肤要把封面模糊关掉');
    console.log('ok 8 皮肤变量齐全、无原皮色硬编码、装饰规则都带皮肤前缀');
  }

  /* ── 9. 接线：按钮 / 点击 / 注入 / 启动 ── */
  {
    assert.ok(/id="nm3-skin"/.test(src), '页头要渲染皮肤按钮');
    assert.ok(/querySelector\('#nm3-skin'\)\.addEventListener\('click',[\s\S]{0,200}nextSkin\(\)/.test(src),
      '按钮点击要绑到 nextSkin()');
    assert.ok(/SVG\.skin\(/.test(src) && /skin: \(s, c\) =>/.test(src), '按钮图标要用 SVG.skin');
    assert.ok(/injectStyle\(SKIN_CSS, 'nm3-skin-style'\)/.test(src), 'boot 里要注入 SKIN_CSS');
    assert.ok(/injectStyle\(SKIN_CSS[\s\S]{0,120}applySkin\(\)/.test(src), '注入后要立刻 applySkin()');
    assert.ok(/renderSkinChip\(\);\s*\/\/ 按钮刚建出来/.test(src), 'buildBar 结尾要刷新按钮文案');
    console.log('ok 9 按钮 / 点击 / 注入 / 启动四处接线都在');
  }

  console.log('\n全部通过');
})().catch((e) => {
  console.error('FAILED:', (e && e.message) ? e.message.split('\n').filter(Boolean).join(' / ') : e);
  process.exit(1);
});
