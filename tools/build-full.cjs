/* 生成「全功能版」：node tools/build-full.cjs
 *
 * 公开仓库里只有 netease-music-lite.user.js —— 三个敏感开关（客户端姿态取流 /
 * 下载 / 附带 .lrc）默认关闭。这一份构建把它们全部打开，并且只在**本机**生成，
 * 不进仓库（.gitignore 里写着），因为「能不能分发」这件事由你自己判断。
 *
 * 它做的事很少，而且全部是**替换字面量**，不做正则改写源代码：
 *   ① CONFIG 里三个 false → true（找不到就报错，绝不猜）
 *   ② CONFIG.FULL_BUILD false → true（页头「全功能版」标 + 启动提示）
 *   ③ @name / @description 换成全功能版的说法
 *   ④ 头部插一段构建说明（谁生成的、基于哪一版、什么时候）
 * 输出：netease-music-full.user.js（同目录上一级）
 *
 * 为什么用脚本而不是手改一份：手改的那份会跟主脚本漂移 —— 主脚本修了 bug，
 * 全功能版还停在旧代码上，而且没人知道它停在哪。这样每次重新生成即可。
 *
 * 由 netease-music-lite.full.test.cjs 覆盖：生成物开关为 true、公开版一字不动、
 * 生成物可被 node --check 解析、幂等（连跑两次结果一样）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'netease-music-lite.user.js');
const OUT = path.join(ROOT, 'netease-music-full.user.js');

/** 一条替换：必须刚好命中一次，否则抛错（宁可炸，也不要静默生成一份半成品） */
function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error('找不到要替换的内容：' + label);
  const second = text.indexOf(from, first + from.length);
  if (second >= 0) throw new Error('要替换的内容出现了多次：' + label);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

function buildFull(srcText, opts) {
  const builtAt = (opts && opts.builtAt) || '本地构建';
  let out = srcText;

  /* ① 三个敏感开关 */
  out = replaceOnce(out, '    ALLOW_CLIENT_SPOOF: false,', '    ALLOW_CLIENT_SPOOF: true,', 'ALLOW_CLIENT_SPOOF');
  out = replaceOnce(out, '    ALLOW_DOWNLOAD: false,', '    ALLOW_DOWNLOAD: true,', 'ALLOW_DOWNLOAD');
  out = replaceOnce(out, '    DOWNLOAD_LRC: false,', '    DOWNLOAD_LRC: true,', 'DOWNLOAD_LRC');

  /* ② 全功能版标记 */
  out = replaceOnce(out, '    FULL_BUILD: false', '    FULL_BUILD: true', 'FULL_BUILD');

  /* ③ 头部字段 */
  out = replaceOnce(
    out,
    '// @name         网易云音乐 · 精简版（听歌 / 搜索 / 我的音乐）',
    '// @name         网易云音乐 · 全功能版（本地 · 听歌 / 搜索 / 我的音乐）',
    '@name'
  );
  out = replaceOnce(
    out,
    '// @description  把网易云音乐网页版重做成深蓝夜色的三页签播放器：',
    '// @description  【全功能版 · 仅供本机个人使用，请勿分发】在精简版基础上打开了「伪装 PC 客户端姿态取流」「下载音频」「附带 .lrc」三个默认关闭的功能；其余与精简版相同。把网易云音乐网页版重做成三页签播放器：',
    '@description'
  );

  /* ④ 构建说明（插在 ==/UserScript== 之后） */
  const banner = [
    '',
    '/* ═══════════════════════════════════════════════════════════════════════════',
    ' *  ▲ 这是「全功能版」，由 tools/build-full.cjs 从 netease-music-lite.user.js 生成',
    ' *',
    ' *  与公开版的唯一区别：',
    ' *    ALLOW_CLIENT_SPOOF = true   伪装 PC 客户端姿态取流（含救场播放）',
    ' *    ALLOW_DOWNLOAD     = true   控制台出现下载按钮，可把音频存成本地文件',
    ' *    DOWNLOAD_LRC       = true   下载时顺带写双语 .lrc',
    ' *    FULL_BUILD         = true   页头挂「全功能版」标 + 启动提示',
    ' *',
    ' *  ⚠ 这三样正是权利方最常点名的一类功能，且可能被认定为「避开访问控制',
    ' *    技术措施」。它**不进公开仓库**、不建议二次分发：自己听、别传给别人。',
    ' *    公开版（netease-music-lite.user.js）保持三个开关为 false。',
    ' *',
    ' *  生成时间：' + builtAt,
    ' *  要更新：主脚本改动后重新跑 node tools/build-full.cjs（不要手改这份）',
    ' * ═══════════════════════════════════════════════════════════════════════════ */',
    ''
  ].join('\n');

  const headEnd = out.indexOf('// ==/UserScript==');
  if (headEnd < 0) throw new Error('找不到 ==/UserScript==');
  const insertAt = headEnd + '// ==/UserScript=='.length;
  out = out.slice(0, insertAt) + '\n' + banner + out.slice(insertAt).replace(/^\n/, '');

  return out;
}

/** 从生成物里读几个关键事实，给测试和终端提示用 */
function inspect(text) {
  const grab = (re) => {
    const m = text.match(re);
    return m ? m[1] : null;
  };
  return {
    name: grab(/\/\/ @name\s+(.+)/),
    version: grab(/\/\/ @version\s+(.+)/),
    spoof: /ALLOW_CLIENT_SPOOF: true,/.test(text),
    download: /ALLOW_DOWNLOAD: true,/.test(text),
    lrc: /DOWNLOAD_LRC: true,/.test(text),
    full: /FULL_BUILD: true/.test(text),
    banner: /这是「全功能版」/.test(text)
  };
}

if (require.main === module) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const builtAt = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  const srcText = fs.readFileSync(SRC, 'utf8');
  const out = buildFull(srcText, { builtAt });
  fs.writeFileSync(OUT, out);

  const info = inspect(out);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log('已生成 ' + path.relative(ROOT, OUT) + '（' + kb(Buffer.byteLength(out)) + '，源 ' + kb(Buffer.byteLength(srcText)) + '）');
  console.log('  @name    ' + info.name);
  console.log('  @version ' + info.version);
  console.log('  开关     ALLOW_CLIENT_SPOOF=' + info.spoof + '  ALLOW_DOWNLOAD=' + info.download +
    '  DOWNLOAD_LRC=' + info.lrc + '  FULL_BUILD=' + info.full);
  console.log('  ⚠ 仅供本机个人使用；公开仓库里那份（lite）三个开关仍是 false。');
}

module.exports = { buildFull, inspect, OUT, SRC };
