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
    var boot = VH.store.boot();
    var sim = VH.sim ? VH.sim.load() : Promise.resolve();
    Promise.all([boot, sim]).then(startUI);
  }

  function startUI() {
    VH.learn.mount();

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
