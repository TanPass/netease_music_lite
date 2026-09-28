/* 下载位置（音乐文件夹）逻辑回归测试
 *
 * 把 netease-music-lite.user.js 里「下载位置」那一段**原样抽出来**，喂给桩
 * showDirectoryPicker / indexedDB / 目录句柄 跑一遍，验证流程与兜底：
 *   1) 浏览器没有 File System Access API（Firefox / Safari）→ 直接退回默认下载目录
 *   2) 第一次弹选择框（startIn='music'）→ 句柄存 IndexedDB；第二次起静默复用
 *   3) 权限 prompt → 借手势续期；续期被拒 / 句柄失效 → 清记录重选
 *   4) 用户在选择框上取消 → 本次用默认目录且记住，之后不再纠缠；Shift 点击可重选
 *   5) 同名不覆盖（改成 " (2)"）、写完 close、写失败 abort 并删掉半截文件
 *   6) CONFIG.DOWNLOAD_SUBDIR 按需建子文件夹
 *
 * 用法：node netease-music-lite.download-dir.test.cjs
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, 'netease-music-lite.user.js');
const src = fs.readFileSync(SRC, 'utf8');
const start = src.indexOf("  const DL_DB = 'nm3-download';");
const end = src.indexOf('  function extFromUrl(url, level) {');
assert(start > 0 && end > start, '在脚本里定位「下载位置」代码块失败');
const block = src.slice(start, end);

/* ── 桩：localStorage ── */
function makeLs() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m
  };
}

