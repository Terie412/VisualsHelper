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

  function setPlateStatus(text, isErr) {
    var box = $('plates-status');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('is-error', !!isErr);
  }

  function paintPlateStatus() {
    if (VH.store.customPlates()) {
      var src = VH.store.platesSourceDir();
      setPlateStatus('已导入 ' + VH.store.platesCount() + ' 张'
        + (src ? '，来源目录：' + src : '')
        + '。图片在 temp/plates/，答案需要自己标注。');
    } else {
      setPlateStatus('还没导入。指定一个放图片的目录，会把它下面的图片复制到 temp/plates/。');
    }
  }

  /* 统一处理 JSON 接口：HTTP 错或 {ok:false} 都当失败 */
  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok || !data.ok) throw new Error(data.error || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  function browsePlatesDir() {
    setPlateStatus('正在等待选择目录…');

    postJson('/api/plates/pick').then(function (data) {
      if (!data.dir) {
        paintPlateStatus();
        return;
      }
      $('plates-dir').value = data.dir;
      setPlateStatus('已选好目录，点「导入」开始复制。');
    }).catch(function (e) {
      setPlateStatus('打开目录选择框失败：' + e.message, true);
    });
  }

  function importPlatesDir() {
    if (VH.store.mode() !== 'file') {
      setPlateStatus('导入需要本地服务器：请用 start.bat 或 python serve.py 打开。', true);
      return;
    }

    var dir = ($('plates-dir').value || '').trim();
    if (!dir) {
      setPlateStatus('先填一个目录，或者点「浏览…」选一个。', true);
      return;
    }

    if (VH.store.customPlates()
      && !global.confirm('重新导入会清空映射目录，并清空已标注的答案。继续？')) {
      paintPlateStatus();
      return;
    }

    var btn = $('btn-import-plates');
    if (btn) btn.disabled = true;
    setPlateStatus('正在复制图片…');

    postJson('/api/plates/import', { dir: dir }).then(function (data) {
      var list = data.plates || [];

      VH.store.savePlatesSourceDir(data.dir || dir);
      VH.store.savePlatesList(list);
      VH.store.resetForNewPlates();          // 换了一套图：排列、备注、答案都清掉

      try {
        sessionStorage.setItem('vh.plates.justImported', String(list.length));
      } catch (e) { /* 隐私模式就算了 */ }

      // 等数据真正写进 layout.json 再刷新，否则这次改动会丢
      return VH.store.flush();
    }).then(function () {
      global.location.reload();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      setPlateStatus('导入失败：' + e.message, true);
    });
  }

  function clearPlates() {
    if (!global.confirm('清空已导入的图版？会删掉 temp/plates/ 里的图片，并清空答案。')) return;

    postJson('/api/plates/clear').then(function () {
      VH.store.savePlatesList([]);
      VH.store.savePlatesSourceDir('');
      VH.store.resetForNewPlates();
      return VH.store.flush();
    }).then(function () {
      global.location.reload();
    }).catch(function (e) {
      setPlateStatus('清空失败：' + e.message, true);
    });
  }

  /* 导入完成重载后，在学习页顶部提示一次 */
  function showImportHint() {
    var box = $('plate-hint');
    if (!box) return;

    var raw = null;
    try {
      raw = sessionStorage.getItem('vh.plates.justImported');
      sessionStorage.removeItem('vh.plates.justImported');
    } catch (e) { return; }

    if (!raw) return;

    var text = '已导入 ' + raw + ' 张图，答案已清空。点卡片下方的答案条逐张标注，标注过才会进考试。';

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
    if (btnImport) btnImport.addEventListener('click', importPlatesDir);

    var btnBrowse = $('btn-plates-dir');
    if (btnBrowse) btnBrowse.addEventListener('click', browsePlatesDir);

    var dirInput = $('plates-dir');
    if (dirInput) {
      dirInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          importPlatesDir();
        }
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
