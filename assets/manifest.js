/* ===========================================================================
 * 图片素材清单（素材标准）
 * ===========================================================================
 *
 * 这里写素材文件名或相对于「图片素材」目录的路径 —— 素材文件夹在哪一层由
 * src/assets.js 自动探测。料理、玩具和地区背景都可以放在各自的子目录中，
 * 例如「厨房料理图片/料理-xxx」「玩具/玩具-xxx」「背景/蒙德/xxx」。
 * 默认摆法是「图片素材」就在 开始游戏.html 旁边：
 *
 *     columbina-travel/
 *     ├── 开始游戏.html
 *     └── 图片素材/
 *
 * 加载器按"同层 → 上一层 → 上两层"依次试，哪个能加载成功就用哪个，
 * 所以把整个文件夹挪到别处也不会失效。
 *
 * 后缀随便写：.png / .jpg / .jpeg / .webp / .gif 都会自动认，所以这里不写后缀。
 * 没做的条目会自动回退到代码画的占位图，游戏不会被弄坏。
 *
 * 文件名全是**通用名字**，不带角色名 —— 想把主角换成别的角色、
 * 或者把地图换成提瓦特/任何地方，只需要替换「图片素材」文件夹里的图。
 * 详细的尺寸/格式/画面要求见那个文件夹里的「素材标准.txt」。
 */
