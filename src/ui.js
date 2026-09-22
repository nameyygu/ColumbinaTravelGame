/* 哥伦比娅的旅行 · 界面层
 * 家与田地是两个独立场景：哥伦比娅在家时会跟随玩家进入田地。
 */
(function (root) {
  'use strict';
  var NT = (root.NT = root.NT || {});
  var U = NT.util, C = NT.config;

  var app = {};
  NT.app = app;

  app.save = null;
  app.screen = 'hall';
  app.loading = false;
  app.viewing = null;
  /** 当前这条历史项是不是"为了打开弹窗"推的（关闭弹窗时据此决定要不要 back()） */
  app._modalHistory = false;
  app.outMode = 'random';
  app.outRegion = null;
  app.outBearing = 'any';
  app.outDish = 'none';
  app.outRares = [];
  app.chatLog = [];
  app.chatTopic = null;
  app.fieldSheet = null;
  app.modal = null;           // 画面内弹窗：kitchen/toys/chat/album/settings/outdoor/waiting/result
  app.toastTimer = null;
  app._pendingNote = null;
  app._anim = null;
  app._raf = null;
  app._bubble = null;         // { text, until } 人物旁边的气泡
  app._homeBackgroundIndex = null;
  app._hallBackgroundIndex = null;

  function pickBackgroundVariant(count, previous) {
    if (count <= 1) return 0;
    var next = Math.floor(Math.random() * count);
    // 主页再次打开时避免连续两次看到同一张，两个候选时即为交替显示。
    if (next === previous) next = (next + 1) % count;
    return next;
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 启动 ---------------- */

  app.init = function () {
    app.save = NT.store.load();
    // 读档时纠正玩具摆放 —— 数据改过之后老存档的槽位可能已经失效
    NT.home.repair(app.save);
    if (app.save.settings.sound === undefined) app.save.settings.sound = true;
    NT.sfx.enabled = app.save.settings.sound !== false;
    NT.achievements.ensureStats(app.save);
    // 图片是异步加载的：加载完要重绘一次，否则第一次进游戏看到的还是占位图
    var assetRerender = null;
    app.loading = true;
    NT.assets.onLoaded(function (group, id, img) {
      if (group === 'icon') {
        var link = document.querySelector('link[rel="icon"]');
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
        link.href = img.src;
        return;
      }
      clearTimeout(assetRerender);
      app.updateLoadingProgress();
      assetRerender = setTimeout(function () {
        if ((app.screen === 'home' || app.screen === 'farm' || app.screen === 'hall' || app.screen === 'bedroom' || app.screen === 'backyard') && !app.save.activeTrip) app.render();
      }, 180);
    });
    NT.assets.onSettled(function () {
      app.loading = false;
      app.updateLoadingProgress();
      app.render();
    });
    NT.assets.init();
    // 清单为空时 onSettled 不会由图片回调触发，直接结束加载态。
    var initialAssets = NT.assets.status();
    if (!initialAssets.total) {
      app.loading = false;
    }
    app.settleIfDue();
    // 游戏所在地固定为挪德卡莱，启动后直接进入庭院家园。
    // 不再显示旧版的首次选择/大厅入口；旧存档仍由 store.load 负责迁移。
    app.screen = 'home';

    app.bindGlobal();
    if (app.bindCommands) app.bindCommands();
    app.render();
    app.replaceHistory();

    // 移动端切后台、浏览器关闭和系统回收页面时，最后一次操作可能还没有
    // 经过下一个定时器；这些事件都同步写入当前存档，保留原有键和迁移逻辑。
    var persistOnExit = function () {
      if (app.save) NT.store.save(app.save);
    };
    window.addEventListener('pagehide', persistOnExit);
    window.addEventListener('beforeunload', persistOnExit);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') persistOnExit();
    });

    // 移动浏览器的软键盘会改变 visualViewport，却不应重绘页面（重绘会丢失
    // 正在输入的聊天内容）。只更新可视高度变量，让弹窗留在键盘上方。
    var syncVisualViewport = function () {
      var vv = window.visualViewport;
      document.documentElement.style.setProperty('--app-vh', (vv ? vv.height : window.innerHeight) + 'px');
    };
    syncVisualViewport();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncVisualViewport);
      window.visualViewport.addEventListener('scroll', syncVisualViewport);
    }
    // 每 20 秒检查一次她的状态（状态本身只持续 1.5~6 分钟，所以能看到她走动）
    setInterval(function () {
      if (app.screen !== 'home' && app.screen !== 'farm') return;
      var now = Date.now();
      // 她可能已经回来了 —— 必须定时结算，否则要刷新页面才有反应（这是个真 bug）
      if (app.settleIfDue(now)) { app.render(); return; }
      if (app.save.activeTrip) { app.render(); return; }   // 出门时只刷倒计时
      var moved = NT.home.tick(app.save, now);
      if (moved.stepped || moved.visitorChanged) { NT.store.save(app.save); app.render(); }
    }, 20000);

    // 倒计时条每 5 秒刷新一次，秒级跳动太吵，但也不能太慢
    setInterval(function () {
      if (app.screen !== 'home' || !app.save.activeTrip) return;
      var el = document.getElementById('home-countdown');
      if (el) el.innerHTML = app.countdownHTML();
    }, 5000);
  };

  /**
   * 检查她是不是已经回来了。回来了就：结算 → 打开明信片弹窗 → 存盘。
   * 抽成独立函数有两个原因：
   *   1. 启动时和每 20 秒的定时器都走同一条路径，不会出现"两处逻辑不一致"
   *   2. 自检可以直接调它，不用等真时间
   * @returns 完成的那趟行程，或者 null（还没到点）
   */
  app.settleIfDue = function (now) {
    var r = NT.clock.check(app.save, now || Date.now());
    if (!r.settled) return null;
    app.viewing = r.settled;
    app.modal = 'result';
    app.fieldSheet = null;
    if (app.screen === 'farm') app.screen = 'home';
    if (r.missed) app._pendingNote = '你很久没有翻开本子了，她还是回来了。';
    NT.store.save(app.save);
    return r.settled;
  };

  /** 全局点击绑定。抽出来是为了能被自检直接调用（否则测试里点了没反应） */
  app.bindGlobal = function () {    if (app._bound) return;
    app._bound = true;
    document.addEventListener('click', function (e) {
      // 浏览器要求 AudioContext 在用户手势里创建
      if (!app._audioReady) { app._audioReady = true; NT.sfx.init(); }
      var el = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) return;
      app.action(el.getAttribute('data-act'), el.getAttribute('data-arg'));
    });

    /**
     * 视口变了要重画。
     *
     * 画布是按"挂载那一刻"的尺寸画的，横竖屏切换、进全屏、拉窗口之后
     * 尺寸就不对了 —— 轻则拉伸，重则整块是空的（手机上进全屏看到一片绿就是这个）。
     * resize 在手机上会因为地址栏收起/展开频繁触发，所以先比一下尺寸，
     * 真的变了才重排，并且加个防抖。
     */
    var lastW = -1, lastH = -1;
    var onViewportChange = function () {
      var st = document.getElementById('stage') || document.getElementById('farm-stage');
      if (!st) return;
      var r = st.getBoundingClientRect();
      // 第一次只记尺寸，不重排 —— 否则刚进页面就白白 render 一次，
      // 会把"建议横屏"那个只出一次的提示立刻顶掉
      if (lastW < 0) { lastW = r.width; lastH = r.height; return; }
      if (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2) return;
      lastW = r.width; lastH = r.height;
      clearTimeout(app._relayoutTimer);
      app._relayoutTimer = setTimeout(function () {
        if ((app.screen === 'home' || app.screen === 'farm' || app.screen === 'hall' || app.screen === 'bedroom' || app.screen === 'backyard') && !app.modal) app.render();
      }, 160);
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    document.addEventListener('fullscreenchange', onViewportChange);
    document.addEventListener('webkitfullscreenchange', onViewportChange);

    // Android 返回手势和浏览器返回键优先回到上一个游戏界面，而不是意外离开游戏。
    window.addEventListener('popstate', function (event) {
      var state = event.state;
      app._modalHistory = false;        // 这一项是历史回退来的，不再属于"待 pop 的弹窗项"
      if (state && state.columbinaTravel) {
        app.screen = state.screen || 'home';
        app.modal = state.modal || null;
        app.fieldSheet = null;
      } else {
        app.screen = 'home'; app.modal = null; app.fieldSheet = null;
      }
      app.render();
    });
  };

  app.historyState = function () {
    return { columbinaTravel: true, screen: app.screen || 'home', modal: app.modal || null };
  };
  app.replaceHistory = function () {
    app._modalHistory = false;          // replace 出来的历史项不是"为弹窗推的"
    if (root.history && root.history.replaceState) root.history.replaceState(app.historyState(), '', root.location.href);
  };
  app.pushHistory = function () {
    app._modalHistory = false;
    if (root.history && root.history.pushState) root.history.pushState(app.historyState(), '', root.location.href);
  };
  /** 打开弹窗时用它推历史：关闭弹窗时才知道"这条历史项该不该被 back() 掉" */
  app.pushModalHistory = function () {
    app.pushHistory();
    app._modalHistory = true;
  };
  /**
   * 关闭当前弹窗。
   *
   * 关键：**先本地关掉，再考虑历史栈**。关闭是一个本地动作，不能依赖
   * `history.back()` 真的发生 —— 旧实现只要 `history.state.modal` 有值就
   * `back()` 然后 `return`，可如果当前这条历史项本身就是最后一条，back() 是
   * 空操作、也不会触发 popstate，弹窗就永远关不掉。
   * 最典型的触发场景：她在你关掉游戏期间回来了，你重新打开游戏 ——
   * 启动时 `settleIfDue()` 直接弹出明信片，而 `replaceHistory()` 把这条
   * 唯一的历史项写成了 `modal:'result'`，于是"关闭"按钮点了毫无反应。
   */
  app.closeModal = function () {
    var popped = false;
    if (app._modalHistory && root.history && root.history.length > 1) {
      popped = true;
      root.history.back();              // 平衡历史栈：Android 返回键仍能"先关弹窗"
    }
    app._modalHistory = false;
    app.modal = null; app.fieldSheet = null;
    app.render();
    if (!popped) app.replaceHistory();  // 没有可回退的历史项：就地改写当前项
  };

  /**
   * 竖屏提示「建议横屏」—— 24 小时只出一次。
   *
   * 之前是写在 render 的 HTML 里，每 render 一次就重新插一个元素、CSS 动画跟着重播，
   * 结果每点一个按钮它就冒出来一次。
   * 但只加时间戳还不够 —— render 在启动时会被调用不止一次，元素刚插上就被下一次
   * render 顶掉了。所以干脆不走 render：这里直接往 body 塞一个，自己定时删。
   */
  var ROTATE_HINT_GAP = 24 * 60 * 60 * 1000;
  app.maybeShowRotateHint = function () {
    var s = app.save;
    if (!s.settings) s.settings = {};
    var now = Date.now();
    var last = s.settings.rotateHintAt || 0;
    if (last && now - last < ROTATE_HINT_GAP) return false;
    s.settings.rotateHintAt = now;
    NT.store.save(s);

    if (!window.matchMedia || !window.matchMedia('(max-width:899px) and (orientation:portrait)').matches) {
      return false;                      // 横屏 / 电脑上不显示，但时间戳已经记下
    }
    var d = document.createElement('div');
    d.className = 'rotate-hint show';
    d.textContent = '建议横屏';
    document.body.appendChild(d);
    app._rotateHintEl = d;
    setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
      if (app._rotateHintEl === d) app._rotateHintEl = null;
    }, 7000);
    return true;
  };

  /** 检查有没有新解锁的成就，有就弹提示 + 响一声 */
  app.checkAchievements = function () {
    var newly = NT.achievements.check(app.save);
    if (!newly.length) return;
    NT.store.save(app.save);
    newly.forEach(function (a, i) {
      setTimeout(function () {
        NT.sfx.play('achieve');
        app.toast('🏆 成就达成：' + a.name);
      }, i * 1100);
    });
    if (app.modal === 'achievements') app.render();
  };

  app.toast = function (msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(app.toastTimer);
    app.toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  };

  /**
   * 切场景。卧室与后院是"有主题的独立场景"，进去就把她的状态切到对应的事件上：
   *   卧室 -> sleep（睡觉，画面上换成整幅睡眠图）
   *   后院 -> play（玩玩具，她会走到某件玩具旁边，而不是站在中间发呆）
   * 离开这两个场景时再把状态收回发呆，免得"人在田里却显示正在玩玩具"。
   */
  app.go = function (s) {
    // 切场景时把戳一下的冷却和气泡都清掉，不要带到下一个场景
    app._react = { at: 0, until: 0, kind: null, line: '' };
    clearTimeout(app._bubbleTimer);
    clearTimeout(app._sleepBubbleTimer);
    var bub = $('nahida-bubble');
    if (bub) bub.classList.remove('show');
    var sbub = $('sleep-bubble');
    if (sbub) sbub.classList.remove('show');

    var h = app.save && app.save.home && app.save.home.nahida;
    if (s === 'home' && NT.assets && NT.assets.homeVariantCount) {
      var homeCount = NT.assets.homeVariantCount();
      app._homeBackgroundIndex = pickBackgroundVariant(homeCount, app._homeBackgroundIndex);
    }
    if (s === 'hall' && NT.assets && NT.assets.hallVariantCount) {
      var hallCount = NT.assets.hallVariantCount();
      app._hallBackgroundIndex = pickBackgroundVariant(hallCount, app._hallBackgroundIndex);
    }
    if (h) {
      var now = Date.now();
      if (s === 'bedroom') {
        h.stateId = 'sleep'; h.since = now; h.until = now + 6 * 60e3; h.prevSpotId = 'bed';
        h.sceneState = 'bedroom';
        NT.store.save(app.save);
      } else if (s === 'backyard') {
        // 后院就是玩玩具的地方：切到 useToy 的状态，配合 home.playingToy 挑一件玩具
        h.stateId = 'play'; h.since = now; h.until = now + 6 * 60e3; h.prevSpotId = 'lawn';
        h.sceneState = 'backyard';
        NT.store.save(app.save);
      } else if (s === 'bath') {
        // 沐浴场景：纯风景展示，没有立绘也没有戳一下互动
        h.sceneState = 'bath';
        NT.store.save(app.save);
      } else if (h.sceneState === 'backyard') {
        // 离开后院：把进来时切的状态收回去
        h.sceneState = null;
        if (h.stateId === 'play') {
          h.stateId = 'idle'; h.since = now; h.until = now + 150e3; h.prevSpotId = 'yard';
        }
        NT.store.save(app.save);
      } else if (h.sceneState === 'bath') {
        // 离开沐浴：回到 idle
        h.sceneState = null;
        h.stateId = 'idle'; h.since = now; h.until = now + 150e3; h.prevSpotId = 'yard';
        NT.store.save(app.save);
      } else if (h.stateId === 'sleep') {
        // 离开卧室：醒来
        h.sceneState = null;
        h.stateId = 'idle'; h.since = now; h.until = now + 150e3; h.prevSpotId = 'yard';
        NT.store.save(app.save);
      }
    }
    app.screen = s; app.modal = null; app.fieldSheet = null; app.render(); app.pushHistory();
  };

  app.updateLoadingProgress = function () {
    if (!app.loading) return;
    var el = $('loading-progress');
    var label = $('loading-label');
    if (!el || !label || !NT.assets || !NT.assets.status) return;
    var st = NT.assets.status();
    var done = st.ready + st.error;
    var pct = st.total ? Math.round(done / st.total * 100) : 100;
    el.style.width = pct + '%';
    label.textContent = st.total
      ? ('正在准备游戏素材　' + done + ' / ' + st.total)
      : '正在准备游戏素材';
  };

  /* ---------------- 点击她的实时反应 ---------------- */

  app._react = { at: 0, until: 0, kind: null, line: '' };

  /** 她说话的唯一出口：人物旁边的气泡。
   *  kind: 'ambient'（换状态时自动说）/ 'poke'（被戳之后的反应）
   *  立即写入 DOM（不依赖 rAF —— rAF 被节流时也要能看到），位置交给动画循环跟随。 */
  app.setBubble = function (text, ms, kind) {
    app._bubble = { text: text, until: Date.now() + (ms || 6000), kind: kind || 'ambient' };
    var bub = $('nahida-bubble');
    if (!bub) return;
    bub.textContent = text;
    bub.setAttribute('data-txt', text);
    var a = app._anim;
    if (a) {
      bub.style.left = (a.x * 100).toFixed(3) + '%';
      bub.style.top = '68%';
      bub.style.transform = a.x > 0.56 ? 'translate(-104%,-100%)' : 'translate(4%,-100%)';
      bub.classList.toggle('left', a.x > 0.56);
    }
    bub.classList.add('show');
    clearTimeout(app._bubbleTimer);
    app._bubbleTimer = setTimeout(function () {
      if (app._bubble && Date.now() >= app._bubble.until) {
        var b = $('nahida-bubble');
        if (b) b.classList.remove('show');
      }
    }, (ms || 6000) + 60);
  };

  /** 客人说话的气泡（和主角的分开两个元素） */
  app.setVBubble = function (text, ms, kind) {
    app._vbubble = { text: text, until: Date.now() + (ms || 6000), kind: kind || 'ambient' };
    var bub = $('visitor-bubble');
    if (!bub) return;
    bub.textContent = text;
    bub.setAttribute('data-txt', text);
    bub.classList.add('show');
  };

  app.poke = function () { pokeReaction('home'); };

  /** 卧室（睡觉场景）里戳她：只出一行字，不画立绘动作 —— 她已经在睡觉图里了。 */
  app.pokeSleep = function () { pokeReaction('bedroom'); };

  /**
   * 戳她的公共流程：选台词 -> 记成就 -> 响一声 -> 出气泡。
   * @param where 'home' = 庭院画布上的立绘（气泡跟着人物走）；
   *              'bedroom' = 睡觉场景（气泡固定在左上角的空地，层级压在场景图之上）。
   */
  function pokeReaction(where) {
    var s = app.save;
    var now = Date.now();
    if (now < app._react.until) return;                  // 冷却：反应没结束就不再触发
    var st = NT.home.state(s);
    if (!st.poke) return;
    var r = NT.rng.mulberry32(NT.rng.hashSeed('poke:' + now));
    var line = U.pick(r, st.poke.lines);
    app._react = { at: now, until: now + 1800, kind: st.poke.anim, line: line };
    // 反应做成人物旁边的气泡，比底部那行显眼得多。
    NT.achievements.recordPoke(s);
    NT.store.save(s);
    NT.sfx.play('poke');
    if (where === 'bedroom') app.setSleepBubble(line, 5200);
    else app.setBubble(line, 5200, 'poke');
  }

  /**
   * 睡觉场景的台词气泡。位置交给 CSS（左上角的空地），不跟随人物坐标 ——
   * 睡觉图里她躺在右侧，气泡放左边就不会压住她；z-index 也在图片之上。
   */
  app.setSleepBubble = function (text, ms) {
    app._bubble = { text: text, until: Date.now() + (ms || 6000), kind: 'poke' };
    var bub = $('sleep-bubble');
    if (!bub) return;
    bub.textContent = text;
    bub.setAttribute('data-txt', text);
    bub.classList.add('show');
    clearTimeout(app._sleepBubbleTimer);
    app._sleepBubbleTimer = setTimeout(function () {
      if (app._bubble && Date.now() >= app._bubble.until) {
        var b = $('sleep-bubble');
        if (b) b.classList.remove('show');
      }
    }, (ms || 6000) + 60);
  };

  /* ---------------- 聊天（可选 AI 角色扮演） ---------------- */

  app.chatPending = false;

  app.sendChat = function (playerText, presetReply) {
    app.chatLog.push({ me: true, text: playerText });
    NT.achievements.recordChat(app.save);
    app.chatLog.push({ me: false, text: presetReply, source: 'preset' });
    NT.store.save(app.save);
    app.render();
  };

  /* ---------------- 行为 ---------------- */

  app.action = function (act, arg) {
    var s = app.save;
    switch (act) {
      case 'go': app.go(arg); break;
      case 'modal': app.modal = arg; app.fieldSheet = null; app.render(); app.pushModalHistory(); break;
      case 'close-modal': app.closeModal(); break;
      case 'noop': break;
      case 'fullscreen': app.toggleFullscreen(); break;
      case 'toggle-bar': app.toggleBar(); break;
      case 'pick-home':
        s.homeId = arg; s.homeChosen = true;
        NT.store.save(s); app.screen = 'home'; app.render();
        break;
      case 'auto-locate': app.autoLocate(); break;

      /* 田地（在画面里点开） */
      case 'open-field': app.fieldSheet = arg; app.render(); break;
      case 'close-field': app.fieldSheet = null; app.render(); break;
      case 'plant': {
        var r1 = NT.farm.plant(s, app.fieldSheet, arg, Date.now());
        if (!r1.ok) app.toast(r1.error);
        NT.store.save(s); app.render(); break;
      }
      case 'harvest': {
        var r2 = NT.farm.harvest(s, arg, Date.now());
        if (r2) {
          NT.achievements.recordHarvest(s, r2);
          NT.sfx.play('harvest');
          var msg = '收获 ' + r2.itemName + ' ×' + r2.qty;
          if (r2.rare.length) {
            msg += '，掉出 ' + r2.rare.map(function (x) { return x.name; }).join('、');
            NT.sfx.play('rare');
          }
          app.toast(msg);
        }
        app.fieldSheet = null;
        NT.store.save(s); app.render(); break;
      }
      case 'harvest-all': {
        var rs = NT.farm.harvestAll(s, Date.now());
        if (!rs.length) { app.toast('还没有成熟的东西'); NT.sfx.play('error'); }
        else {
          var rares = [];
          rs.forEach(function (x) {
            NT.achievements.recordHarvest(s, x);
            x.rare.forEach(function (y) { rares.push(y.name); });
          });
          if (rares.length) NT.sfx.play('rare');
          app.toast('收获 ' + rs.map(function (x) { return x.itemName + '×' + x.qty; }).join('、') +
            (rares.length ? '，掉落 ' + rares.join('、') : ''));
        }
        NT.store.save(s); app.render(); break;
      }

      /* 厨房 */
      case 'cook': {
        var dish = NT.data.dishById(arg);
        if (!dish || !NT.data.canCook(dish, s.inventory.ingredients)) { app.toast('食材不够'); break; }
        for (var k in dish.need) {
          s.inventory.ingredients[k] -= dish.need[k];
          if (s.inventory.ingredients[k] <= 0) delete s.inventory.ingredients[k];
        }
        s.inventory.dishes[dish.id] = (s.inventory.dishes[dish.id] || 0) + 1;
        NT.store.save(s); app.toast('做好了：' + dish.name); app.render(); break;
      }

      /* 玩具 */
      case 'place-toy': {
        var rp = NT.home.placeToy(s, arg);
        app.toast(rp.ok ? '摆好了' : rp.error);
        NT.store.save(s); app.render(); break;
      }
      case 'take-toy':
        NT.home.removeToy(s, arg); NT.store.save(s); app.render(); break;

      /* 交流 */
      case 'topic': app.chatTopic = arg; app.chatLog = []; app.render(); break;
      case 'say': {
        var idx = parseInt(arg, 10);
        var line = NT.home.chat(s, app.chatTopic, idx, Date.now() + ':' + app.chatLog.length);
        if (line) app.sendChat(line.player, line.reply);
        break;
      }
      case 'send-free': {
        var inp = $('chat-input');
        var txt = ((inp && inp.value) || '').trim();
        if (!txt) break;
        if (inp) inp.value = '';
        var st0 = NT.home.state(s);
        var r0 = NT.rng.mulberry32(NT.rng.hashSeed('free:' + Date.now()));
        app.sendChat(txt, U.pick(r0, st0.lines));
        break;
      }
      case 'chat-back': app.chatTopic = null; app.chatLog = []; app.render(); break;

      /* 戳她一下 */
      case 'poke': app.poke(); break;

      /* 出门 */
      case 'out-mode': app.outMode = arg; app.render(); break;
      case 'out-region': app.outRegion = arg; app.render(); break;
      case 'out-bearing': app.outBearing = arg; app.render(); break;
      case 'out-dish': app.outDish = arg; app.render(); break;
      case 'out-rare': {
        var ri = app.outRares.indexOf(arg);
        if (ri >= 0) app.outRares.splice(ri, 1);
        else if (app.outRares.length >= 2) { app.toast('最多带两件'); break; }
        else app.outRares.push(arg);
        app.render(); break;
      }
      case 'depart': app.depart(); break;

      /* 其他 */
      case 'view': app.viewTrip(arg); break;
      case 'save-settings': app.saveSettings(); break;
      case 'test-api': app.testApi(); break;
      case 'reset': if (confirm('确定要清空所有记录吗？此操作不可撤销。')) app.resetAll(); break;
      case 'export': app.exportSave(); break;
      case 'import': app.importSave(); break;
    }
  };

  /* ---------------- 音效映射 ---------------- */

  var ACT_SOUND = {
    modal: 'open', 'close-modal': 'close',
    plant: 'plant', cook: 'cook', 'place-toy': 'toy', 'take-toy': 'blip',
    topic: 'blip', say: 'blip', 'send-free': 'blip',
    depart: 'depart', 'harvest-all': 'harvest',
    scene: 'blip', 'pick-home': 'blip', 'save-settings': 'blip',
    'out-mode': 'blip', 'out-region': 'blip', 'out-bearing': 'blip',
    'out-dish': 'blip', 'out-rare': 'blip'
  };
  function sfxFor(act) {
    var n = ACT_SOUND[act];
    if (n) NT.sfx.play(n);
  }

  /** 包装一层：响音效 + 动作结束后检查成就 */
  var _rawAction = app.action;
  app.action = function (act, arg) {
    sfxFor(act);
    _rawAction.call(app, act, arg);
    app.checkAchievements();
  };

  /**
   * 收起 / 展开下面那一排按钮。
   *
   * 铺满整屏之后底部那排按钮会压住画面（横屏竖屏都一样），收起来就能看全景。
   * 右上角的按钮文字会跟着变：展开时显示"收起"，收起后显示"菜单"。
   */
  app.barHidden = false;
  app.toggleBar = function () {
    app.barHidden = !app.barHidden;
    app.render();
  };

  /**
   * 全屏 / 横屏按钮 —— 三态循环切换，不是"锁死"按钮。
   *
   *   普通（非全屏） --点--> 全屏 --点--> 全屏 + 横屏 --点--> 回到普通
   *
   * 按钮上的字就是"下一戳会干什么"：全屏 / 横屏 / 退出。
   *
   * 为什么非得要这个按钮：网页没有资格自己转屏。浏览器规定只有**已经进入全屏**
   * 才允许锁方向（screen.orientation.lock），而且必须由用户亲手点一下触发。
   * 所以「转手机自动变横屏」在网页里做不到（除非手机自己开着自动旋转），
   * 只能让玩家点两下：一下进全屏、一下锁横屏。
   *
   * 锁不上也不算失败（iOS Safari 不支持锁方向）—— 提示玩家自己把手机横过来。
   */
  app.fsStage = 0;                     // 0=普通  1=全屏  2=全屏+横屏
  app.fsLabels = ['全屏', '横屏', '退出'];

  app.syncFsBtn = function () {
    var b = document.querySelector('.stage-fsbtn');
    if (b) {
      b.textContent = app.fsLabels[app.fsStage] || app.fsLabels[0];
      b.setAttribute('title', '当前：' + (app.fsStage === 0 ? '普通' :
        (app.fsStage === 1 ? '全屏' : '全屏横屏')) + '　点一下切到下一步');
    }
  };

  app.toggleFullscreen = function () {
    var d = document, root = d.documentElement;
    var inFs = !!(d.fullscreenElement || d.webkitFullscreenElement);

    // 玩家用 Esc / 返回手势退出了全屏，状态要跟着归零，否则会错位
    if (!inFs && app.fsStage !== 0) { app.fsStage = 0; app.syncFsBtn(); }

    // ---- 第 1 态：普通 -> 进全屏 ----
    if (app.fsStage === 0) {
      var req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!req) { app.toast('这个浏览器不支持全屏，把手机横过来就行'); return; }
      var ok1 = function () { app.fsStage = 1; app.syncFsBtn(); };
      var bad1 = function () { app.toast('全屏没打开，把手机横过来'); };
      try {
        var p = req.call(root);
        if (p && p.then) p.then(ok1, bad1); else setTimeout(ok1, 250);
      } catch (e) { bad1(); }
      return;
    }

    // ---- 第 2 态：全屏 -> 再锁横屏 ----
    if (app.fsStage === 1) {
      var o = screen.orientation || screen.mozOrientation;
      if (o && o.lock) {
        try {
          var q = o.lock('landscape');
          var ok2 = function () { app.fsStage = 2; app.syncFsBtn(); };
          var bad2 = function () { app.toast('这个浏览器不给锁方向，把手机横过来'); };
          if (q && q.then) q.then(ok2, bad2); else ok2();
          return;
        } catch (e) { /* 落到下面给提示 */ }
      }
      app.toast('把手机横过来');
      return;
    }

    // ---- 第 3 态：全屏横屏 -> 全退回普通 ----
    var exit = d.exitFullscreen || d.webkitExitFullscreen;
    if (exit) { try { exit.call(d); } catch (e) { } }
    app.fsStage = 0;
    app.syncFsBtn();
  };

  // 系统手势 / Esc 退出全屏时，把状态和按钮文字一起同步回来
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!inFs && app.fsStage !== 0) { app.fsStage = 0; app.syncFsBtn(); }
    });
  });

  app.autoLocate = function () {
    app.save.homeId = 'nod_krai';
    app.save.homeChosen = true;
    NT.store.save(app.save);
    app.toast('游戏所在地：挪德卡莱');
    app.screen = 'home';
    app.render();
  };

  app.depart = function () {
    var s = app.save;
    var opts = { mode: app.outMode, dishId: app.outDish, rareItemIds: app.outRares, now: Date.now() };
    if (app.outMode === 'region') {
      if (!app.outRegion) { app.toast('先选一个地区'); return; }
      opts.regionId = app.outRegion;
    }
    if (app.outMode === 'bearing') opts.bearingId = app.outBearing;
    var r = NT.clock.depart(s, opts);
    if (!r.ok) { app.toast(r.error); return; }
    app.outRares = []; app.outDish = 'none';
    NT.store.save(s);
    app.modal = 'waiting';     // 出发时自动打开一次；关掉之后靠顶部倒计时条随时点回来
    app.render();
  };

  /* 说明：以前这里有个 completeNow（"立即完成旅行"调试按钮）。
     调试完成后已经移除，界面上不再有任何调试入口。 */

  app.viewTrip = function (id) {
    var list = app.save.album;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { app.viewing = list[i]; app.modal = 'result'; app.render(); app.pushModalHistory(); return; }
    }
  };

  app.saveSettings = function () {
    var s = app.save.settings;
    s.aiEnabled = false;
    var snd = $('sound-enabled');
    if (snd) { s.sound = !!snd.checked; NT.sfx.setEnabled(s.sound); }
    var vs = $('visitor-stay');
    if (vs) s.visitorStay = vs.value;
    app.save.homeId = 'nod_krai';
    app.save.homeChosen = true;
    NT.store.save(app.save); app.toast('设置已保存'); app.render();
  };

  app.testApi = function () {
    app.toast('AI 功能尚未启用，后续需通过安全后端代理接入。');
  };

  app.resetAll = function () {
    app.save = NT.store.reset();
    app.screen = 'home'; app.viewing = null; app.render(); app.toast('已清空');
  };

  app.exportSave = function () {
    var blob = new Blob([NT.store.exportJSON(app.save)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'columbina-travel-save.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 800);
  };

  /* ---------------- 渲染 ---------------- */

  app.render = function () {
    if (app._raf) { cancelAnimationFrame(app._raf); app._raf = null; }
    var rootEl = $('screen'); if (!rootEl) return;
    if (app.loading) {
      rootEl.className = 'screen screen-loading';
      rootEl.innerHTML = app.viewLoading();
      app.updateLoadingProgress();
      return;
    }
    // chooseHome 是旧版兼容值；即使旧链接带上它，也统一落到庭院，不再显示选择页。
    var fn = app.screen === 'farm' ? app.viewFarm :
        (app.screen === 'hall' ? app.viewHall :
          (app.screen === 'bedroom' ? app.viewBedroom :
            (app.screen === 'backyard' ? app.viewBackyard :
              (app.screen === 'bath' ? app.viewBath :
                app.viewHome))));
    // 渲染函数一旦抛异常，innerHTML 就什么都不会被写入 —— 表现是"点了没反应"。
    // 所以这里必须捕获并把错误显示出来，否则问题完全静默。
    var html;
    try {
      html = fn.call(app);
    } catch (e) {
      html = app.renderError(e);
    }
    rootEl.innerHTML = html;
    rootEl.className = 'screen screen-' + app.screen;
    try {
      app.mount();
    } catch (e2) {
      var box = document.createElement('div');
      box.className = 'render-error';
      box.textContent = '渲染出错：' + (e2 && e2.message ? e2.message : e2);
      rootEl.appendChild(box);
    }
  };

  /** 渲染失败时的可见兜底（不要再让错误静默消失） */
  app.renderError = function (e) {
    var msg = (e && e.stack) ? e.stack : String(e);
    return '<div class="stage-wrap"><div class="stage-box">' +
      '<div class="stage" style="background:#1b1915;display:flex;align-items:center;' +
      'justify-content:center">' +
      '<div style="color:#d98b7a;font-size:14px;max-width:78%;max-height:70%;overflow:auto;' +
      'text-align:left">' +
      '<b>这个页面出错了</b>' +
      '<pre style="white-space:pre-wrap;font-size:11.5px;margin:.8em 0;color:#a49c8c">' +
      esc(msg) + '</pre>' +
      '<button class="sbtn" data-act="close-modal">回到家里</button>' +
      '</div></div></div></div>';
  };

  /** 当前应该显示的弹窗。
   *  注意：她出门时**不再强制接管** —— 以前这里的 return 'waiting' 会把她出门后的
   *  所有界面都锁死（弹窗关不掉、别的界面进不去）。现在只在出发那一刻自动打开一次，
   *  关掉之后靠常驻的倒计时条随时点回来。 */
  app.activeModal = function () {
    return app.modal;
  };

  /** 画面内的半透明弹窗 */
  app.renderModalLayer = function () {
    var id = app.activeModal();
    if (!id) return '';
    var M = {
      kitchen: { title: '厨房', body: app.viewKitchen },
      toys: { title: '玩具箱', body: app.viewToys },
      chat: { title: app.chatTopic ? (NT.home.topicById(app.chatTopic) || {}).label || '聊聊' : '和哥伦比娅说说话', body: app.viewChat },
      album: { title: '明信片册', body: app.viewAlbum },
      settings: { title: '设置', body: app.viewSettings },
      outdoor: { title: '出门', body: app.viewOutdoor },
      store: { title: '仓库', body: app.viewStore },
      achievements: { title: '成就', body: app.viewAchievements },
      waiting: { title: '旅途中', body: app.viewWaiting },
      result: { title: '明信片到了', body: app.viewResult }
    }[id];
    if (!M) return '';
    var closable = true;   // 所有弹窗都能关，包括"旅途中"
    return '<div class="modal-layer" data-act="close-modal">' +
      '<div class="modal" data-act="noop">' +
      '<div class="modal-head"><b>' + esc(M.title) + '</b>' +
      (closable ? '<button class="sbtn small" data-act="close-modal">关闭</button>' : '') +
      '</div>' +
      '<div class="modal-body" id="modal-body">' + M.body.call(app) + '</div>' +
      '</div></div>';
  };

  app.mount = function () {
    if (app.screen === 'farm') app.mountFarm();
    else if (app.screen === 'hall') app.mountHall();
    else if (app.screen === 'bedroom') app.mountBedroom();
    else if (app.screen === 'backyard') app.mountBackyard();
    else if (app.screen === 'bath') app.mountBath();
    else if (app.screen === 'chooseHome') app.mountHome();
    else app.mountHome();
    var m = app.activeModal();
    if (m === 'result' && app.viewing) app.mountResult();
    if (m === 'album') app.mountAlbum();
    if (m === 'toys') app.mountToys();
    if (m === 'chat') app.mountChat();
    if (m === 'waiting') app.mountWaiting();
  };

  /** 顶栏：所有页面现在都装在画面内的弹窗里，标题由弹窗自己画，这里不再需要 */
  app.header = function () { return ''; };

  /* ---------------- 首次选家乡 ---------------- */

  app.viewChooseHome = function () {
    return '<div class="pad choose">' +
      '<h2>游戏所在地：挪德卡莱</h2>' +
      '<div class="hint" style="margin-top:0">哥伦比娅从挪德卡莱的家园出发，前往提瓦特各地。本游戏不读取现实位置。</div>' +
      '<button class="btn btn-primary" data-act="auto-locate" style="width:100%;margin-top:14px">进入家园</button>' +
      '</div>';
  };

  function dirName(b) {
    return ({ n: '北方', s: '南方', e: '东部', w: '西部', c: '中部' })[b] || '';
  }

  /* ---------------- 家 ---------------- */

  app.viewHome = function () {
    var s = app.save;

    var st = NT.home.state(s);
    var toy = NT.home.playingToy(s);
    var line = toy ? NT.home.toyLine(s, toy) : NT.home.stateLine(s);
    var spot = NT.home.spot(s);
    var ready = NT.farm.hasReady(s, Date.now());
    var cookable = NT.data.cookableDishes(s.inventory.ingredients).length;
    // 来访的同伴（可能没有）
    var visitor = (function () {
      var c = NT.home.visitorCompanion(s);
      var st2 = NT.home.visitorState(s);
      return (c && st2) ? { comp: c, vst: st2 } : null;
    })();

    function badge(n) { return n ? '<i>' + n + '</i>' : ''; }

    return '<div class="stage-wrap">' +
      '<div class="stage-box">' +
      // 手机上这一层负责横向滚动（宽屏上 display:contents，等于不存在）
      '<div class="stage-scroll">' +
      '<div class="stage" id="stage">' +
      '<canvas id="world-bg"></canvas>' +
      '<canvas id="world-fg"></canvas>' +
      '<div class="stage-top">' +
      (s.activeTrip
        ? '<span class="state-badge away">旅途中</span><span class="state-spot">她不在家</span>'
        : '<span class="state-badge">' + st.name + '</span>' +
          '<span class="state-spot">' + (st.id === 'sleep' ? '她在卧室睡觉' : '在' + esc(spot ? spot.label : '')) + '</span>') +
      (visitor ? '<span class="visitor-chip">' + esc(visitor.comp.name) + '来串门 · ' +
        esc(visitor.vst.name) + '</span>' : '') +
      '</div>' +
      // 右上角一组按钮。用 flex 排，别各自算 right，省得改一个就要动一串
      // 右上角就两个：全屏/横屏（手机才有）和设置。
      // 要收的是**底边那排按钮**，所以收起按钮在下面，不在这儿。
      '<div class="stage-tools">' +
      '<button class="stage-gear w stage-fsbtn" data-act="fullscreen" title="全屏 / 横屏">全屏</button>' +
      '<button class="stage-gear" data-act="modal" data-arg="settings" title="设置">⚙</button>' +
      '</div>' +
      '<div class="bubble" id="nahida-bubble"></div>' +
      '<div class="bubble visitor" id="visitor-bubble"></div>' +
      // 她在家 -> 淡出的提示；她出门了 -> 常驻的回家倒计时（独立元素，不继承提示的淡出动画）
      (s.activeTrip
        ? '<div class="stage-countdown" id="home-countdown" data-act="modal" data-arg="waiting"' +
          ' title="查看旅途详情">' + app.countdownHTML() + '</div>'
        : '<div class="stage-hint">点她一下试试</div>') +
      '</div>' +
      '</div>' +                       // 收掉 .stage-scroll
      // 「建议横屏」不写在这里 —— 它不参与 render，由 maybeShowRotateHint 单独插
      '<div class="home-controls' + (app.barHidden ? ' bar-hidden' : '') + '">' +
      '<div class="stage-bar">' +
      // 她出门了就把按钮换成"旅途中"，点它打开旅途面板，而不是又送一次
      (s.activeTrip
        ? '<button class="sbtn busy" data-act="modal" data-arg="waiting">旅途中…</button>'
        : '<button class="sbtn go" data-act="modal" data-arg="outdoor">送她出门</button>') +
      '<button class="sbtn' + (ready ? ' hot' : '') + '" data-act="go" data-arg="farm">田地' +
      (ready ? '<i>可收获</i>' : '') + '</button>' +
      '<button class="sbtn" data-act="go" data-arg="bedroom">卧室</button>' +
      '<button class="sbtn" data-act="go" data-arg="backyard">后院</button>' +
      '<button class="sbtn" data-act="go" data-arg="bath">沐浴</button>' +
      '<button class="sbtn" data-act="modal" data-arg="kitchen">厨房' + badge(cookable) + '</button>' +
      '<button class="sbtn" data-act="modal" data-arg="toys">玩具' + badge((s.toys || []).length) + '</button>' +
      '<button class="sbtn" data-act="modal" data-arg="store">仓库' + badge(storeCount(s)) + '</button>' +
      '<button class="sbtn" data-act="modal" data-arg="achievements">成就' +
      badge(NT.achievements.count(s)) + '</button>' +
      '<button class="sbtn" data-act="modal" data-arg="chat">聊聊</button>' +
      '<button class="sbtn" data-act="modal" data-arg="album">明信片' + badge((s.album || []).length) + '</button>' +
      '</div>' +
      '</div>' +
      // 收起/展开底边那排按钮。**必须放在 .home-controls 外面**，
      // 否则它自己也跟着收起来，就再也点不开了。
      '<button class="bar-toggle' + (app.barHidden ? ' up' : '') + '" data-act="toggle-bar"' +
        ' title="收起 / 展开下面的菜单">' + (app.barHidden ? '菜单 ▲' : '收起 ▼') + '</button>' +
      app.renderModalLayer() +
      '</div>' +
      '</div>';
  };

  /** 从用户主动选择的 JSON 文件恢复本机存档；全程仅在浏览器本地读写。 */
  app.importSave = function () {
    var picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'application/json,.json'; picker.style.display = 'none';
    picker.addEventListener('change', function () {
      var file = picker.files && picker.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var candidate = U.tryJSON(String(reader.result || ''), null);
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          app.toast('导入失败：请选择有效的存档 JSON 文件。'); return;
        }
        // load() 统一补齐旧存档缺失字段并保留版本迁移；不向网络发送文件内容。
        NT.store.save(candidate);
        app.save = NT.store.load();
        NT.home.repair(app.save);
        NT.achievements.ensureStats(app.save);
        NT.store.save(app.save);
        app.modal = null; app.fieldSheet = null; app.screen = 'home';
        app.render(); app.replaceHistory(); app.toast('存档已导入。');
      };
      reader.onerror = function () { app.toast('导入失败：文件无法读取。'); };
      reader.readAsText(file, 'utf-8');
    });
    document.body.appendChild(picker);
    picker.click();
    setTimeout(function () { if (picker.parentNode) picker.parentNode.removeChild(picker); }, 1000);
  };

  app.viewLoading = function () {
    return '<div class="loading-screen" role="status" aria-live="polite">' +
      '<div class="loading-card"><div class="loading-mark">月</div>' +
      '<h1>哥伦比娅的旅行</h1><p id="loading-label">正在准备游戏素材</p>' +
      '<div class="loading-track"><i id="loading-progress"></i></div>' +
      '<small>素材加载完成后进入庭院</small></div></div>';
  };

  /* ---------------- 大厅与卧室 ---------------- */

  app.viewHall = function () {
    var s = app.save;
    var ready = NT.farm.hasReady(s, Date.now());
    return '<div class="stage-wrap scene-wrap hall-wrap">' +
      '<div class="stage-box"><div class="stage scene-stage" id="hall-stage">' +
      '<canvas id="hall-bg"></canvas>' +
      '<div class="stage-top"><span class="state-badge">大厅</span><span class="state-spot">挪德卡莱的家</span></div>' +
      '<div class="scene-title"><b>哥伦比娅的旅行</b><span>从这里前往家园、卧室与田地</span></div>' +
      '<div class="scene-actions">' +
      '<button class="sbtn go" data-act="go" data-arg="home">进入家园</button>' +
      '<button class="sbtn" data-act="go" data-arg="bedroom">进入卧室</button>' +
      '<button class="sbtn" data-act="go" data-arg="backyard">进入后院</button>' +
      '<button class="sbtn' + (ready ? ' hot' : '') + '" data-act="go" data-arg="farm">前往田地' +
      (ready ? '<i>可收获</i>' : '') + '</button>' +
      '</div></div></div></div>';
  };

  app.viewBedroom = function () {
    return '<div class="stage-wrap scene-wrap bedroom-wrap">' +
      '<div class="stage-box"><div class="stage scene-stage" id="bedroom-stage">' +
      '<canvas id="bedroom-bg"></canvas><canvas id="bedroom-fg"></canvas>' +
      '<div class="stage-top"><span class="state-badge">卧室</span><span class="state-spot">哥伦比娅正在床上休息</span></div>' +
      // 戳她的台词：单独一个气泡，位置就是原来那行"她只会在卧室的床上睡觉"提示的位置
      '<div class="bubble sleep" id="sleep-bubble"></div>' +
      '<div class="scene-actions"><button class="sbtn go" data-act="go" data-arg="home">返回庭院</button></div>' +
      '</div></div></div>';
  };

  function mountSceneCanvas(stage, bg, image, fallbackTop, fallbackBottom, panX, panY, zoom) {
    if (!stage || !bg) return;
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.max(640, Math.round((rect.width || 1280) * dpr));
    var H = Math.max(360, Math.round((rect.height || 720) * dpr));
    bg.width = W; bg.height = H;
    var ctx = bg.getContext('2d');
    if (!(image && NT.assets.drawCover(ctx, image, W, H, panX || 0, panY || 0, zoom || 1))) {
      var grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, fallbackTop); grad.addColorStop(1, fallbackBottom);
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    stage.style.fontSize = U.clamp((rect.width || 1280) / 62, root.innerWidth <= 899 ? 16 : 9, 20).toFixed(2) + 'px';
  }

  app.mountHall = function () {
    if (app._hallBackgroundIndex === null && NT.assets && NT.assets.hallVariantCount) {
      var count = NT.assets.hallVariantCount();
      app._hallBackgroundIndex = pickBackgroundVariant(count, null);
    }
    mountSceneCanvas($('hall-stage'), $('hall-bg'), NT.assets && NT.assets.hall(app._hallBackgroundIndex), '#253d37', '#101714', 0, 0, 1);
  };

  app.mountBedroom = function () {
    var stage = $('bedroom-stage'), bg = $('bedroom-bg'), fg = $('bedroom-fg');
    var s = app.save;
    var m = NT.assetManifest || {};

    // 睡觉场景：每次睡着（since 变化）从候选图里随机挑一张，直接当**背景层**用 ——
    // 也就是替换原来的 卧室.png，UI（按钮、角标、说明）照旧浮在它上面。
    // 这些图里已经画好了"她躺在床上睡着"，所以这一场**不再画立绘**，免得出现两个她。
    var sleeps = (NT.assets && NT.assets.bedroomSleeps) ? NT.assets.bedroomSleeps() : [];
    var sleepKey = 'sleep:' + ((s && s.home && s.home.nahida) ? s.home.nahida.since : 0);
    if (app._sleepKey !== sleepKey) {
      app._sleepKey = sleepKey;
      app._sleepPick = sleeps.length ? Math.floor(Math.random() * sleeps.length) : 0;
    }
    var sleepImg = sleeps.length ? sleeps[app._sleepPick % sleeps.length] : null;

    if (sleepImg) {
      // 整幅睡觉图铺满背景层：等比裁剪（cover），不拉伸，不改素材比例。
      mountSceneCanvas(stage, bg, sleepImg, '#392b2a', '#171113', 0, 0, 1);
    } else {
      // 没有睡觉图（清单为空 / 全部加载失败）时退回旧表现：卧室背景 + 立绘。
      // 卧室重点在左侧床铺：移动裁剪窗口但仍保持等比，不拉伸图片。
      mountSceneCanvas(stage, bg, NT.assets && NT.assets.bedroom(), '#392b2a', '#171113', 0.10, 0, 1);
    }
    if (!stage) return;

    // 睡觉图还没加载完（例如带 ?screen=bedroom 直接进卧室）：它一旦到位就重画场景。
    if (!sleepImg && m.bedroomSleep) {
      var waits = 0;
      var waitSleep = function () {
        if (app.screen !== 'bedroom') return;                 // 已经离开卧室，别再管
        if ((NT.assets.bedroomSleeps() || []).length) { app.render(); return; }
        var stat = NT.assets.status();
        if (stat.ready + stat.error >= stat.total || ++waits > 80) return;   // 没在加载了 / 等够了就放弃
        setTimeout(waitSleep, 120);
      };
      setTimeout(waitSleep, 120);
    }

    // 点画面任意位置都能戳她：不额外盖一层按钮或热区，免得挡住她。
    stage.onclick = function () { app.pokeSleep(); };

    if (!fg) return;
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.max(640, Math.round((rect.width || 1280) * dpr));
    var H = Math.max(360, Math.round((rect.height || 720) * dpr));
    fg.width = W; fg.height = H;
    var ctx = fg.getContext('2d');
    ctx.clearRect(0, 0, W, H);         // 前景层这一场不用（睡觉图里已经有人物）

    if (sleepImg) return;

    // ---- 退回旧表现：在背景上手绘她不动的睡姿 ----
    // 以床垫右侧为脚底锚点：人物略微放大并右移，仍完整落在床面，不随窗口比例漂移。
    var chH = H * 0.75, cx = W * 0.47, feetY = H * 0.70;
    var sprite = { hair: '#d9d6e8', dress: '#565070', accent: '#b8c8f4', skin: '#f3d8cf', hat: 'none' };
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(cx, feetY + H * 0.004, chH * 0.27, chH * 0.07, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save();
      // 床面是横向的，人物顺时针旋转 90° 后与床平行。
      ctx.translate(cx, feetY); ctx.rotate(Math.PI / 2); ctx.translate(-cx, -feetY);
      var ok = NT.assets && NT.assets.drawNahida(ctx, cx, feetY, chH, false, 'tired');
      if (!ok) NT.placeholder.chibi(ctx, cx, feetY, chH, sprite, 'tired', false);
      ctx.restore();
      app._raf = requestAnimationFrame(draw);
    }
    app._raf = requestAnimationFrame(draw);
  };

  /* ---------- 沐浴场景 ---------- */

  app.viewBath = function () {
    return '<div class="stage-wrap scene-wrap bath-wrap">' +
      '<div class="stage-box"><div class="stage scene-stage" id="bath-stage">' +
      '<canvas id="bath-bg"></canvas>' +
      '<div class="stage-top"><span class="state-badge">沐浴</span><span class="state-spot">温泉时光</span></div>' +
      '<div class="scene-actions"><button class="sbtn go" data-act="go" data-arg="home">返回庭院</button></div>' +
      '</div></div></div>';
  };

  app.mountBath = function () {
    var stage = $('bath-stage'), bg = $('bath-bg');
    var baths = (NT.assets && NT.assets.bathSleeps) ? NT.assets.bathSleeps() : [];
    var bathKey = 'bath:' + ((app.save && app.save.home && app.save.home.nahida) ? app.save.home.nahida.since : 0);
    if (app._bathKey !== bathKey) {
      app._bathKey = bathKey;
      app._bathPick = baths.length ? Math.floor(Math.random() * baths.length) : 0;
    }
    var bathImg = baths.length ? baths[app._bathPick % baths.length] : null;
    mountSceneCanvas(stage, bg, bathImg, '#2a3a2a', '#151f15', 0, 0, 1);

    // 浴室图还没加载完：等到位再重画一次
    if (!bathImg && (NT.assetManifest || {}).bath) {
      var waits = 0;
      var waitBath = function () {
        if (app.screen !== 'bath') return;
        if ((NT.assets.bathSleeps() || []).length) { app.render(); return; }
        var stat = NT.assets.status();
        if (stat.ready + stat.error >= stat.total || ++waits > 80) return;
        setTimeout(waitBath, 120);
      };
      setTimeout(waitBath, 120);
    }
  };

  app.viewBackyard = function () {
    var s = app.save;
    return '<div class="stage-wrap scene-wrap backyard-wrap">' +
      '<div class="stage-box"><div class="stage scene-stage" id="backyard-stage">' +
      '<canvas id="backyard-bg"></canvas><canvas id="backyard-fg"></canvas>' +
      '<div class="stage-top"><span class="state-badge">后院</span><span class="state-spot">玩具和月灵都在这里玩</span></div>' +
      '<div class="backyard-note">后院是哥伦比娅玩玩具的地方</div>' +
      '<div class="scene-actions"><button class="sbtn go" data-act="go" data-arg="home">返回庭院</button>' +
      '<button class="sbtn" data-act="modal" data-arg="toys">玩具箱' +
      ((s.toys || []).length ? '<i>' + s.toys.length + '</i>' : '') + '</button>' +
      '</div>' +
      app.renderModalLayer() +
      '</div></div></div>';
  };

  app.mountBackyard = function () {
    var s = app.save;
    var stage = $('backyard-stage'), bg = $('backyard-bg'), fg = $('backyard-fg');
    mountSceneCanvas(stage, bg, NT.assets && NT.assets.backyard(), '#152f62', '#081329', 0, 0, 1);
    if (!stage || !fg) return;
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.max(640, Math.round((rect.width || 1280) * dpr));
    var H = Math.max(360, Math.round((rect.height || 720) * dpr));
    fg.width = W; fg.height = H;
    var ctx = fg.getContext('2d');
    var chH = H * 0.23, now = Date.now(), phase = 0, last = performance.now();
    // 后院有自己的玩具槽位表（NT.data.backyardSlots）：同一排、行距 0.19，
    // 手机竖屏裁剪时也能同时看到玩具和她。
    var sprite = { hair: '#d9d6e8', dress: '#565070', accent: '#b8c8f4', skin: '#f3d8cf', hat: 'none' };
    function draw() {
      var t = performance.now(), dt = U.clamp((t - last) / 1000, 0, 0.1); last = t; phase += dt * 1.6;
      ctx.clearRect(0, 0, W, H);

      var layout = NT.home.backyardLayout(s);
      var items = layout.map(function (it) {
        return { kind: 'toy', x: it.x, y: it.y, toyId: it.toyId };
      });
      // 只要没有出门，后院始终能看到哥伦比娅；玩耍时站到那件玩具跟前。
      if (!s.activeTrip) {
        var st = NT.home.state(s), playing = st.useToy && NT.home.playingToy(s);
        // 站位由 home.backyardSpot 算：它保证她不会踩到/压住**别的**玩具
        var spot = playing
          ? NT.home.backyardSpot(s, playing.id, { W: W, H: H, chH: chH }, 1)
          : { x: 0.52, y: 0.86 };
        items.push({ kind: 'her', x: spot.x, y: spot.y, mood: st.mood });
      }

      // 按脚底 y 排序（远的先画）：她站在玩具前面时才正确地挡住玩具，
      // 也不会出现"她在后面却被画在玩具上面"。
      items.sort(function (a, b) { return a.y - b.y; });

      items.forEach(function (it) {
        if (it.kind === 'toy') {
          var th = chH * NT.data.toySize(it.toyId);
          if (!(NT.assets && NT.assets.drawToy(ctx, W * it.x, H * it.y, th, it.toyId))) {
            NT.placeholder.toy(ctx, it.toyId, W * it.x, H * it.y, th, NT.rng.mulberry32(31));
          }
          return;
        }
        var cx = W * it.x, feetY = H * it.y, bob = Math.sin(phase) * chH * 0.012;
        ctx.save(); ctx.globalAlpha = 0.2; ctx.fillStyle = '#000'; ctx.beginPath();
        ctx.ellipse(cx, feetY + H * 0.004, chH * 0.26, chH * 0.07, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        var ok = NT.assets && NT.assets.drawNahida(ctx, cx, feetY - bob, chH, false, it.mood);
        if (!ok) NT.placeholder.chibi(ctx, cx, feetY - bob, chH, sprite, it.mood, false);
      });

      app._raf = requestAnimationFrame(draw);
    }
    app._raf = requestAnimationFrame(draw);
  };

  /* ---------------- 独立田地 ---------------- */

  app.viewFarm = function () {
    var s = app.save;
    var now = Date.now();
    var readyCount = 0;
    var plots = NT.data.fields.map(function (field) {
      var status = NT.farm.status(s, field.id, now);
      if (status.state === 'ready') readyCount++;
      // 田块上不再放作物图片和文字：种植/成熟的样子由绿芽画在画布上（见 mountFarm）。
      // 这里只留一个透明热区，点它打开这块田的操作面板。
      var label = field.name + (status.state === 'empty' ? '，空地' :
        '，' + status.crop.name + (status.state === 'ready' ? '，可收获' :
          '，生长 ' + Math.round(status.progress * 100) + '%'));
      return '<button class="farm-plot ' + field.type + ' ' + status.state + '"' +
        ' data-act="open-field" data-arg="' + field.id + '"' +
        ' aria-label="' + esc(label) + '"' +
        ' style="left:' + (field.x * 100) + '%;top:' + (field.y * 100) + '%;' +
        'width:' + (field.w * 100) + '%;height:' + (field.h * 100) + '%">' +
        '</button>';
    }).join('');

    return '<div class="stage-wrap farm-wrap">' +
      '<div class="farm-stage-box">' +
      '<div class="farm-stage" id="farm-stage">' +
      '<canvas id="farm-bg"></canvas><canvas id="farm-fg"></canvas>' +
      '<div class="stage-top"><span class="state-badge">田地</span>' +
      (s.activeTrip
        ? '<span class="state-spot">哥伦比娅正在旅行</span>'
        : '<span class="state-spot">哥伦比娅也来到了田地</span>') +
      (readyCount ? '<span class="visitor-chip">' + readyCount + ' 块可收获</span>' : '') +
      '</div>' +
      '<div class="stage-tools"><button class="stage-gear farm-back" data-act="go" data-arg="home">回家</button></div>' +
      plots +
      (app.fieldSheet ? app.viewFieldSheet(app.fieldSheet) : '') +
      '<div class="home-controls farm-controls"><div class="stage-bar">' +
      '<button class="sbtn' + (readyCount ? ' hot' : '') + '" data-act="harvest-all">收全部' +
      (readyCount ? '<i>' + readyCount + '</i>' : '') + '</button>' +
      '<button class="sbtn" data-act="go" data-arg="home">返回家园</button>' +
      '</div></div>' +
      '</div></div></div>';
  };

  /** 田地就地操作面板（浮在画面里） */
  app.viewFieldSheet = function (fieldId) {
    var s = app.save;
    var now = Date.now();
    var field = NT.data.fieldById(fieldId);
    var st = NT.farm.status(s, fieldId, now);
    var body;
    if (st.state === 'empty') {
      var crops = NT.data.cropsForField(fieldId).map(function (c) {
        var img = NT.assets && NT.assets.crop(c.id);
        var art = img
          ? '<img class="crop-thumb" src="' + esc(img.src) + '" alt="">'
          : '<span class="crop-thumb crop-thumb-placeholder" aria-hidden="true"></span>';
        return '<button class="chip crop-chip" data-act="plant" data-arg="' + c.id + '">' + art +
          '<span class="crop-name">' + esc(c.name) + '</span>' +
          '<small>' + fmtDur(c.growMs) + '</small></button>';
      }).join('');
      body = '<div class="label">种什么？</div><div class="chips">' + crops + '</div>';
    } else {
      body = '<div class="grow">' +
        '<div class="grow-name">' + st.crop.name + '</div>' +
        '<div class="bar"><i style="width:' + Math.round(st.progress * 100) + '%"></i></div>' +
        '<div class="grow-sub">' + (st.state === 'ready' ? '已经熟了' : '还要 ' + U.humanMs(st.remainMs)) + '</div>' +
        (st.state === 'ready' ? '<button class="sbtn go" data-act="harvest" data-arg="' + fieldId + '">收获</button>' : '') +
        '</div>';
    }
    return '<div class="stage-sheet">' +
      '<div class="sheet-head"><b>' + field.name + '</b>' +
      '<button class="sbtn small" data-act="close-field">关闭</button></div>' +
      '<div class="sheet-body">' + body + '</div>' +
      '</div>';
  };

  /** 田地背景、作物热区和在家的哥伦比娅。背景保持 4:3，不做拉伸。 */
  app.mountFarm = function () {
    var stage = $('farm-stage'), bg = $('farm-bg'), fg = $('farm-fg');
    if (!stage || !bg || !fg) return;

    var wrap = document.querySelector('.farm-wrap');
    if (wrap) {
      wrap.onscroll = function () { app._farmScroll = wrap.scrollLeft; };
      var wantX = app._farmScroll || 0;
      if (wantX) {
        wrap.scrollLeft = wantX;
        requestAnimationFrame(function () { wrap.scrollLeft = wantX; });
      }
    }

    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.max(640, Math.round(rect.width * dpr));
    var H = Math.max(480, Math.round(rect.height * dpr));
    bg.width = W; bg.height = H; fg.width = W; fg.height = H;
    var cssW = rect.width || 1024;
    stage.style.fontSize = U.clamp(cssW / 58, root.innerWidth <= 899 ? 16 : 10, 21).toFixed(2) + 'px';

    var bctx = bg.getContext('2d');
    var farmImg = NT.assets && NT.assets.farm();
    if (!(farmImg && NT.assets.drawCover(bctx, farmImg, W, H))) {
      var assetState = NT.assets && NT.assets.status ? NT.assets.status() : null;
      var assetPending = !!(NT.assets && NT.assets.anyDeclared && NT.assets.anyDeclared() && assetState &&
        assetState.ready + assetState.error < assetState.total);
      var grad = bctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, assetPending ? '#18211e' : '#77b487');
      grad.addColorStop(1, assetPending ? '#101513' : '#4b9270');
      bctx.fillStyle = grad; bctx.fillRect(0, 0, W, H);
    }

    if (app.save.activeTrip) { /* 她出门了：不画人，但田里的绿芽照常显示 */ }

    var fctx = fg.getContext('2d');
    var chH = H * 0.23;
    // 田地前景中央是可通行草地，人物固定站在这里，避开六块田和水池。
    var cx = W * 0.54, feetY = H * 0.86;
    var phase = 0, last = performance.now();
    var sprite = { hair: '#d9d6e8', dress: '#565070', accent: '#b8c8f4', skin: '#f3d8cf', hat: 'none' };
    var fields = NT.data.fields;
    // "一个汉字的大小" = 田地场景实际用的字号（上面刚设过），换算到画布像素。
    // 绿芽微调都以它为单位，这样换屏幕尺寸也不会失真。
    var charUnit = (parseFloat(stage.style.fontSize) || 16) * dpr;

    /**
     * 一株小绿芽。种下去就长出来，收获后地块变空自然就不画了。
     * grow: 0..1 生长进度（成熟 = 1，会更大更亮一点）。
     */
    function drawSprout(g, x, y, size, grow, t) {
      var sway = Math.sin(t * 1.7 + x * 0.013 + y * 0.007) * size * 0.10;
      var h = size * (0.72 + 0.34 * grow);
      g.save();
      g.translate(x, y);
      // 落在土上的淡影
      g.globalAlpha = 0.16; g.fillStyle = '#000';
      g.beginPath(); g.ellipse(0, 0, h * 0.42, h * 0.13, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      // 茎
      g.lineCap = 'round';
      g.strokeStyle = '#4d9a46';
      g.lineWidth = Math.max(1.6, h * 0.11);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(sway * 0.4, -h * 0.55, sway, -h);
      g.stroke();
      // 左右两片叶子
      g.fillStyle = '#6cc25c';
      g.beginPath(); g.ellipse(sway - h * 0.30, -h * 0.60, h * 0.32, h * 0.16, -0.55, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(sway + h * 0.30, -h * 0.78, h * 0.32, h * 0.16, 0.55, 0, Math.PI * 2); g.fill();
      // 顶芽（成熟时偏亮）
      g.fillStyle = grow >= 0.999 ? '#a8e88f' : '#83d472';
      g.beginPath(); g.arc(sway, -h, h * 0.14, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    /** 所有非空地：每块田按 2×2 垄各画一株芽（可按象限微调，见 farm.js 的 sproutOffsets） */
    function drawFieldSprouts(g, t) {
      var nowMs = Date.now();
      // 象限顺序与 tl/tr/bl/br 对应：sx/sy 是 ±1 的方向
      var QUADS = [['tl', -1, -1], ['tr', 1, -1], ['bl', -1, 1], ['br', 1, 1]];
      for (var i = 0; i < fields.length; i++) {
        var fld = fields[i];
        var stt = NT.farm.status(app.save, fld.id, nowMs);
        if (stt.state === 'empty') continue;                 // 空地不长芽
        var pw = W * fld.w, ph = H * fld.h;
        var size = Math.min(pw, ph) * 0.34;
        var grow = stt.state === 'ready' ? 1 : stt.progress;
        var baseX = W * fld.x, baseY = H * fld.y;
        var off = fld.sproutOffsets || {};
        for (var qi = 0; qi < QUADS.length; qi++) {
          var q = QUADS[qi], adj = off[q[0]];
          var ox = adj ? adj[0] * charUnit : 0;
          var oy = adj ? adj[1] * charUnit : 0;
          drawSprout(g, baseX + q[1] * pw * 0.24 + ox, baseY + q[2] * ph * 0.24 + oy, size, grow, t);
        }
      }
    }

    function drawFarmNahida(t) {
      var dt = U.clamp((t - last) / 1000, 0, 0.1); last = t; phase += dt * 1.6;
      fctx.clearRect(0, 0, W, H);

      // 先画田里的芽，再画人：她站在前景，会压住离镜头近的芽
      drawFieldSprouts(fctx, phase);

      if (!app.save.activeTrip) {
        var bob = Math.sin(phase) * chH * 0.012;
        fctx.save();
        fctx.globalAlpha = 0.22; fctx.fillStyle = '#000'; fctx.beginPath();
        fctx.ellipse(cx, feetY + H * 0.004, chH * 0.26, chH * 0.07, 0, 0, Math.PI * 2); fctx.fill();
        fctx.restore();
        var ok = NT.assets && NT.assets.drawNahida(fctx, cx, feetY - bob, chH, true, 'idle');
        if (!ok) NT.placeholder.chibi(fctx, cx, feetY - bob, chH, sprite, 'idle', true);
      }

      app._raf = requestAnimationFrame(drawFarmNahida);
    }
    app._raf = requestAnimationFrame(drawFarmNahida);
  };

  /** 仓库里一共有多少件东西（食材 + 料理 + 稀有道具） */
  function storeCount(s) {
    var n = 0, k;
    for (k in s.inventory.ingredients) n += s.inventory.ingredients[k];
    for (k in s.inventory.dishes) n += s.inventory.dishes[k];
    for (k in s.inventory.rare) n += s.inventory.rare[k];
    return n;
  }

  /** 仓库：食材 / 料理 / 稀有道具，以及"稀有道具从哪来" */
  app.viewStore = function () {
    var s = app.save;
    var inv = s.inventory;

    /* --- 食材 --- */
    var ingIds = Object.keys(inv.ingredients);
    var ingHtml = ingIds.length
      ? '<div class="pills">' + ingIds.map(function (k) {
          return '<span class="pill">' + NT.data.ingredientName(k) + ' ×' + inv.ingredients[k] + '</span>';
        }).join('') + '</div>'
      : '<div class="muted">还没有食材。进入田地，在六块田里种点什么。</div>';

    /* --- 料理 --- */
    var dishIds = Object.keys(inv.dishes);
    var dishHtml = dishIds.length
      ? '<div class="pills">' + dishIds.map(function (k) {
          var d = NT.data.dishById(k);
          return '<span class="pill">' + (d ? d.name : k) + ' ×' + inv.dishes[k] + '</span>';
        }).join('') + '</div>'
      : '<div class="muted">还没有做好的食物。去厨房用食材做。</div>';

    /* --- 稀有道具（含来源与效果） --- */
    var dropHtml = NT.data.rareDrops.map(function (r) {
      var own = inv.rare[r.id] || 0;
      return '<div class="drop' + (own ? ' own' : '') + '">' +
        '<div class="drop-head"><b>' + r.name + '</b>' +
        (own ? '<span class="drop-own">持有 ×' + own + '</span>' : '<span class="drop-none">还没有</span>') +
        '</div>' +
        '<div class="drop-desc">' + esc(r.desc) + '</div>' +
        '<div class="drop-eff">出门带上它：行程 +' + r.foodKm + 'km' +
        (r.scoreBonus ? '　稀有度 +' + r.scoreBonus : '') +
        (r.meetBonus ? '　遇同伴 +' + Math.round(r.meetBonus * 100) + '%' : '') +
        '</div>' +
        '<div class="drop-src">获得方式：收获作物时 ' + (r.dropChance * 100).toFixed(1) + '% 几率掉落</div>' +
        '</div>';
    }).join('');

    return '<div class="label" style="margin-top:0">食材</div>' + ingHtml +
      '<div class="label">料理</div>' + dishHtml +
      '<div class="label">稀有道具</div>' +
      '<div class="hint" style="margin:0 0 .7em">' +
      '它们不影响明信片内容，只提高"走多远"和"拿到稀有明信片的概率"。种地收获时随机掉，' +
      '出门时可以带上（最多两件，会消耗掉）。</div>' +
      '<div class="drops">' + dropHtml + '</div>';
  };

  /** 成就 */
  app.viewAchievements = function () {
    var s = app.save;
    var p = NT.achievements.progress(s);
    var all = NT.achievements.list(s);
    var groups = NT.data.achievementGroups.map(function (g) {
      var items = all.filter(function (x) { return x.def.group === g.id; });
      if (!items.length) return '';
      var got = items.filter(function (x) { return x.unlocked; }).length;
      return '<div class="ach-group">' +
        '<div class="ach-group-head"><b>' + g.name + '</b>' +
        '<span>' + got + ' / ' + items.length + '</span></div>' +
        '<div class="achs">' + items.map(function (x) {
          return '<div class="ach' + (x.unlocked ? ' on' : '') + '">' +
            '<span class="ach-icon">' + x.def.icon + '</span>' +
            '<div class="ach-body"><b>' + esc(x.def.name) + '</b>' +
            '<span>' + esc(x.def.desc) + '</span></div>' +
            (x.unlocked ? '<span class="ach-yes">✓</span>' : '') +
            '</div>';
        }).join('') + '</div></div>';
    }).join('');
    return '<div class="ach-total">已解锁 <b>' + p.unlocked + ' / ' + p.total + '</b>' +
      (p.unlocked === p.total ? '　全部达成 🎉' : '') + '</div>' + groups;
  };

  /* ---- 家的实时绘制 ---- */

  app.mountHome = function () {
    var bg = $('world-bg'), fg = $('world-fg'), stage = $('stage');
    if (!bg || !fg || !stage) return;

    if (app._homeBackgroundIndex === null && NT.assets && NT.assets.homeVariantCount) {
      var homeCount = NT.assets.homeVariantCount();
      app._homeBackgroundIndex = pickBackgroundVariant(homeCount, null);
    }

    // 手机上画面比屏幕宽、靠 .stage-wrap 横向拖。render 会重建 DOM，
    // 滚动位置会被清零 —— 手感就是"怎么滑都滑不过去"。所以位置要跨渲染保住。
    // 注意：mountHome 是在 innerHTML 之后同步跑的，这时还没布局，
    // 直接设 scrollLeft 会被丢掉，所以下一帧再补一次。
    var wrap = document.querySelector('.stage-wrap');
    if (wrap) {
      wrap.onscroll = function () { app._stageScroll = wrap.scrollLeft; };
      var wantX = app._stageScroll || 0;
      if (wantX) {
        wrap.scrollLeft = wantX;
        requestAnimationFrame(function () { wrap.scrollLeft = wantX; });
      }
    }

    // 竖屏提示只在本次会话里尝试一次（它自己按 24 小时判断要不要真显示）
    if (!app._rotateHintTried) { app._rotateHintTried = true; app.maybeShowRotateHint(); }

    // --- 画布按实际显示尺寸渲染，保证清晰；比例全部是相对的，所以尺寸可以随便换 ---
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.max(640, Math.round(rect.width * dpr));
    var H = Math.max(360, Math.round(rect.height * dpr));
    if (!rect.width) { W = NT.data.HOME_W; H = NT.data.HOME_H; }
    bg.width = W; bg.height = H;
    fg.width = W; fg.height = H;

    // 浮层字号跟着舞台缩放。
    // 窄屏（手机）要把下限抬到 16px：手机舞台只有 600 上下宽，按宽/62 算出来是 10px，
    // 而徽章、气泡这些浮层都是 .72em / .76em —— 实际只有 7px 左右，根本看不清。
    var cssW = rect.width || NT.data.HOME_W;
    var baseMin = root.innerWidth <= 899 ? 16 : 9;
    stage.style.fontSize = U.clamp(cssW / 62, baseMin, 20).toFixed(2) + 'px';

    // 全屏/横屏按钮上的字要跟着当前状态走（全屏 -> 横屏 -> 退出 循环）
    if (app.syncFsBtn) app.syncFsBtn();

    var s = app.save;
    var now = Date.now();

    // 哥伦比娅的内容高度。0.22 是照着家里家具的比例定的（约为门高的一半、比桌高一头）
    var chH = H * 0.25;

    // --- 背景层（含田与玩具） ---
    var fields = {};
    [{ id: 'dry1', key: 'dry' }, { id: 'wet1', key: 'wet' }].forEach(function (f) {
      var fst = NT.farm.status(s, f.id, now);
      fields[f.key] = {
        cropId: fst.crop ? fst.crop.id : null,
        progress: fst.progress,
        ripeColor: fst.crop && fst.crop.field === 'wet' ? '#d8e0a0' : '#e2b25c'
      };
    });

    // --- 背景层（家的底图 + 玩具） ---
    // 抽成函数是因为：图片是异步加载的，加载完必须重画一次，
    // 否则第一次进游戏看到的永远是代码画的占位图。
    var bctx = bg.getContext('2d');
    var bgEpoch = -1;
    function drawStageBg() {
      bgEpoch = NT.assets ? NT.assets.epoch() : 0;
      var homeImg = NT.assets && NT.assets.home(app._homeBackgroundIndex);
      if (!(homeImg && NT.assets.drawCover(bctx, homeImg, W, H))) {
        var assetState = NT.assets && NT.assets.status ? NT.assets.status() : null;
        var assetPending = !!(NT.assets && NT.assets.anyDeclared && NT.assets.anyDeclared() && assetState &&
          assetState.ready + assetState.error < assetState.total);
        if (assetPending) {
          var pendingGrad = bctx.createLinearGradient(0, 0, 0, H);
          pendingGrad.addColorStop(0, '#1b201d');
          pendingGrad.addColorStop(1, '#0f1412');
          bctx.fillStyle = pendingGrad;
          bctx.fillRect(0, 0, W, H);
        } else {
          NT.placeholder.homeWorld(bctx, W, H,
            { seed: NT.rng.hashSeed('home:' + s.homeId), fields: fields });
        }
      }
      // 玩具统一在独立后院显示；家园背景不再重复绘制玩具。
    }
    drawStageBg();

    // --- 前景层（哥伦比娅），每帧重画 ---
    // 玩耍状态的角色在后院才会靠近玩具；家园里保持在房屋前，避免出现“玩具不在身边”。
    var target = NT.home.state(s).useToy ? (NT.data.spotById('yard') || NT.data.homeSpots.yard) : NT.home.spot(s);
    if (!app._anim) {
      app._anim = { x: target.x, y: target.y, facing: 1, phase: 0, last: now };
    }
    var anim = app._anim;

    var fctx = fg.getContext('2d');
    var st = NT.home.state(s);
    var sprite = { hair: '#d9d6e8', dress: '#565070', accent: '#b8c8f4', skin: '#f3d8cf', hat: 'none' };

    /** 被戳之后的短动画：返回 {rot,sx,sy,dx,dy,flip} */
    function reaction(now2) {
      var r = app._react;
      if (!r.kind || now2 > r.until) return null;
      var p = U.clamp((now2 - r.at) / 1500, 0, 1);
      var e = Math.sin(p * Math.PI);                    // 0→1→0
      var out = { rot: 0, sx: 1, sy: 1, dx: 0, dy: 0, flip: null };
      switch (r.kind) {
        case 'roll':   out.rot = -Math.PI * 2 * (p < 0.5 ? p * 2 * 0.5 : (1 - p) * 2 * 0.5 + 0.5); break;
        case 'bounce': out.dy = -H * 0.035 * Math.abs(Math.sin(p * Math.PI * 3));
                       out.sy = 1 + 0.10 * Math.abs(Math.sin(p * Math.PI * 3));
                       out.sx = 1 - 0.06 * Math.abs(Math.sin(p * Math.PI * 3)); break;
        case 'perk':   out.sy = 1 + 0.06 * e; out.sx = 1 + 0.04 * e; out.dy = -H * 0.008 * e; break;
        case 'lookup': out.dy = -H * 0.008 * e; break;
        case 'wave':   out.rot = Math.sin(p * Math.PI * 5) * 0.09 * e; break;
        case 'stir':   out.dx = W * 0.008 * Math.sin(p * Math.PI * 5); break;
        case 'shy':    out.sx = 1 + 0.07 * e; out.sy = 1 - 0.07 * e; break;
        case 'turn':   out.flip = p > 0.45; out.rot = Math.sin(p * Math.PI) * 0.05; break;
        case 'offer':  out.dx = W * 0.010 * e; out.sy = 1 - 0.03 * e; break;
      }
      return out;
    }

    /** 走路时脚下的小尘土（左右脚各一下） */
    var dust = [];
    function spawnDust(x, y, dir) {
      dust.push({ x: x, y: y, life: 0, max: 0.5, dir: dir });
    }

    function drawNahida(t) {
      // dt 必须夹在 [0, 0.1]：标签页切回来时 rAF 时间戳会跳，负数 dt 会让动画倒退
      var dt = U.clamp((t - anim.last) / 1000, 0, 0.1);
      anim.last = t;

      // 素材是异步加载的：只要有新图加载完就重画一次背景层。
      // 这样"图片加载好了但画面还是占位图"在结构上不可能发生 ——
      // 不依赖 app.render() 被谁调用、也不受 screen / activeTrip 状态影响。
      if (NT.assets && NT.assets.epoch() !== bgEpoch) drawStageBg();

      // 她出门了 —— 家里没人，但**客人还是可能来**，所以循环不能停：
      // 清掉她的图层，只画客人。
      if (s.activeTrip) {
        fctx.clearRect(0, 0, W, H);
        var bubAway = $('nahida-bubble');
        if (bubAway) bubAway.classList.remove('show');
        drawVisitor(t, dt);
        app._raf = requestAnimationFrame(drawNahida);
        return;
      }

      // 睡觉只在独立卧室场景显示。家园保留状态与倒计时，但不再把睡姿画在家园背景上。
      if (st.id === 'sleep') {
        fctx.clearRect(0, 0, W, H);
        var bubSleep = $('nahida-bubble');
        if (bubSleep) bubSleep.classList.remove('show');
        drawVisitor(t, dt);
        app._raf = requestAnimationFrame(drawNahida);
        return;
      }

      var dx = target.x - anim.x, dy = target.y - anim.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var walking = dist > 0.004;
      if (walking) {
        var speed = 0.11;                        // 每秒走场景宽度的比例
        var step = Math.min(dist, speed * dt);
        anim.x += dx / dist * step;
        anim.y += dy / dist * step;
        if (Math.abs(dx) > 0.001) anim.facing = dx > 0 ? 1 : -1;
        var prevPhase = anim.phase;
        anim.phase += dt * 8.5;
        // 每半个周期（= 一步）扬一次土
        if (Math.floor(anim.phase / Math.PI) !== Math.floor(prevPhase / Math.PI)) {
          spawnDust(W * anim.x, H * anim.y, anim.facing);
        }
      } else {
        anim.x = target.x; anim.y = target.y;
        anim.phase += dt * 1.6;
        dust.length = 0;
      }

      fctx.clearRect(0, 0, W, H);

      var cx = W * anim.x;
      var mood = walking ? 'idle' : st.mood;
      var faceLeft = anim.facing < 0;

      // --- 走路：上下起伏 + 左右轻微摇摆 + 前倾 ---
      var bob = 0, sway = 0, lean = 0, squashX = 1, squashY = 1;
      if (walking) {
        bob = Math.abs(Math.sin(anim.phase)) * chH * 0.045;      // 每步一次起伏
        sway = Math.sin(anim.phase) * chH * 0.012;               // 身体左右晃
        lean = anim.facing * 0.045;                              // 前倾一点点
        squashX = 1 - Math.abs(Math.sin(anim.phase)) * 0.03;
        squashY = 1 + Math.abs(Math.sin(anim.phase)) * 0.03;
      } else {
        bob = Math.sin(anim.phase) * chH * 0.012;                // 站着时的呼吸感
      }
      var feetY = H * anim.y - bob;

      var rx = reaction(t);

      // --- 气泡跟着她走 ---
      var bub = $('nahida-bubble');
      if (bub) {
        var bb = app._bubble;
        if (bb && t < bb.until) {
          if (bub.getAttribute('data-txt') !== bb.text) {
            bub.textContent = bb.text;
            bub.setAttribute('data-txt', bb.text);
          }
          var pxp = cx / W;
          var bside = pxp > 0.56 ? -1 : 1;
          bub.style.left = (pxp * 100).toFixed(3) + '%';
          bub.style.top = (((feetY - chH * 0.98) / H) * 100).toFixed(3) + '%';
          bub.style.transform = bside < 0 ? 'translate(-104%,-100%)' : 'translate(4%,-100%)';
          bub.classList.toggle('left', bside < 0);
          if (!bub.classList.contains('show')) bub.classList.add('show');
        } else if (bub.classList.contains('show')) {
          bub.classList.remove('show');
        }
      }

      // 影子
      fctx.save();
      fctx.globalAlpha = 0.22;
      fctx.fillStyle = '#000';
      fctx.beginPath();
      fctx.ellipse(cx + W * 0.004, H * anim.y + H * 0.004, chH * 0.26, chH * 0.07, 0, 0, Math.PI * 2);
      fctx.fill();
      fctx.restore();

      // 尘土
      if (dust.length) {
        fctx.save();
        for (var di = dust.length - 1; di >= 0; di--) {
          var d = dust[di];
          d.life += dt;
          if (d.life >= d.max) { dust.splice(di, 1); continue; }
          var dp = d.life / d.max;
          fctx.globalAlpha = 0.30 * (1 - dp);
          fctx.fillStyle = '#f0e6d0';
          fctx.beginPath();
          fctx.ellipse(d.x - d.dir * dp * W * 0.020, d.y - dp * H * 0.006,
            W * 0.006 * (1 + dp * 1.6), H * 0.004 * (1 + dp * 1.6), 0, 0, Math.PI * 2);
          fctx.fill();
        }
        fctx.restore();
      }

      fctx.save();
      // 走路：左右摇摆 + 前倾 + 轻微挤压
      if (sway || lean) {
        fctx.translate(cx, feetY);
        if (lean) fctx.rotate(lean);
        fctx.translate(-cx, -feetY);
      }
      if (squashX !== 1 || squashY !== 1) {
        fctx.translate(cx, feetY);
        fctx.scale(squashX, squashY);
        fctx.translate(-cx, -feetY);
      }
      if (rx) {
        fctx.translate(cx + rx.dx, feetY + rx.dy);
        if (rx.rot) fctx.rotate(rx.rot);
        fctx.scale(rx.sx, rx.sy);
        fctx.translate(-cx, -feetY);
        if (rx.flip !== null) faceLeft = rx.flip;
      }
      // 躺着只在"已经走到床上"之后才生效。
      // 走路途中保持站着，否则她会横着飘过去 —— 这是之前的 bug。
      var lying = st.lie && !walking;
      if (lying) {
        fctx.translate(cx, feetY);
        fctx.rotate(-Math.PI / 2 * 0.86);
        fctx.translate(-cx, -feetY);
      }
      var nOk = NT.assets && NT.assets.drawNahida(fctx, cx, feetY, chH, faceLeft,
        lying ? 'tired' : mood);
      if (!nOk) {
        NT.placeholder.chibi(fctx, cx, feetY, chH, sprite, st.lie ? 'tired' : mood, faceLeft);
      }

      // 玩耍时手里的那个玩具。如果她已经站到那件玩具旁边了就不再画（会重复）
      if (st.useToy && !NT.home.atToy(s)) {
        var toy = NT.home.playingToy(s);
        if (toy) {
          var th2 = chH * NT.data.toySize(toy.id) * 0.45;
          if (!(NT.assets && NT.assets.drawToy(fctx, cx + chH * 0.42, feetY, th2, toy.id))) {
            NT.placeholder.toy(fctx, toy.id, cx + chH * 0.42, feetY, th2,
              NT.rng.mulberry32(77));
          }
        }
      }
      fctx.restore();

      // 来访的同伴（画在同一层，但走了自己的一套位置和动画）
      drawVisitor(t, dt);

      app._raf = requestAnimationFrame(drawNahida);
    }

    /**
     * 画来访的同伴。
     * 位置由 home.visitorSpot 给出 —— 那边已经保证了 TA 和主角分在画面两侧。
     */
    function drawVisitor(t, dt) {
      var v = NT.home.visitor(s);
      var vb = $('visitor-bubble');
      if (!v) {
        app._vanim = null;
        if (vb && vb.classList.contains('show')) vb.classList.remove('show');
        return;
      }
      var comp = NT.home.visitorCompanion(s);
      var vst = NT.home.visitorState(s);
      var target = NT.home.visitorSpot(s);
      if (!comp || !vst || !target) return;

      if (!app._vanim) {
        app._vanim = { x: target.x, y: target.y, facing: -1, phase: 0, last: t };
      }
      var va = app._vanim;
      va.last = t;

      var vdx = target.x - va.x, vdy = target.y - va.y;
      var vdist = Math.sqrt(vdx * vdx + vdy * vdy);
      var vwalking = vdist > 0.004;
      if (vwalking) {
        var vstep = Math.min(vdist, 0.11 * (dt || 0.016));
        va.x += vdx / vdist * vstep;
        va.y += vdy / vdist * vstep;
        if (Math.abs(vdx) > 0.001) va.facing = vdx > 0 ? 1 : -1;
        va.phase += (dt || 0.016) * 8.5;
      } else {
        va.x = target.x; va.y = target.y;
        va.phase += (dt || 0.016) * 1.6;
      }

      var vcx = W * va.x;
      var vchH = chH * 0.94;                       // 客人比主人略矮一点点
      var vH = vchH * (0.84 + ((NT.rng.hashSeed(comp.id) % 100) / 100) * 0.22);
      var vbob = vwalking ? Math.abs(Math.sin(va.phase)) * vH * 0.045
                          : Math.sin(va.phase) * vH * 0.012;
      var vfeetY = H * va.y - vbob;
      var vflip = va.facing < 0;

      // 影子
      fctx.save();
      fctx.globalAlpha = 0.20;
      fctx.fillStyle = '#000';
      fctx.beginPath();
      fctx.ellipse(vcx, H * va.y + H * 0.004, vH * 0.24, vH * 0.065, 0, 0, Math.PI * 2);
      fctx.fill();
      fctx.restore();

      // 本体：有真立绘就用真立绘，否则程序化。
      // 注意：访客的活动池里**没有"睡觉"** —— 访客只有一张睁眼立绘、身高还各不相同，
      // 躺下必然违和。所以这里不处理躺姿，也不需要。
      fctx.save();
      if (vwalking) {
        fctx.translate(vcx, vfeetY);
        fctx.rotate(va.facing * 0.04);
        fctx.translate(-vcx, -vfeetY);
      }
      var vOk = NT.assets && NT.assets.drawCompanion(fctx, vcx, vfeetY, vH, vflip, comp.id);
      if (!vOk) {
        NT.placeholder.chibi(fctx, vcx, vfeetY, vH, comp.sprite, vst.mood, vflip);
      }
      fctx.restore();

      // 气泡跟着 TA 走
      if (vb) {
        var vbb = app._vbubble;
        if (vbb && t < vbb.until) {
          if (vb.getAttribute('data-txt') !== vbb.text) {
            vb.textContent = vbb.text;
            vb.setAttribute('data-txt', vbb.text);
          }
          var vpxp = vcx / W;
          var vside = vpxp > 0.62 ? -1 : 1;
          vb.style.left = (vpxp * 100).toFixed(3) + '%';
          vb.style.top = (((vfeetY - vH * 0.98) / H) * 100).toFixed(3) + '%';
          vb.style.transform = vside < 0 ? 'translate(-104%,-100%)' : 'translate(4%,-100%)';
          vb.classList.toggle('left', vside < 0);
          if (!vb.classList.contains('show')) vb.classList.add('show');
        } else if (vb.classList.contains('show')) {
          vb.classList.remove('show');
        }
      }

      // 两块气泡都挂在各自头顶，两人站得近时会在中间叠成一团。
      // 每帧定位完之后判一次：真叠上了就把客人的气泡往上抬一层（变成上下两层）。
      // 每次都先清掉上次的抬升再重算，免得越抬越高。
      vb.style.marginTop = '';
      var nb = $('nahida-bubble');
      if (nb && nb.classList.contains('show') && vb.classList.contains('show') &&
          vb.getAttribute('data-txt')) {
        var nr = nb.getBoundingClientRect();
        var vr = vb.getBoundingClientRect();
        var ovX = Math.min(nr.right, vr.right) - Math.max(nr.left, vr.left);
        var ovY = Math.min(nr.bottom, vr.bottom) - Math.max(nr.top, vr.top);
        if (ovX > 0 && ovY > 0) {
          // 能抬多少：别把气泡顶出画面
          var box = vb.offsetParent || vb.parentNode;
          var ceil = box ? box.getBoundingClientRect().top + 4 : 4;
          var room = Math.max(0, vr.top - ceil);
          var up = Math.min(ovY + 8, room);
          if (up > 0) vb.style.marginTop = (-up).toFixed(1) + 'px';
        }
      }
    }
    // 她换状态时，用气泡开口说一句 —— 她的台词只从气泡出，底部不再重复一行
    var playingNow = NT.home.playingToy(s);
    var stKey = st.id + ':' + s.home.nahida.since + ':' + (playingNow ? playingNow.id : '');
    if (app._lastStateKey !== stKey) {
      app._lastStateKey = stKey;
      var amb = playingNow ? NT.home.toyLine(s, playingNow) : NT.home.stateLine(s);
      // 状态变了就换台词；但如果是"戳她"的反应气泡还没消失，就别打断它
      if (!app._bubble || app._bubble.kind !== 'poke' || now > app._bubble.until) {
        app.setBubble(amb, 7000, 'ambient');
      }
    }

    // ---- 来访同伴：来了 / 换活动 / 走了 ----
    var vNow = NT.home.visitor(s);
    var vKey = vNow ? (vNow.companionId + ':' + vNow.stateId + ':' + vNow.since) : '';
    if (app._lastVisitorKey !== vKey) {
      app._lastVisitorKey = vKey;
      if (vNow) {
        var vTag = vNow.companionId + ':' + vNow.arrivedAt;
        if (app._vSeen !== vTag) {
          app._vSeen = vTag;                     // 刚到，说一句"打扰了"
          app.setVBubble(NT.home.visitorArriveLine(s), 7000, 'ambient');
        } else {
          app.setVBubble(NT.home.visitorLine(s), 7000, 'ambient');
        }
      }
    }
    // 走的时候用 toast 提示，因为气泡是挂在人身上的，人走了气泡也没了
    if (app._vWasHere && !vNow) {
      var lastComp = NT.data.companionById((s.home.lastVisitor || {}).companionId) ||
        { name: '客人' };
      app.toast(lastComp.name + '走了：' + NT.home.visitorLeaveLine(s));
    }
    app._vWasHere = !!vNow;
    if (vNow) s.home.lastVisitor = { companionId: vNow.companionId };

    // ---- 打招呼：主角在发呆、家里有客人，就聊一句（一次来访只触发一次）----
    var greet = NT.home.visitorGreeting(s);
    if (greet) {
      app.setBubble(greet.nahida, 7000, 'ambient');
      var gLine = greet.visitor;
      setTimeout(function () { app.setVBubble(gLine, 7000, 'ambient'); }, 1900);
      NT.store.save(s);
    }

    // 动画循环一直跑（她出门时也要画来访的客人）
    app._raf = requestAnimationFrame(drawNahida);

    // 家里只响应人物；种地必须进入独立田地界面。
    stage.onclick = function (ev) {
      var r = stage.getBoundingClientRect();
      var nx = (ev.clientX - r.left) / r.width;
      var ny = (ev.clientY - r.top) / r.height;

      var dxn = nx - anim.x, dyn = ny - anim.y;
      if (Math.sqrt(dxn * dxn + dyn * dyn) < 0.10) app.poke();
    };
  };

  /* ---------------- 厨房 ---------------- */

  app.viewKitchen = function () {
    var s = app.save, inv = s.inventory.ingredients;
    var list = NT.data.dishes.filter(function (d) { return d.id !== 'none'; });
    var cards = list.map(function (d) {
      var can = NT.data.canCook(d, inv);
      var need = Object.keys(d.need).map(function (k) {
        var have = inv[k] || 0, want = d.need[k];
        return '<span class="' + (have >= want ? 'ok' : 'lack') + '">' +
          NT.data.ingredientName(k) + ' ' + have + '/' + want + '</span>';
      }).join(' ');
      var have = s.inventory.dishes[d.id] || 0;
      var dishImg = NT.assets && NT.assets.dish(d.id);
      var dishArt = dishImg ? '<img class="dish-thumb" src="' + esc(dishImg.src) + '" alt="">' : '';
      return '<div class="dish' + (can ? ' can' : '') + '">' +
        dishArt + '<div class="dish-head"><b>' + d.name + '</b>' +
        (have ? '<span class="own">已有 ' + have + '</span>' : '') + '</div>' +
        '<div class="dish-desc">' + esc(d.desc) + '</div>' +
        '<div class="dish-need">' + need + '</div>' +
        '<div class="dish-eff">提供 ' + d.foodKm + ' 旅途点　·　' + effectText(d.effect) + '</div>' +
        '<button class="btn-ghost" data-act="cook" data-arg="' + d.id + '"' + (can ? '' : ' disabled') + '>' +
        (can ? '做一份' : '食材不够') + '</button></div>';
    }).join('');
    return app.header('厨房', 'home') + '<div class="pad"><div class="dishes">' + cards + '</div></div>';
  };

  function effectText(e) {
    var out = [];
    if (e.scoreBonus) out.push('稀有度 +' + e.scoreBonus);
    if (e.meetBonus) out.push('遇到同伴 +' + Math.round(e.meetBonus * 100) + '%');
    if (e.luck) out.push('好运');
    if (e.weatherBias) out.push('偏好' + e.weatherBias.map(function (w) {
      var x = NT.data.weatherById(w); return x ? x.name : w;
    }).join('/'));
    return out.length ? out.join(' · ') : '没有额外效果';
  }

  /* ---------------- 玩具 ---------------- */

  app.viewToys = function () {
    var s = app.save;
    var owned = s.toys || [];
    var slots = NT.data.toySlots || [];
    var placedCount = (s.home.placed || []).length;
    // 按 place 分别统计空位（现在内置玩具全是室外的，但规则保留着）
    var places = ['indoor', 'outdoor'];
    var free = {};
    places.forEach(function (pl) {
      var total = slots.filter(function (x) { return x.place === pl; }).length;
      var used = (s.home.placed || []).filter(function (p) {
        return NT.data.toySlots[p.slot] && NT.data.toySlots[p.slot].place === pl;
      }).length;
      free[pl] = total - used;
    });
    var isFull = placedCount >= slots.length;

    var head = '<div class="cap-bar">' +
      '<span>摆放位置 <b>' + placedCount + ' / ' + slots.length + '</b>　都在后院里</span>' +
      (isFull ? '<span class="cap-full">满了，要摆新的得先收回一件</span>' : '') +
      '</div>';

    if (!owned.length) {
      return app.header('玩具箱', 'home') + head +
        '<div class="pad empty">还没有玩具。<br>她旅行回来的时候，偶尔会带一个。</div>';
    }

    var cards = owned.map(function (id) {
      var t = NT.data.toyById(id);
      if (!t) return '';
      var placed = NT.home.isPlaced(s, id);
      var left = free[t.place] || 0;
      var blocked = !placed && left <= 0;
      var act;
      if (placed) {
        act = '<button class="btn-ghost" data-act="take-toy" data-arg="' + id + '">收回</button>';
      } else if (blocked) {
        act = '<button class="btn-ghost" disabled>没空位了</button>';
      } else {
        act = '<button class="btn-ghost" data-act="place-toy" data-arg="' + id + '">摆出来</button>';
      }
      return '<div class="toy' + (blocked ? ' toy-blocked' : '') + '">' +
        '<div class="toy-canvas" data-toy="' + id + '"></div>' +
        '<div class="toy-body"><b>' + t.name + '</b>' +
        '<span class="toy-desc">' + esc(t.desc) + '</span>' +
        '<span class="toy-line">「' + esc(t.playLines[0]) + '」</span>' +
        (placed ? '<span class="toy-on">已摆出来</span>'
                : '<span class="muted small">' +
                  (blocked ? '没空位了' : '还有 ' + left + ' 个位置') + '</span>') +
        '</div>' +
        '<div class="toy-act">' + act + '</div></div>';
    }).join('');

    return app.header('玩具箱', 'home') + head +
      '<div class="pad"><div class="hint" style="margin:0 0 12px">' +
      '玩具都摆在右边的院子里。摆好的玩具会出现在家里，她玩耍时会走过去玩。' +
      '位置有限，<b>最多同时摆 ' + slots.length + ' 件</b>。' +
      '</div>' + cards + '</div>';
  };

  app.mountToys = function (retried) {
    var slots = document.querySelectorAll('[data-toy]');
    var anyMissing = false;
    for (var i = 0; i < slots.length; i++) {
      var id = slots[i].getAttribute('data-toy');
      var c = document.createElement('canvas');
      c.width = 160; c.height = 140;
      var tctx = c.getContext('2d');
      // 有真素材就用真的 —— 和摆在家里看到的同一张图。
      // 以前这里无条件调 placeholder.toy，所以玩具箱里全是代码画的图标。
      if (!(NT.assets && NT.assets.drawToy(tctx, 80, 118, 96, id))) {
        NT.placeholder.toy(tctx, id, 80, 118, 96, NT.rng.mulberry32(i + 3));
        anyMissing = true;
      }
      c.style.width = '100%'; c.style.height = 'auto';
      slots[i].innerHTML = '';      // 重画时先清掉旧的，免得叠加
      slots[i].appendChild(c);
    }
    if (anyMissing && !retried && NT.assets && NT.assets.onSettled) {
      NT.assets.onSettled(function () { app.mountToys(true); });
    }
  };

  /* ---------------- 交流 ---------------- */

  /**
   * 聊天面板顶上那张插图：**家里的真实画面**（背景 + 摆出来的玩具 + 她本人）。
   *
   * 以前这里是无条件调 NT.placeholder.homeWorld / chibi 的 ——
   * 所以不管素材装没装，看到的永远是代码画的占位图。
   * 现在和主舞台一个规矩：有真素材就用真的，缺哪张才用占位图补哪张。
   *
   * 素材是异步加载的，第一次画很可能还没加载完，所以没画到真图时
   * 等 onSettled 再补画一次（retried 防止加载失败时无限递归）。
   */
  function drawChatArt(el, s, st, retried) {
    var W = 1280, H = 720, chH = H * 0.25;   // 和主舞台同一个比例
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var A = NT.assets;

    var fields = {};
    [{ id: 'dry1', key: 'dry' }, { id: 'wet1', key: 'wet' }].forEach(function (f) {
      var sst = NT.farm.status(s, f.id, Date.now());
      fields[f.key] = { cropId: sst.crop ? sst.crop.id : null, progress: sst.progress, ripeColor: '#e2b25c' };
    });

    var homeImg = A && A.home();
    var bgOk = !!(homeImg && A.drawCover(ctx, homeImg, W, H));
    if (!bgOk) NT.placeholder.homeWorld(ctx, W, H, { seed: 4242, fields: fields });

    // 摆出来的玩具，和家里看到的一致
    (s.home.placed || []).forEach(function (p, i) {
      var slot = NT.data.toySlots[p.slot];
      if (!slot) return;
      var th = chH * NT.data.toySize(p.toyId);
      if (!(A && A.drawToy(ctx, W * slot.x, H * slot.y, th, p.toyId))) {
        NT.placeholder.toy(ctx, p.toyId, W * slot.x, H * slot.y, th, NT.rng.mulberry32(i + 11));
      }
    });

    // 她本人：画在她此刻站的地方
    var spot = NT.home.spot(s);
    var sprite = { hair: '#d9d6e8', dress: '#565070', accent: '#b8c8f4', skin: '#f3d8cf', hat: 'none' };
    var mood = st.lie ? 'tired' : st.mood;
    if (!(A && A.drawNahida(ctx, W * spot.x, H * spot.y, chH, false, mood))) {
      NT.placeholder.chibi(ctx, W * spot.x, H * spot.y, chH, sprite, mood, false);
    }

    c.style.width = '100%'; c.style.height = 'auto'; c.style.borderRadius = '12px';
    el.innerHTML = ''; el.appendChild(c);

    if (!bgOk && !retried && A && A.onSettled) {
      A.onSettled(function () { drawChatArt(el, s, st, true); });
    }
  }

  app.viewChat = function () {
    var s = app.save;
    var aiOn = false;
    if (!app.chatTopic) {
      var topics = NT.data.chatTopics.map(function (t) {
        return '<button class="topic" data-act="topic" data-arg="' + t.id + '">' + t.label + '</button>';
      }).join('');
      return app.header('和哥伦比娅说说话', 'home') +
        '<div class="pad">' +
        '<div class="chat-stage" id="chat-stage"></div>' +
        '<div class="say-bubble">' + esc(NT.home.hello(s, s.home.nahida.since)) + '</div>' +
        '<div class="label">聊点什么</div><div class="topics">' + topics + '</div>' +
        '<div class="hint">' + (aiOn
          ? '已接入可选对话服务。'
          : '当前使用离线预设对话，无需联网即可交流。') +
        '</div></div>';
    }
    var aiOn2 = false;
    var topic = NT.home.topicById(app.chatTopic);
    var log = app.chatLog.map(function (m) {
      return '<div class="msg ' + (m.me ? 'me' : 'her') + '">' + esc(m.text) +
        (!m.me && m.source === 'ai' ? '<span class="ai-tag">AI</span>' : '') + '</div>';
    }).join('');
    var pending = app.chatPending ? '<div class="msg her pending">……</div>' : '';
    var opts = topic.options.map(function (o, i) {
      return '<button class="say-opt" data-act="say" data-arg="' + i + '">' + esc(o.text) + '</button>';
    }).join('');
    return app.header(topic.label, 'home') +
      '<div class="pad">' +
      '<div class="chat-log" id="chat-log">' + log + pending + '</div>' +
      '<div class="label">你要说</div><div class="say-opts">' + opts + '</div>' +
      (aiOn2
        ? '<div class="free-row"><input class="input" id="chat-input" maxlength="60" ' +
          'placeholder="或者自己打一句，回车发送"><button class="sbtn go" data-act="send-free">说</button></div>'
        : '') +
      '<button class="btn-ghost" style="margin-top:14px" data-act="chat-back">换个话题</button></div>';
  };

  app.mountChat = function () {
    var el = $('chat-stage');
    var s = app.save, st = NT.home.state(s);
    if (el) drawChatArt(el, s, st, false);
    var log = $('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
    var inp = $('chat-input');
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); app.action('send-free'); }
      });
      if (app.chatLog.length) inp.focus();
    }
  };

  /* ---------------- 出门 ---------------- */

  app.viewOutdoor = function () {
    var s = app.save;
    var homeName = NT.data.homeName(s.homeId);
    var modes = NT.data.travelModes.map(function (m) {
      return '<button class="chip' + (app.outMode === m.id ? ' on' : '') +
        '" data-act="out-mode" data-arg="' + m.id + '">' + m.name + '<small>' + m.desc + '</small></button>';
    }).join('');

    var detail = '';
    if (app.outMode === 'region') {
      detail = '<div class="label">去哪个地区</div><div class="chips regions">' +
        NT.data.destinations.filter(function (d) { return d.id !== s.homeId; }).map(function (d) {
          var cost = NT.data.travelCost(s.homeId, d.id);
          var tier = NT.data.distanceTier(cost);
          return '<button class="chip' + (app.outRegion === d.id ? ' on' : '') +
            '" data-act="out-region" data-arg="' + d.id + '">' + d.name +
            '<small>' + tier.name + ' · ' + cost + ' 旅途点</small></button>';
        }).join('') + '</div>';
    } else if (app.outMode === 'bearing') {
      detail = '<div class="label">往哪边走</div><div class="chips">' +
        C.directions.map(function (d) {
          return '<button class="chip' + (app.outBearing === d.id ? ' on' : '') +
            '" data-act="out-bearing" data-arg="' + d.id + '">' + d.name +
            '<small>' + d.desc + '</small></button>';
        }).join('') + '</div>' +
        '<div class="hint" style="margin-top:10px">方向只决定她一开始往哪走。路上可能被同伴邀请、看到宣传画而改道。</div>';
    } else {
      detail = '<div class="hint" style="margin-top:16px">不指定方向和地方，走到哪算哪。</div>';
    }

    var dishIds = ['none'].concat(Object.keys(s.inventory.dishes));
    var dishes = dishIds.map(function (id) {
      var d = NT.data.dishById(id);
      var have = id === 'none' ? '∞' : ('×' + s.inventory.dishes[id]);
      return '<button class="chip' + (app.outDish === id ? ' on' : '') +
        '" data-act="out-dish" data-arg="' + id + '">' + d.name +
        '<small>' + have + ' · 提供 ' + d.foodKm + ' 旅途点</small></button>';
    }).join('');

    var rareIds = Object.keys(s.inventory.rare);
    var rares = rareIds.length
      ? rareIds.map(function (id) {
        var r = NT.data.rareDropById(id);
        return '<button class="chip' + (app.outRares.indexOf(id) >= 0 ? ' on' : '') +
          '" data-act="out-rare" data-arg="' + id + '">' + r.name +
          '<small>×' + s.inventory.rare[id] + ' · +' + r.foodKm + ' 旅途点</small></button>';
      }).join('')
      : '<span class="muted">还没有稀有道具。它们是<b>收获作物时随机掉落</b>的，' +
        '先进入田地种点东西。「仓库」里能看到详细的掉落和效果。</span>';

    var totalKm = NT.data.dishById(app.outDish).foodKm;
    app.outRares.forEach(function (id) { totalKm += NT.data.rareDropById(id).foodKm; });

    return app.header('出门', 'home') + '<div class="pad">' +
      '<div class="hint" style="margin:0 0 14px">家乡：<b>' + esc(homeName) + '</b>　' +
      '这次拥有 <b>' + totalKm + '</b> 旅途点（' + NT.data.distanceTier(totalKm).name + '）</div>' +
      '<div class="label">怎么走</div><div class="chips">' + modes + '</div>' + detail +
      '<div class="label">带什么吃的</div><div class="chips">' + dishes + '</div>' +
      '<div class="label">带上道具（最多两件）</div><div class="chips">' + rares + '</div>' +
      '<button class="btn btn-primary" style="margin-top:20px" data-act="depart">出发</button>' +
      '<div class="hint">食物决定她能走多远。不够就会半路折返；路上也可能遇到补给或意外。' +
      '最长 48 小时一定回家。</div></div>';
  };

  /* ---------------- 等待 ---------------- */

  /**
   * 画面顶部那条常驻状态条。
   *   · 她在家   -> "点她一下试试"
   *   · 她出门了 -> 回家倒计时，点一下能重新打开旅途面板
   */
  app.countdownHTML = function () {
    var t = app.save && app.save.activeTrip;
    if (!t) return '点她一下试试';
    var remain = NT.clock.remaining(t, Date.now());
    return '<span class="cd-dot"></span>她还有 <b>' + U.humanMs(remain) + '</b> 回来' +
      '<span class="cd-eta">约 ' + U.clockTime(t.dueAt) + '</span>' +
      '<span class="cd-more">查看旅途 ›</span>';
  };

  app.viewWaiting = function () {
    var t = app.save.activeTrip;
    if (!t) { app.screen = 'home'; app.modal = null; return app.viewHome(); }
    var now = Date.now();
    var remain = NT.clock.remaining(t, now);
    var res = NT.trip.resolve(t);
    var revealed = NT.journey.revealedSteps(t, now);

    var log = revealed.length
      ? revealed.map(function (s) {
        return '<div class="step' + (s.kind ? ' k-' + s.kind : '') + '">' +
          '<span class="step-name">' + esc(s.name) + '</span>' +
          '<span class="step-text">' + esc(s.text) + '</span></div>';
      }).join('')
      : '<div class="muted small">还没有消息。</div>';

    // 明确给出"还要多久 / 大概几点回来" —— 这样关掉网页去干别的也心里有数
    var eta = U.clockTime(t.dueAt);
    var sameDay = new Date(t.dueAt).toDateString() === new Date(now).toDateString();

    return app.header('旅途中') + '<div class="pad waiting">' +
      '<div class="wait-art" id="wait-art"></div>' +
      '<div class="wait-eta">' +
      '<div class="wait-eta-main">还要 <b>' + U.humanMs(remain) + '</b></div>' +
      '<div class="wait-eta-sub">' + (sameDay ? '大约今天 ' : '大约明天 ') + esc(eta) +
      ' 回来　·　关掉网页也算数，到点回来看就好</div>' +
      '</div>' +
      '<div class="wait-status">' + U.vagueWait(remain, t.durationMs) + '</div>' +
      '<div class="wait-detail">带的 ' + esc(t.dishName) + ' · ' + t.journey.budgetKm + ' 旅途点　' +
      '目标 ' + esc(res.target ? res.target.name : '') + '（' + t.journey.costKm + ' 旅途点）</div>' +
      '<div class="label" style="text-align:left">路上（已经发生的）</div>' +
      '<div class="steps">' + log + '</div>' +
      '<div class="btn-row">' +
      '<button class="btn-ghost" data-act="close-modal">回家里等</button>' +
      '<button class="btn-ghost" data-act="modal" data-arg="album">明信片册</button>' +
      '</div></div>';
  };

  app.mountWaiting = function (retried) {
    var el = $('wait-art'); if (!el) return;
    var t = app.save.activeTrip; if (!t) return;
    var res = NT.trip.resolve(t);
    var c = document.createElement('canvas');
    c.width = 480; c.height = 270;
    var ctx = c.getContext('2d');
    // 这个地区有真背景图就用真的 —— 以前无条件画占位图，所以旅途中看到的是假风景
    var A = NT.assets;
    var bgImg = A && A.bg(res.destination ? res.destination.id : null);
    var ok = !!(bgImg && A.drawCover(ctx, bgImg, 480, 270));
    if (!ok) {
      NT.placeholder.background(ctx, 480, 270, res.destination, res.timeOfDay, res.weather, t.seed ^ 0x1234);
    }
    NT.effects.tint(c, res.timeOfDay ? res.timeOfDay.tint : null);
    c.style.width = '100%'; c.style.height = 'auto'; c.style.borderRadius = '12px';
    el.innerHTML = ''; el.appendChild(c);
    if (!ok && !retried && A && A.onSettled) {
      A.onSettled(function () { app.mountWaiting(true); });
    }
  };

  /* ---------------- 结果 ---------------- */

  app.viewResult = function () {
    var t = app.viewing;
    if (!t) { app.screen = 'home'; return app.viewHome(); }
    var res = NT.trip.resolve(t);
    var rar = C.rarity[t.rarity] || C.rarity.N;
    var j = t.journey || {};
    var note = app._pendingNote ? '<div class="note">' + esc(app._pendingNote) + '</div>' : '';
    app._pendingNote = null;

    var outcome = j.soaked ? '落汤鸡'
      : (!j.reached ? '半路折返' : (j.redirected ? '中途改道' : '到达'));

    var steps = (j.steps || []).map(function (s) {
      return '<div class="step k-' + (s.kind || 'none') + '">' +
        '<span class="step-name">' + esc(s.name) + '</span>' +
        '<span class="step-text">' + esc(s.text) + '</span>' +
        (s.delta ? '<span class="step-delta">' + (s.delta > 0 ? '+' : '') + s.delta + ' 旅途点</span>' : '') +
        '</div>';
    }).join('');

    var toyHtml = res.toy
      ? '<div class="toy-gain">带回了一个 <b>' + res.toy.name + '</b>　「' + esc(res.toy.playLines[0]) + '」</div>' : '';
    var rareHtml = (t.rareItemNames && t.rareItemNames.length)
      ? '<div class="used">用掉了：' + t.rareItemNames.join('、') + '</div>' : '';

    return app.header('明信片到了') + note +
      '<div class="pad result">' +
      '<div class="card-wrap"><canvas id="postcard-canvas"></canvas></div>' +
      '<div class="meta">' +
      '<span class="rarity" style="--c:' + rar.color + '">' + rar.label + '</span>' +
      '<span class="outcome o-' + (j.soaked ? 'bad' : j.reached ? 'ok' : 'warn') + '">' + outcome + '</span>' +
      '<span class="dest">' + esc(res.destination ? res.destination.fullName : '') + '</span>' +
      '</div>' +
      '<div class="journey-stat">累计 ' + (j.traveledKm || 0) + ' 旅途点 / 预算 ' + (j.budgetKm || 0) +
      ' 旅途点　·　' + (t.durationMs / 3600e3).toFixed(1) + ' 小时</div>' +
      toyHtml + rareHtml +
      '<div class="diary" id="diary-text">' + esc(t.text.diary) + '</div>' +
      '<div class="src" id="text-src"></div>' +
      '<div class="companion">' + (res.companion
        ? '同行：<b>' + res.companion.name + '</b>　「' + esc(res.companion.catchphrases[0] || '') + '」'
        : '独自一人') + '</div>' +
      '<div class="label" style="text-align:left">旅途日志</div>' +
      '<div class="steps">' + (steps || '<div class="muted small">这次没走远。</div>') + '</div>' +
      '<div class="label" style="text-align:left">明信片内容</div>' +
      '<div class="events">' + (res.events.length ? res.events.map(function (e) {
        return '<div class="event"><span class="ev-cat">' + (e.categoryLabel || '') + '</span>' +
          '<span class="ev-name">' + esc(e.name) + '</span>' +
          '<span class="ev-desc">' + esc(e.desc) + '</span></div>';
      }).join('') : '<div class="muted small">' +
        (j.reached ? '这次没什么特别的。' : '没走到，那边的事下次再说。') + '</div>') + '</div>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary" data-act="close-modal">继续</button>' +
      '<button class="btn-ghost" data-act="modal" data-arg="album">明信片册</button>' +
      '</div></div>';
  };

  app.mountResult = function () {
    var t = app.viewing;
    // 明信片到家的音效（同一张只响一次）
    if (t && app._arriveFor !== t.id) {
      app._arriveFor = t.id;
      NT.sfx.play('arrive');
    }
    var canvas = $('postcard-canvas');
    if (canvas) {
      var dpr = Math.min(root.devicePixelRatio || 1, 3);
      // 明信片尽量画大一点：屏幕越宽给得越大，最多 620 CSS 像素宽
      var stageW = (($('stage') || {}).clientWidth) || window.innerWidth;
      var cap = Math.max(360, Math.min(620, Math.round(stageW * 0.66)));
      var maxW = Math.min(window.innerWidth - 48, cap);
      var cssH = Math.round(C.POSTCARD_H * (maxW / C.POSTCARD_W));

      // 画布分辨率 = 显示尺寸 × 设备像素比 × 超采样系数。
      // 多渲染 20% 再让浏览器缩小，边缘会更干净（相当于抗锯齿超采样）。
      var SS = 1.2;
      var pxW = Math.round(maxW * dpr * SS);
      canvas.style.width = maxW + 'px';
      canvas.style.height = cssH + 'px';
      var rendered = NT.postcard.render(t, { scale: pxW / C.POSTCARD_W });
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      var pctx = canvas.getContext('2d');
      pctx.imageSmoothingEnabled = true;
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(rendered, 0, 0);
    }
    var srcEl = $('text-src');
    if (srcEl) {
      srcEl.textContent = t.text.source === 'deepseek' ? '文案：AI 生成' : '文案：本地模板';
      srcEl.className = 'src ' + (t.text.source === 'deepseek' ? 'src-ai' : '');
    }
    var st = app.save.settings;
    if (false && t.text.source !== 'deepseek') {
      var diaryEl = $('diary-text'); if (!diaryEl) return;
      diaryEl.classList.add('loading');
      NT.text.ai.render(t, st, t.text).then(function (out) {
        t.text = { source: out.source, diary: out.diary, postcardBack: out.postcardBack };
        NT.store.save(app.save);
        if (diaryEl && app.viewing === t) {
          diaryEl.textContent = out.diary;
          diaryEl.classList.remove('loading');
          var s2 = $('text-src');
          if (s2) {
            s2.textContent = out.source === 'deepseek' ? '文案：AI 生成'
              : '文案：本地模板' + (out.error ? '（AI 失败，已回退）' : '');
            s2.className = 'src ' + (out.source === 'deepseek' ? 'src-ai' : '');
          }
          var cv = $('postcard-canvas');
          if (cv) {
            var r2 = NT.postcard.render(t, { scale: Math.max(0.35, cv.width / C.POSTCARD_W) });
            cv.getContext('2d').drawImage(r2, 0, 0);
          }
        }
      });
    }
  };

  /* ---------------- 明信片册 ---------------- */

  app.viewAlbum = function () {
    var list = (app.save.album || []).slice().reverse();
    if (!list.length) {
      return app.header('明信片册', 'home') + '<div class="pad empty">还没有明信片。<br>先送她出门吧。</div>';
    }
    return app.header('明信片册 (' + list.length + ')', 'home') +
      '<div class="pad"><div class="album" id="album-grid">' +
      list.map(function (t) {
        var rar = C.rarity[t.rarity] || C.rarity.N;
        var d = NT.data.destinationById(t.destinationId);
        var j = t.journey || {};
        return '<button class="album-item" data-act="view" data-arg="' + t.id + '">' +
          '<span class="album-thumb"></span>' +
          '<span class="album-rarity" style="--c:' + rar.color + '">' + rar.label + '</span>' +
          '<span class="album-name">' + esc(d ? d.name : '') +
          (j.soaked ? ' · 落水' : (!j.reached ? ' · 折返' : '')) + '</span></button>';
      }).join('') + '</div></div>';
  };

  app.mountAlbum = function () {
    var slots = document.querySelectorAll('.album-thumb');
    if (!slots.length) return;
    var list = (app.save.album || []).slice().reverse();
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    // 缩略图也要按设备像素比渲染，不然高分屏上会糊
    var thumbScale = U.clamp(0.13 * dpr, 0.13, 0.26);
    var i = 0;
    function step() {
      var t0 = Date.now();
      while (i < slots.length && Date.now() - t0 < 14) {
        var el = slots[i], fact = list[i]; i++;
        if (!fact) continue;
        try {
          var c = NT.postcard.render(fact, { scale: thumbScale, forThumbnail: true });
          c.style.width = '100%'; c.style.height = 'auto'; c.style.display = 'block';
          el.innerHTML = ''; el.appendChild(c);
        } catch (e) { }
      }
      if (i < slots.length) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  /* ---------------- 设置 ---------------- */

  app.viewSettings = function () {
    var st = app.save.settings;
    var sizeKb = (NT.store.sizeOf(app.save) / 1024).toFixed(1);
    return app.header('设置', 'home') + '<div class="pad">' +
      '<div class="group"><div class="label">游戏所在地</div>' +
      '<div class="hint"><b>挪德卡莱</b>。这是提瓦特抽象地图的固定出发点，游戏不读取现实定位。</div></div>' +
      '<div class="group"><div class="label">音效</div>' +
      '<div class="hint">音效是用 Web Audio 现场合成的，不需要任何音频素材文件。</div>' +
      '<label class="switch"><input type="checkbox" id="sound-enabled"' +
      (st.sound !== false ? ' checked' : '') + '><span>开启音效</span></label></div>' +
      '<div class="group"><div class="label">来访同伴</div>' +
      '<div class="hint">同伴会自己跑来家里待一会儿。她在家的日子会来，' +
      '她出门旅行的时候也可能来。最多同时 1 位。</div>' +
      '<div class="label" style="margin-top:.7em">每次待多久</div>' +
      '<select class="input" id="visitor-stay">' +
      Object.keys(NT.config.VISIT_STAY).map(function (k) {
        return '<option value="' + k + '"' +
          ((st.visitorStay || 'normal') === k ? ' selected' : '') + '>' +
          esc(NT.config.VISIT_STAY[k].label) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="group"><div class="label">图片素材</div>' +
      '<div class="hint">素材按主角、配角、玩具、料理、作物和地区背景分组，' +
      '地区背景会从候选图库随机选择；替换图片通常不用改代码。' +
      '标准和尺寸见「图片素材」文件夹里的 素材标准.txt。' +
      '没做的会继续用代码画的占位图。</div>' +
      (function () {
        var a = NT.assets.status();
        var names = NT.assets.loadedNames();
        return '<div class="asset-stat">已加载 <b>' + a.ready + ' / ' + a.total + '</b>' +
          (a.ready === 0 ? '　（全部还是占位图）' : '') + '</div>' +
          (names.length ? '<div class="asset-names">已生效：' + esc(names.join('、')) + '</div>' : '');
      })() +
      '</div>' +
      // 素材体检：只在真的对不上时才出现，正常玩家看不到
      (function () {
        if (!NT.assets.syncFromManifest) return '';
        var rep;
        try { rep = NT.assets.syncFromManifest(); } catch (e) { return ''; }
        var lines = [];
        if (rep.addedCompanions && rep.addedCompanions.length) {
          lines.push('配角清单里多出来的（已自动收录，会正常出现）：' +
            rep.addedCompanions.join('、'));
        }
        if (rep.orphanDestinations && rep.orphanDestinations.length) {
          lines.push('有图、但还没在 destinations.js 里定义的地区：' +
            rep.orphanDestinations.map(function (x) { return x.name; }).join('、') +
            '（这些不会出现在旅行目的地里）');
        }
        if (rep.missingImages && rep.missingImages.length) {
          lines.push('还没配图的：' + rep.missingImages.join('、') + '（这些会用代码画的占位图）');
        }
        if (rep.noGeo && rep.noGeo.length) {
          lines.push('缺坐标的：' + rep.noGeo.join('、') +
            '（在 destinations.js 里补充抽象地图坐标后才能计算旅途点）');
        }
        if (!lines.length) return '';
        return '<div class="group"><div class="label">素材体检</div>' +
          lines.map(function (t) {
            return '<div class="hint warn-line">· ' + esc(t) + '</div>';
          }).join('') + '</div>';
      })() +
      '<div class="group"><div class="label">AI 文案（未启用）</div>' +
      '<div class="hint">核心玩法和对话可完全离线运行。正式接入 AI 时必须使用安全后端代理；前端、URL、本地设置和存档都不保存 API Key。</div>' +
      '<button class="btn btn-primary" data-act="save-settings">保存设置</button></div>' +
      '<div class="group"><div class="label">数据</div>' +
      '<div class="hint">明信片 ' + app.save.album.length + ' 张 · 玩具 ' + (app.save.toys || []).length +
      ' 件 · 存档 ' + sizeKb + ' KB' +
      (NT.store.isMemoryOnly() ? '<br>浏览器不允许本地存储，本次进度不会被保存' : '') + '</div>' +
      (NT.store.loadedEmpty && NT.store.loadedEmpty() ? '<div class="hint warn-line">未找到这台设备的旧存档。若曾清理浏览器站点数据，请用备份 JSON 恢复。</div>' : '') +
      '<div class="row"><button class="btn-ghost" data-act="export">导出存档</button>' +
      '<button class="btn-ghost" data-act="import">导入存档</button></div><div class="row" style="margin-top:10px">' +
      '<button class="btn-ghost danger" data-act="reset">清空全部</button></div></div>' +
      '<div class="group about"><div class="label">关于</div>' +
      '<div class="hint">非商业同人作品。角色来自《原神》，版权归米哈游所有。' +
      '本项目仅供学习交流，不作任何商业用途。</div></div></div>';
  };

  /* ---------------- 试玩注入 ---------------- */

  app.demoSeed = function () {
    var s = app.save;
    s.homeChosen = true;
    s.inventory.ingredients = { potato: 4, wheat: 3, soybean: 5, rice: 6, lotus: 2, waterchestnut: 3, corn: 2, tomato: 2, wildrice: 1, watercaltrop: 1 };
    s.inventory.dishes = { riceball: 2, potatocake: 1, lotus_soup: 1, harvest: 1 };
    s.inventory.rare = { clover4: 2, windchime: 1, moonstone: 1, luckycoin: 1 };
    s.toys = ['moon_chess', 'moon_chime', 'moon_pool', 'moon_lantern', 'hammock', 'moon_canvas'];
    // 走正规入口摆放，槽位会自动匹配室内/室外（不要直接写 slot，否则可能摆错地方）
    s.home.placed = [];
    ['moon_chess', 'moon_chime', 'moon_pool', 'moon_lantern', 'hammock', 'moon_canvas'].forEach(function (id) {
      NT.home.placeToy(s, id);
    });
    var now = Date.now();
    NT.farm.plant(s, 'dry1', 'tomato', now - 3600e3);
    NT.farm.plant(s, 'wet1', 'rice', now - 7200e3);
    var seeds = [11, 202, 3003, 40004, 555, 66, 777];
    for (var i = 0; i < seeds.length; i++) {
      var d = NT.clock.depart(s, {
        mode: i % 3 === 0 ? 'region' : 'random',
        regionId: i % 3 === 0 ? NT.data.destinations[(i + 3) % NT.data.destinations.length].id : undefined,
        now: now - (i + 1) * 86400e3, seed: seeds[i],
        dishId: i === 0 ? 'harvest' : (i === 3 ? 'riceball' : 'none'),
        rareItemIds: i === 1 ? ['luckycoin'] : []
      });
      if (d.ok) NT.clock.check(s, d.trip.dueAt + 1000);
    }
    s.home.nahida.stateId = 'play';
    s.home.nahida.until = 0;
    app.save = s;
    NT.store.save(s);
  };

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDur(ms) {
    var h = ms / 3600e3;
    return h >= 1 ? h + ' 小时' : Math.round(ms / 60000) + ' 分';
  }
  app.esc = esc;

})(typeof window !== 'undefined' ? window : this);