/* ── 桩：indexedDB（够用就行：单 store 的 get/put/delete + 事务完成） ── */
function makeIdb() {
  const stores = new Map();
  return {
    open() {
      const req = { result: null };
      setTimeout(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          close() {},
          transaction(store) {
            if (!stores.has(store)) stores.set(store, new Map());
            const data = stores.get(store);
            const tx = {};
            tx.objectStore = () => ({
              get: (k) => { const r = { result: data.get(k) }; queueMicrotask(() => tx.oncomplete && tx.oncomplete()); return r; },
              put: (v, k) => { data.set(k, v); const r = { result: k }; queueMicrotask(() => tx.oncomplete && tx.oncomplete()); return r; },
              delete: (k) => { data.delete(k); const r = { result: undefined }; queueMicrotask(() => tx.oncomplete && tx.oncomplete()); return r; }
            });
            return tx;
          }
        };
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
    _stores: stores
  };
}

/* ── 桩：目录 / 文件句柄 ── */
function makeDir(name, perm) {
  const files = new Map();
  const subs = new Map();
  return {
    name,
    kind: 'directory',
    _files: files,
    _subs: subs,
    _perm: perm,                       // { query, request }
    async queryPermission() { return this._perm.query; },
    async requestPermission() {
      this._perm.query = this._perm.request;
      return this._perm.query;
    },
    async getDirectoryHandle(n, o) {
      if (!subs.has(n)) {
        if (!o || !o.create) { const e = new Error('NotFound'); e.name = 'NotFoundError'; throw e; }
        subs.set(n, makeDir(n, this._perm));
      }
      return subs.get(n);
    },
    async getFileHandle(n, o) {
      if (!files.has(n)) {
        if (!o || !o.create) { const e = new Error('NotFound'); e.name = 'NotFoundError'; throw e; }
        files.set(n, { name: n, kind: 'file' });
      }
      return files.get(n);
    },
    async removeEntry(n) { files.delete(n); }
  };
}

/* 句柄写盘：给 getFileHandle 返回的对象挂上桩 createWritable */
function attachWritable(dir) {
  const orig = dir.getFileHandle.bind(dir);
  dir.getFileHandle = async (n, o) => {
    const fh = await orig(n, o);
    fh.createWritable = async () => ({
      write: async (blob) => { fh._bytes = blob; },
      close: async () => { fh._closed = true; },
      abort: async () => { fh._aborted = true; }
    });
    return fh;
  };
  dir._subs.forEach((s) => attachWritable(s));
  return dir;
}

function build(env) {
  const win = { showDirectoryPicker: env.picker };
  const toasts = [];
  const warns = [];
  const factory = new Function(
    'window', 'localStorage', 'indexedDB', 'CONFIG', 'toast', 'warn', 'fileSafe', 'console',
    block + '\n return { ensureDownloadDir, writeToDir, freeName, subdirOf, dirGranted, dirStore,' +
    ' DL_DEFAULT_KEY, DL_KEY, hasFsApi };'
  );
  const api = factory(
    win, env.ls, env.idb, env.config || { DOWNLOAD_SUBDIR: '' },
    (m) => toasts.push(m), (...a) => warns.push(a),
    (s) => String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名',
    console
  );
  return { api, toasts, warns, win };
}

(async () => {
  /* 1. 没有 FSA（Firefox / Safari）：直接返回 null，不弹任何框 */
  {
    const env = { ls: makeLs(), idb: makeIdb(), picker: undefined };
    const { api } = build(env);
    assert.strictEqual(api.hasFsApi(), false);
    assert.strictEqual(await api.ensureDownloadDir(false), null);
    console.log('ok 1 无 FSA → 退回默认下载目录');
  }

  /* 2. 第一次：弹选择框（startIn=music）→ 记住；第二次：不再弹 */
  {
    const ls = makeLs();
    const idb = makeIdb();
    const dir = attachWritable(makeDir('Music', { query: 'prompt', request: 'granted' }));
    let picks = 0;
    const env = {
      ls, idb,
      picker: async (opt) => {
        picks++;
        assert.strictEqual(opt.startIn, 'music', '选择框要开在「音乐」文件夹');
        assert.strictEqual(opt.mode, 'readwrite');
        assert.strictEqual(opt.id, 'nm3-music');
        return dir;
      }
    };
    const { api, toasts } = build(env);
    const h1 = await api.ensureDownloadDir(false);
    assert.strictEqual(h1, dir);
    assert.strictEqual(picks, 1);
    assert.ok(toasts.some((t) => /下载位置已记住/.test(t)), '要有一次「已记住」提示');

    const h2 = await api.ensureDownloadDir(false);
    assert.strictEqual(h2, dir);
    assert.strictEqual(picks, 1, '第二次不该再弹选择框');
    console.log('ok 2 选一次并记住，之后静默复用');
  }

  /* 3. 句柄还在但权限变成 prompt：借手势续期；拒绝则清掉重选 */
  {
    const ls = makeLs();
    const idb = makeIdb();
    const dir = attachWritable(makeDir('Music', { query: 'granted', request: 'granted' }));
    let picks = 0;
    const env = { ls, idb, picker: async () => { picks++; return dir; } };
    const { api } = build(env);
    await api.ensureDownloadDir(false);

    dir._perm = { query: 'prompt', request: 'granted' };   // 新会话：要续期
    assert.strictEqual(await api.ensureDownloadDir(false), dir);
    assert.strictEqual(picks, 1, '续期成功就不该重选');

    dir._perm = { query: 'prompt', request: 'denied' };    // 权限被拒 → 重选
    assert.strictEqual(await api.ensureDownloadDir(false), dir);
    assert.strictEqual(picks, 2, '权限被拒要重新弹选择框');
    console.log('ok 3 授权续期 / 失效重选');
  }

  /* 4. 用户取消：本次退回默认目录，之后不再纠缠（Shift 点击才重选） */
  {
    const ls = makeLs();
    const idb = makeIdb();
    let picks = 0;
    const dir = attachWritable(makeDir('Music', { query: 'granted', request: 'granted' }));
    const env = {
      ls, idb,
      picker: async () => {
        picks++;
        if (picks === 1) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        return dir;
      }
    };
    const { api, toasts } = build(env);
    assert.strictEqual(await api.ensureDownloadDir(false), null);
    assert.strictEqual(ls.getItem(api.DL_DEFAULT_KEY), '1');
    assert.ok(toasts.some((t) => /默认下载目录/.test(t)));
    assert.strictEqual(await api.ensureDownloadDir(false), null);
    assert.strictEqual(picks, 1, '取消过就不该每次下载都弹');

    assert.strictEqual(await api.ensureDownloadDir(true), dir);   // Shift 点击
    assert.strictEqual(ls.getItem(api.DL_DEFAULT_KEY), null);
    console.log('ok 4 取消 → 记住用默认目录；Shift 点击可重选');
  }

  /* 5. 写盘：同名不覆盖，改成 (2)；写坏要删掉半截文件 */
  {
    const dir = attachWritable(makeDir('Music', { query: 'granted', request: 'granted' }));
    const env = { ls: makeLs(), idb: makeIdb(), picker: async () => dir };
    const { api } = build(env);
    const blob = { size: 3 };

    assert.strictEqual(await api.writeToDir(dir, '歌 - 手 [极高].mp3', blob), '歌 - 手 [极高].mp3');
    assert.strictEqual(await api.writeToDir(dir, '歌 - 手 [极高].mp3', blob), '歌 - 手 [极高] (2).mp3');
    assert.ok(dir._files.get('歌 - 手 [极高] (2).mp3')._closed, '写完要 close');

    const broken = makeDir('Music', { query: 'granted', request: 'granted' });
    const orig = broken.getFileHandle.bind(broken);
    broken.getFileHandle = async (n, o) => {
      const fh = await orig(n, o);
      fh.createWritable = async () => ({
        write: async () => { throw new Error('磁盘满'); },
        close: async () => {},
        abort: async () => {}
      });
      return fh;
    };
    let threw = false;
    try { await api.writeToDir(broken, 'x.mp3', blob); } catch (e) { threw = true; }
    assert.ok(threw, '写失败要抛出去');
    assert.ok(!broken._files.has('x.mp3'), '写失败要删掉半截文件');
    console.log('ok 5 同名自动改名 + 失败清理');
  }

  /* 6. CONFIG.DOWNLOAD_SUBDIR：在音乐文件夹里再建一层 */
  {
    const dir = attachWritable(makeDir('Music', { query: 'granted', request: 'granted' }));
    const env = { ls: makeLs(), idb: makeIdb(), picker: async () => dir, config: { DOWNLOAD_SUBDIR: '网易云音乐' } };
    const { api } = build(env);
    const sub = await api.ensureDownloadDir(false);
    assert.strictEqual(sub.name, '网易云音乐');
    assert.ok(dir._subs.has('网易云音乐'), '子文件夹要按需创建');
    console.log('ok 6 可选的子文件夹');
  }

  console.log('\n全部通过');
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