(function (root) {
  'use strict';
  var NT = (root.NT = root.NT || {});

  NT.assetManifest = {
    version: 11,

    /* 素材文件夹的名字（改名了才需要动这里，一般不用管） */
    dir: '图片素材',

    /* ---------------------------------------------------------------------
     * 主角立绘
     * 1024×2048 透明 PNG，脚底贴着图片下边缘。
     * 三张的姿态和画风必须一致，最好一次画完。
     * 换角色：把这三个文件换成新角色的图即可。
     * ------------------------------------------------------------------- */
    nahida: {
      idle:  '主角-待机',    // 站着，用于发呆/看书/浇水/望着路口
      happy: '主角-开心',    // 微笑，用于玩耍/吃饭/做饭/伸懒腰
      tired: '主角-疲惫'     // 没精神，用于旅途疲惫/落汤鸡/睡觉
    },

    /* ---------------------------------------------------------------------
     * 场景背景（每个地区一组候选图，启动时随机选一张）
     * 横版风景图，不需要透明，**画面里不要出现人物**。
     * 昼夜和天气不用另画 —— 代码会自动叠色。
     * 换地图：改这里 + src/data/destinations.js 里的地区列表。
     * ------------------------------------------------------------------- */
    backgrounds: {
      mondstadt: [
        "背景/蒙德/Viewpoint_Manor_of_Daybreak.png",
        "背景/蒙德/Viewpoint_Windswept_Wilderness.png"
      ],
      liyue: [
        "背景/璃月/Viewpoint_A_Home_in_the_Hills.png",
        "背景/璃月/Viewpoint_Beyond_the_Chasm.png",
        "背景/璃月/Viewpoint_Bishui's_Twilight_Luster.png",
        "背景/璃月/Viewpoint_Clear_Skies_Over_Xuanlian.png",
        "背景/璃月/Viewpoint_Feiyun_Slope.png",
        "背景/璃月/Viewpoint_Weeping_Garden.png",
        "背景/璃月/Viewpoint_Where_Merchants_Flock_And_All_Ships_Dock.png",
        "背景/璃月/Viewpoint_Yujing_Terrace.png"
      ],
      inazuma: [
        "背景/稻妻/Viewpoint_The_Iridescent_Lake.png",
        "背景/稻妻/Viewpoint_Village_of_the_People_of_the_Deep.png"
      ],
      sumeru: [
        "背景/须弥/Viewpoint_The_Rain's_End.png",
        "背景/须弥/Viewpoint_The_Story_Recorded.png",
        "背景/须弥/Viewpoint_The_Village_by_the_River.png",
        "背景/须弥/Viewpoint_The_World_of_the_Aranara.png",
        "背景/须弥/Viewpoint_Where_a_Titan's_Shins_Were_Broken.png"
      ],
      fontaine: [
        "背景/枫丹/Viewpoint__Fontaine_Hot_Springs_.png",
        "背景/枫丹/Viewpoint__Memories_of_Mont_Esus_.png",
        "背景/枫丹/Viewpoint__Morning_in_the_Beryl_Mountains,_Clear_Weather_.png",
        "背景/枫丹/Viewpoint__Narzissenkreuz_Kingdom_.png",
        "背景/枫丹/Viewpoint__Oratrice_Mecanique_d'Analyse_Cardinale_.png",
        "背景/枫丹/Viewpoint__The_Seaside_Village_.png",
        "背景/枫丹/Viewpoint__View_From_Mont_Automnequi_.png",
        "背景/枫丹/Viewpoint_A_Distant_Harbor.png",
        "背景/枫丹/Viewpoint_A_Sea_of_Exile.png",
        "背景/枫丹/Viewpoint_Abandoned_Capital_of_Howling_Winds.png",
        "背景/枫丹/Viewpoint_Court_of_Dew_and_Springs.png"
      ],
      natlan: [
        "背景/纳塔/Viewpoint_A_Bountiful_Land_of_Farming_and_Fecundity.png",
        "背景/纳塔/Viewpoint_A_Hilly_Hidey-Hole_for_Nectar.png",
        "背景/纳塔/Viewpoint_A_Night_of_Uninhibited_Dance.png",
        "背景/纳塔/Viewpoint_Among_the_Painted_Peaks.png",
        "背景/纳塔/Viewpoint_Ancient_Thousand_Winds_Temple.png",
        "背景/纳塔/Viewpoint_Arena_of_Glory_and_Triumph.png",
        "背景/纳塔/Viewpoint_Before_the_Tezcatepetonco_Range.png",
        "背景/纳塔/Viewpoint_Canopy_of_the_Clifftops.png",
        "背景/纳塔/Viewpoint_Cavern_of_Stone_and_Prickly_Pears.png",
        "背景/纳塔/Viewpoint_Cavern_of_Tranquil_Light.png",
        "背景/纳塔/Viewpoint_Home_of_Hot_Springs_and_Flowing_Waters.png",
        "背景/纳塔/Viewpoint_Lost_Ceremonial_Site.png",
        "背景/纳塔/Viewpoint_Sacred_Mountain_of_the_Undying_Flame.png"
      ],
      nod_krai: [
        "背景/挪德卡莱/Viewpoint_Border_Town.png",
        "背景/霜月/Viewpoint__The_Next_Journey_.png",
        "背景/霜月/Viewpoint_A_Gaze_Toward_the_Stars.png",
        "背景/霜月/Viewpoint_A_Gaze_Upon_the_World.png"
      ]
    },

    /* ---------------------------------------------------------------------
     * 配角立绘（旅行途中可能遇到的角色）
     * 规格和主角完全一样：1024×2048 透明 PNG，脚底对齐。
     * 换角色：改这里 + src/data/companions.js 里的角色列表。
     * ------------------------------------------------------------------- */
    companions: {
      paimon:     '配角-派蒙',
      lauma:      '配角-菈乌玛',
      sandrone:   '配角-桑多涅',
      arlecchino: '配角-阿蕾奇诺',
      flins:      '配角-菲林斯',
      nefer:      '配角-奈芙尔',
      aino:       '配角-爱诺',
      ineffa:     '配角-伊涅芙',
      dainsleif:  '配角-戴因斯雷布',
      mera:       '配角-梅拉',
      nuonuo_tota:'配角-努昂诺塔',
      collei:     '配角-柯莱',
      tighnari:   '配角-提纳里',
      cyno:       '配角-赛诺',
      nilou:      '配角-妮露',
      dehya:      '配角-迪希雅',
      klee:       '配角-可莉',
      qiqi:       '配角-七七',
      varka:      '配角-法尔伽',
      nicole:     '配角-尼可',
      durin:      '配角-杜林',
      wanderer:   '配角-阿帽'
    },

    /* ---------------------------------------------------------------------
     * 家的全景（可放多张，每次进主页随机轮换一张）
     * 2048×1152 起，横版 16:9。
     * 换家：把图放进「图片素材」再往下面数组里加名字即可。
     * 但要注意——
     *   · 她站的位置和玩具摆的位置是按图量的**固定坐标**
     *     （src/data/home.js 的 homeSpots / toySlots），
     *     所以几张候选图的门、院子、地面要大致同构，否则轮换到某张时她会站歪
     *   · 种植已经移到独立的田地.png 场景
     * ------------------------------------------------------------------- */
    /* 候选数组 = 每次进主页随机挑一张（挑法见 src/ui.js 的 pickBackgroundVariant，
     * 两张以上时不会连续两次撞同一张）。只写一个字符串也可以，就固定用那张。 */
    home: ['庭院.png', '庭院01.png', '庭院02.png', '庭院03.png'],

    /* 独立田地场景：4:3 原图，界面只做等比缩放，不拉伸。 */
    farm: '田地.png',

    /* 大厅与卧室：独立的 16:9 场景，按 cover 等比裁剪，不拉伸。 */
    hall: '庭院.png',
    bedroom: '卧室.png',
    backyard: '后院.png',

    /* ---------------------------------------------------------------------
     * 睡觉场景：进卧室休息时，从这几张里**随机选一张**当整幅画面。
     * 这些图里已经画好了"她在床上睡着"，所以这时不再另画立绘（否则会出现两个她）。
     * 一张都没有 / 加载失败时，自动退回「卧室.png + 立绘」的旧表现。
     * 尺寸按 16:9 横图（这里几张都是 2272×1024），按 cover 等比裁剪，不拉伸。
     * ------------------------------------------------------------------- */
    bedroomSleep: [
      '卧室-睡眠-1.png',
      '卧室-睡眠-2.png',
      '卧室-睡眠-3.png'
    ],

    /* ---------------------------------------------------------------------
     * 沐浴场景：从这几张里**随机选一张**当整幅画面。
     * 该场景不画立绘、没有戳一下互动，纯粹是风景展示。
     * 一张都没有 / 加载失败时，自动退回庭院背景（无立绘、无互动）。
     * ------------------------------------------------------------------- */
    bath: [
      '沐浴-1.jpg',
      '沐浴-2.jpg',
      '沐浴-3.jpg'
    ],

    /* ---------------------------------------------------------------------
     * 田地作物与厨房料理
     * 透明 PNG。缺图时界面自动保留文字，不影响种植、收获和烹饪。
     * ------------------------------------------------------------------- */
    crops: {
      potato:          '田地作物/土豆.png',
      wheat:           '田地作物/甜甜花.png',
      soybean:         '田地作物/琉璃百合.png',
      tomato:          '田地作物/风车菊.png',
      corn:            '田地作物/冬凌草.png',
      wildrice:        '田地作物/金鱼草.png',
      waterchestnut:   '田地作物/莲蓬.png',
      rice:            '田地作物/嘟嘟莲.png',
      watercaltrop:    '田地作物/海灵芝.png',
      lotus:           '田地作物/久雨莲.png'
    },

    dishes: {
      riceball:        '厨房料理图片/料理-课后作业',
      potatocake:      '厨房料理图片/料理-土豆饼',
      cornsoup:        '厨房料理图片/料理-茶会多重奏',
      soybowl:         '厨房料理图片/料理-炉火的往迹',
      chestnutcake:    '厨房料理图片/料理-轰雷电光斩',
      caltrop_rice:    '厨房料理图片/料理-苹果焖肉（初试版）',
      lotus_soup:      '厨房料理图片/料理-嘎吱嘎吱甜甜杯',
      tricolor:        '厨房料理图片/料理-酣畅',
      lotus_rice:      '厨房料理图片/料理-镂金的宝箱',
      harvest:         '厨房料理图片/料理-皎月渺缈'
    },

    /* ---------------------------------------------------------------------
     * 玩具
     * 512×512 透明 PNG，底边对齐地面。
     * 尺寸按"相对主角身高的倍数"配（见 src/data/home.js 的 toySizeRatio）。
     * 可以只有一两件。**最多同时摆 4 件**（上限 = src/data/home.js 里 toySlots 的长度），
     * 全部摆在右边的院子里。
     * ------------------------------------------------------------------- */
    toys: {
      moon_chess:      '玩具/玩具-月亮棋',
      moon_chime:      '玩具/玩具-月灵风铃',
      moon_pool:       '玩具/玩具-月影水池',
      moon_lantern:    '玩具/玩具-月光灯',
      hammock:         '玩具-吊床',
      moon_canvas:     '玩具/玩具-月灵画板',
      moon_harp:       '玩具/玩具-月灵琴',
      moon_mosaic:     '玩具/玩具-月光矿石拼画',
      frostfin_whale:  '玩具/玩具-霜鳍鲸咬咬玩具',
      animal_headwear: '玩具/玩具-动物头饰'
    },

    /* 网页图标（做「添加到主屏幕」才需要）。tools/make-icon.html 可以自动生成。 */
    icons: {
      '512': '图标-512',
      '192': '图标-192'
    },

    /* 事件贴纸：留空 —— 39 种都是代码画的，已经能看。
     * 想换就在这儿加，例如： flower: '贴纸-花' */
    stickers: {}
  };
})(typeof window !== 'undefined' ? window : this);
