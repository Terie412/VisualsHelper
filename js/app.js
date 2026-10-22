/* ============================================================
   应用外壳：视图切换、设置
   ============================================================ */

(function (global) {
  'use strict';

  var VH = global.VH;
  var current = null;

  function $(id) { return document.getElementById(id); }

  function switchView(name) {
    if (name === current) return;

    if (current === 'exam' && VH.exam) VH.exam.onHide();
    current = name;

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-active', b.dataset.view === name);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('is-active', v.id === 'view-' + name);
    });

    if (name === 'exam') {
      VH.exam.mount();
      VH.exam.onShow();
    } else if (name === 'ref') {
      renderRef();
    } else {
      VH.learn.onShow();
    }
  }

  /* ---------------------------------------------------------- 参考图库 */

  function renderRef() {
    var grid = $('ref-grid');
    if (!grid || grid.dataset.built === '1') return;
    grid.dataset.built = '1';

    var list = global.VH_ISHIHARA || [];
    var dir = 'assets/ishihara/';

    list.forEach(function (item, i) {
      var card = document.createElement('div');
      card.className = 'ref-card';

      var img = document.createElement('img');
      img.src = dir + item.file;
      img.alt = '参考图版 ' + (i + 1);
      img.draggable = false;

      var ans = document.createElement('div');
      ans.className = 'ref-ans';
      ans.textContent = item.answer || '隐藏图版';
      if (!item.answer) ans.classList.add('is-empty');

      card.appendChild(img);
      card.appendChild(ans);

      card.addEventListener('click', function () {
        VH.learn.openLightbox({
          label: '图版 ' + (i + 1),
          answerText: item.answer || '隐藏图版',
          note: item.note,
          src: dir + item.file
        });
      });

      grid.appendChild(card);
    });
  }

  /* ---------------------------------------------------------- 设置 */

  var drawer, settingInputs;

  function syncSettingsUI() {
    var s = VH.store.settings();
    settingInputs.count.value = s.count;
    settingInputs.limit.value = s.limit;
    settingInputs.allow.value = s.allow;
    settingInputs.sim.checked = s.sim;
    paintOutputs();
  }

  function paintOutputs() {
    $('set-count-out').textContent = settingInputs.count.value;
    $('set-limit-out').textContent = settingInputs.limit.value + ' 秒';
    $('set-allow-out').textContent = settingInputs.allow.value + ' 张';
  }

  function readSettings() {
    return {
      count: Number(settingInputs.count.value),
      limit: Number(settingInputs.limit.value),
      allow: Number(settingInputs.allow.value),
      sim: settingInputs.sim.checked
    };
  }

  /* ---------------------------------------------------------- 图版导入 */

  var PLATE_RE = /\.(jpe?g|png|webp)$/i;

  function setPlateStatus(text, isErr) {
    var box = $('plates-status');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('is-error', !!isErr);
  }

  function paintPlateStatus() {
    if (VH.store.customPlates()) {
      setPlateStatus('已导入 ' + VH.store.platesCount() + ' 张自备图版，答案需要自己标注。');
    } else {
      setPlateStatus('仓库不附带图版。导入后按文件名顺序编号 001、002 …，换一套图会覆盖旧的。');
    }
  }

  function padStem(n) {
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return s;
  }

  function postForm(url) {
    return fetch(url, { method: 'POST' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function importPlates(fileList) {
    if (VH.store.mode() !== 'file') {
      setPlateStatus('导入需要本地服务器：请用 start.bat 或 python serve.py 打开。', true);
      return;
    }

    var all = Array.prototype.slice.call(fileList || []);
    var files = all.filter(function (f) {
      return /^image\//i.test(f.type || '') && PLATE_RE.test(f.name || '');
    });
    var skipped = all.length - files.length;

    if (!files.length) {
      setPlateStatus('没有可导入的图片，只接受 jpg / jpeg / png / webp。', true);
      return;
    }

    var busy = VH.store.customPlates() || VH.store.answerCount() > 0 || VH.store.platesCount() > 0;
    if (busy && !global.confirm('导入会替换当前全部图版，并清空已标注的答案。继续？')) {
      paintPlateStatus();
      return;
    }

    files.sort(function (a, b) {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    var btn = $('btn-import-plates');
    var total = files.length;
    var done = 0;
    var stopped = false;

    function fail(msg) {
      if (stopped) return;
      stopped = true;
      if (btn) btn.disabled = false;
      setPlateStatus(msg, true);
    }

    function step() {
      if (done >= total) { finish(); return; }

      var f = files[done];
      var ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
      var url = '/api/plates?stem=' + encodeURIComponent(padStem(done + 1))
        + '&ext=' + encodeURIComponent(ext);

      setPlateStatus('正在导入 ' + (done + 1) + ' / ' + total + '：' + f.name);

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': f.type || 'application/octet-stream' },
        body: f
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        done++;
        step();
      }).catch(function (e) {
        fail('导入失败（已写入 ' + done + ' 张）：' + e.message);
      });
    }

    function finish() {
      VH.store.savePlatesMeta(true, total);
      VH.store.resetForNewPlates();
      try {
        sessionStorage.setItem('vh.plates.justImported', String(total));
        if (skipped > 0) sessionStorage.setItem('vh.plates.skipped', String(skipped));
      } catch (e) { /* 隐私模式就算了 */ }
      // 等数据真正写进 layout.json 再刷新，否则这次改动会丢
      VH.store.flush().then(function () { global.location.reload(); });
    }

    if (btn) btn.disabled = true;

    // 先清空旧图，免得上一套的数量残留
    postForm('/api/plates/clear')
      .then(function () { step(); })
      .catch(function (e) { fail('清空旧图版失败：' + e.message); });
  }

  function clearPlates() {
    if (!global.confirm('清空已导入的图版？图片会从 temp/plates/ 删除，已标注的答案也会一并清空。')) return;

    postForm('/api/plates/clear').then(function () {
      VH.store.savePlatesMeta(false, 0);
      VH.store.resetForNewPlates();
      VH.store.flush().then(function () { global.location.reload(); });
    }).catch(function (e) {
      setPlateStatus('清空失败：' + e.message, true);
    });
  }

  /* 导入完成重载后，在学习页顶部提示一次 */
  function showImportHint() {
    var box = $('plate-hint');
    if (!box) return;

    var raw = null;
    var skipped = 0;
    try {
      raw = sessionStorage.getItem('vh.plates.justImported');
      skipped = Number(sessionStorage.getItem('vh.plates.skipped')) || 0;
      sessionStorage.removeItem('vh.plates.justImported');
      sessionStorage.removeItem('vh.plates.skipped');
    } catch (e) { return; }

    if (!raw) return;

    var text = '已导入 ' + raw + ' 张图版。点卡片下方的答案条逐张标注答案，标注过才会进考试。';
    if (skipped > 0) text += ' 另有 ' + skipped + ' 个文件不是支持的图片格式，已跳过。';

    box.textContent = text;
    box.hidden = false;

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'plate-hint-close';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '×';
    close.addEventListener('click', function () { box.hidden = true; });

    box.appendChild(close);
  }

  /* ---------------------------------------------------------- 布局备份 */

  function exportLayout() {
    var data = VH.store.snapshot();
    data.app = 'visualshelper';
    data.version = 3;
    data.exportedAt = new Date().toISOString();

    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'visuals-helper-layout.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function bindSettings() {
    drawer = $('drawer');

    settingInputs = {
      count: $('set-count'),
      limit: $('set-limit'),
      allow: $('set-allow'),
      sim: $('set-sim')
    };

    Object.keys(settingInputs).forEach(function (k) {
      settingInputs[k].addEventListener('input', paintOutputs);
      settingInputs[k].addEventListener('change', function () {
        VH.store.saveSettings(readSettings());
        if (VH.exam) VH.exam.refreshIdle();
      });
    });

    $('btn-clear-layout').addEventListener('click', function () {
      VH.store.clearGrid();
      VH.learn.refresh();
      $('card-size').value = VH.store.cardSize();
    });

    $('btn-export').addEventListener('click', exportLayout);

    var btnImport = $('btn-import-plates');
    var fileInput = $('file-plates');
    if (btnImport && fileInput) {
      btnImport.addEventListener('click', function () {
        fileInput.value = '';
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        importPlates(fileInput.files);
      });
    }

    var btnClearPlates = $('btn-clear-plates');
    if (btnClearPlates) btnClearPlates.addEventListener('click', clearPlates);

    paintPlateStatus();

    var foot = document.querySelector('.drawer-foot');
    if (foot) {
      foot.textContent = (VH.store.mode() === 'file')
        ? '数据保存在 data/layout.json，换浏览器也不会丢。'
        : '当前是直接打开文件，数据暂存在这个浏览器里。用 start.bat 打开就会存成文件。';
    }
  }

  function openDrawer() {
    syncSettingsUI();
    drawer.hidden = false;
  }

  function closeDrawer() {
    drawer.hidden = true;
  }

  /* ---------------------------------------------------------- 启动 */

  function init() {
    var boot = VH.store.boot().then(function () {
      // 张数取决于有没有导入自备图版，等数据读回来再算一次
      if (VH.data.rebuild) VH.data.rebuild();
    });
    var sim = VH.sim ? VH.sim.load() : Promise.resolve();
    Promise.all([boot, sim]).then(startUI);
  }

  function startUI() {
    VH.learn.mount();
    showImportHint();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { switchView(b.dataset.view); });
    });

    $('btn-settings').addEventListener('click', openDrawer);

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (el) {
      el.addEventListener('click', function () {
        if (drawer && !drawer.hidden) closeDrawer();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer && !drawer.hidden) closeDrawer();
    });

    bindSettings();

    current = 'learn';

    var hashView = (location.hash || '').replace('#', '');
    if (hashView === 'exam' || hashView === 'ref') {
      current = null;
      switchView(hashView);
    } else {
      VH.learn.onShow();
    }
  }

  VH.app = { switchView: switchView };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
