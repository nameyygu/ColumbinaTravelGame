/* 哥伦比娅的旅行 · 种植系统数据
 * 独立田地场景共有六块田：四块玄此玉田 + 两块楚此诸田。
 * 作物按真实时间生长，收获后进食材背包，
 * 并有几率掉落稀有道具（只提升稀有明信片概率，不直接给明信片）。
 */
(function (root) {
  'use strict';
  var NT = (root.NT = root.NT || {});
  NT.data = NT.data || {};

  NT.HOUR = 3600e3;

  /**
   * 田地。x/y/w/h 是相对田地背景图的比例（x/y 是田块中心），
   * 同时用于两件事：点击热区，以及往田垄上画绿芽的位置。
   * 所以背景图换了之后必须重新量一遍，否则芽会画到水面上去。
   * 下面这组是按当前 图片素材/田地.png 渲染结果实测的（中性色分割出四块干田，
   * 再按池水/石头边界定两块水田）。
   * type 决定能种旱田作物还是水田作物。
   *
   * sproutOffsets：绿芽的**逐象限微调**，因为两块水田的垄位和几何中心不完全对齐
   *   （干田按 2×2 均匀分布就够准，水田需要单独挪）。
   *   单位 = 游戏内一个汉字的大小（田地场景的字号，见 ui.js 的 charUnit）；
   *   [dx, dy]，右/下为正；没写的象限就用默认垄位。
   *   键：tl 左上 / tr 右上 / bl 左下 / br 右下。
   */
  NT.data.fields = [
    { id: 'dry1', type: 'dry', name: '玄此玉田·一', desc: '上层左侧的松软土地。', x: 0.350, y: 0.356, w: 0.133, h: 0.098 },
    { id: 'dry2', type: 'dry', name: '玄此玉田·二', desc: '上层中间的浅色土地。', x: 0.508, y: 0.352, w: 0.104, h: 0.086 },
    { id: 'wet1', type: 'wet', name: '楚此诸田·一', desc: '上层右侧的清浅水田。', x: 0.680, y: 0.362, w: 0.200, h: 0.140,
      // 左上本来就准（不写 = 默认垄位）。右上向左 3 个单位；左下按你的反馈向右 1 个、上 1 个。
      sproutOffsets: { tr: [-3, 0], bl: [1, -1], br: [-1, -1] } },
    { id: 'dry3', type: 'dry', name: '玄此玉田·三', desc: '下层左侧的松软土地。', x: 0.308, y: 0.516, w: 0.167, h: 0.140 },
    { id: 'dry4', type: 'dry', name: '玄此玉田·四', desc: '下层中间的浅色土地。', x: 0.525, y: 0.518, w: 0.142, h: 0.108 },
    { id: 'wet2', type: 'wet', name: '楚此诸田·二', desc: '下层右侧的清浅水田。', x: 0.700, y: 0.550, w: 0.230, h: 0.200,
      // 左下、右下各再向上 1 个单位。
      sproutOffsets: { tl: [1, 0], tr: [-1, 0], bl: [1, -2], br: [0, -2] } }
  ];

  NT.data.fieldById = function (id) {
    var l = NT.data.fields;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };

  /** 旧版 dry/wet 仍可被旧存档和自检识别。 */
  NT.data.fieldType = function (id) {
    var f = NT.data.fieldById(id);
    return f ? f.type : (id === 'dry' || id === 'wet' ? id : null);
  };

  /** 作物。growMs 为真实时间；yield 为收获的食材数量区间 */
  NT.data.crops = [
    /* ---- 玄此玉田 ---- */
    { id: 'potato', name: '土豆', field: 'dry', growMs: 2 * NT.HOUR, icon: 'stone',
      yieldItem: 'potato', yieldMin: 2, yieldMax: 4, desc: '埋在土里，看不出来熟了没有。' },
    { id: 'wheat', name: '甜甜花', field: 'dry', growMs: 4 * NT.HOUR, icon: 'flower',
      yieldItem: 'wheat', yieldMin: 2, yieldMax: 3, desc: '一片一片地倒向同一边。' },
    { id: 'soybean', name: '琉璃百合', field: 'dry', growMs: 3 * NT.HOUR, icon: 'flower',
      yieldItem: 'soybean', yieldMin: 2, yieldMax: 4, desc: '豆荚鼓鼓的，捏一下有响声。' },
    { id: 'tomato', name: '风车菊', field: 'dry', growMs: 5 * NT.HOUR, icon: 'flower',
      yieldItem: 'tomato', yieldMin: 2, yieldMax: 3, desc: '红得很快，前一天还是青的。' },
    { id: 'corn', name: '冬凌草', field: 'dry', growMs: 6 * NT.HOUR, icon: 'leaf',
      yieldItem: 'corn', yieldMin: 1, yieldMax: 3, desc: '长得比人还高，叶子会划手。' },

    /* ---- 楚此诸田 ---- */
    { id: 'wildrice', name: '金鱼草', field: 'wet', growMs: 3 * NT.HOUR, icon: 'flower',
      yieldItem: 'wildrice', yieldMin: 2, yieldMax: 4, desc: '站在水里，叶子又长又直。' },
    { id: 'waterchestnut', name: '莲蓬', field: 'wet', growMs: 4 * NT.HOUR, icon: 'seed',
      yieldItem: 'waterchestnut', yieldMin: 2, yieldMax: 5, desc: '要伸手到泥里去摸。' },
    { id: 'rice', name: '嘟嘟莲', field: 'wet', growMs: 6 * NT.HOUR, icon: 'flower',
      yieldItem: 'rice', yieldMin: 3, yieldMax: 5, desc: '水面上能看见天的倒影。' },
    { id: 'watercaltrop', name: '海灵芝', field: 'wet', growMs: 5 * NT.HOUR, icon: 'star',
      yieldItem: 'watercaltrop', yieldMin: 2, yieldMax: 4, desc: '浮在水上，翻过来是尖的。' },
    { id: 'lotus', name: '久雨莲', field: 'wet', growMs: 8 * NT.HOUR, icon: 'flower',
      yieldItem: 'lotus', yieldMin: 1, yieldMax: 3, desc: '花开了很久，底下才慢慢长起来。' }
  ];

  NT.data.cropById = function (id) {
    var l = NT.data.crops;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
  NT.data.cropsForField = function (fieldId) {
    var type = NT.data.fieldType(fieldId);
    return NT.data.crops.filter(function (c) { return c.field === type; });
  };

  /** 食材显示名 */
  NT.data.ingredients = {
    potato: '土豆', wheat: '甜甜花', soybean: '琉璃百合', tomato: '风车菊', corn: '冬凌草',
    wildrice: '金鱼草', waterchestnut: '莲蓬', rice: '嘟嘟莲', watercaltrop: '海灵芝', lotus: '久雨莲'
  };
  NT.data.ingredientName = function (id) { return NT.data.ingredients[id] || id; };

  /** 稀有道具：只提升稀有明信片概率与好运，不直接产出明信片 */
  NT.data.rareDrops = [
    { id: 'clover4', name: '四叶草', icon: 'leaf', dropChance: 0.070, foodKm: 120, scoreBonus: 1, meetBonus: 0.05,
      desc: '运气会好一点。' },
    { id: 'moonstone', name: '月光石', icon: 'star', dropChance: 0.040, foodKm: 150, scoreBonus: 1, meetBonus: 0,
      desc: '夜里会有一点亮。' },
    { id: 'windchime', name: '风铃', icon: 'bell', dropChance: 0.045, foodKm: 100, scoreBonus: 0, meetBonus: 0.12,
      desc: '响的时候，好像有人要来。' },
    { id: 'luckycoin', name: '幸运币', icon: 'key', dropChance: 0.022, foodKm: 250, scoreBonus: 2, meetBonus: 0.05,
      desc: '边缘被磨得很圆。' },
    { id: 'ancientseed', name: '古老种子', icon: 'seed', dropChance: 0.012, foodKm: 300, scoreBonus: 2, meetBonus: 0.08,
      desc: '不知道会长出什么。' }
  ];

  NT.data.rareDropById = function (id) {
    var l = NT.data.rareDrops;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
})(typeof window !== 'undefined' ? window : this);
