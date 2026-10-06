import type { MobileAppDefinition } from './types.js';

export const MOBILE_APPS_REGISTRY: Record<string, MobileAppDefinition> = {
  alipay: {
    id: 'alipay',
    displayName: '支付宝',
    packageName: 'com.eg.android.AlipayGphone',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开应用',
        description: '打开支付宝主页',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'alipays://platformapi/startapp?appId=20000001',
        },
      },
      pay: {
        id: 'pay',
        displayName: '付款码',
        description: '打开向商家付款的付款码条形码/二维码',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'alipayqr://platformapi/startapp?saId=20000056',
        },
      },
      scan: {
        id: 'scan',
        displayName: '扫一扫',
        description: '打开扫码识别摄像头',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'alipayqr://platformapi/startapp?saId=10000007',
        },
      },
      ride: {
        id: 'ride',
        displayName: '乘车码',
        description: '打开地铁/公交乘车码',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'alipays://platformapi/startapp?appId=20000193',
        },
      },
      collect: {
        id: 'collect',
        displayName: '收款码',
        description: '打开向他人收钱的二维码页面',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'alipays://platformapi/startapp?appId=20000123',
        },
      },
      transfer: {
        id: 'transfer',
        displayName: '转账',
        description: '打开支付宝转账中心',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'alipays://platformapi/startapp?appId=09999988',
        },
      },
      'ant-forest': {
        id: 'ant-forest',
        displayName: '蚂蚁森林',
        description: '打开蚂蚁森林收取能量',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'alipays://platformapi/startapp?appId=60000002',
        },
      },
    },
  },

  wechat: {
    id: 'wechat',
    displayName: '微信',
    packageName: 'com.tencent.mm',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开应用',
        description: '打开微信主界面',
        intent: {
          component: 'com.tencent.mm/.ui.LauncherUI',
        },
      },
      scan: {
        id: 'scan',
        displayName: '扫一扫',
        description: '打开微信扫一扫相机',
        intent: {
          component: 'com.tencent.mm/.plugin.scanner.ui.BaseScanUI',
        },
      },
      pay: {
        id: 'pay',
        displayName: '收付款',
        description: '打开微信离线收付款钱包界面',
        intent: {
          component: 'com.tencent.mm/.plugin.offline.ui.WalletOfflineCoinPurseUI',
        },
      },
    },
  },

  amap: {
    id: 'amap',
    displayName: '高德地图',
    packageName: 'com.autonavi.minimap',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开地图',
        description: '打开高德地图主界面',
        intent: {
          component: 'com.autonavi.minimap/com.autonavi.map.activity.NewMapActivity',
        },
      },
      navigate: {
        id: 'navigate',
        displayName: '路线规划/导航',
        description: '规划至指定地点的行车或公共出行路线',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'amapuri://route/plan/?dname=${destination}&dev=0&t=0',
        },
        parameters: [
          {
            name: 'destination',
            description: '目的地地名或地址',
            required: true,
          },
        ],
      },
      search: {
        id: 'search',
        displayName: '地点搜索',
        description: '搜索周边或指定关键字 POI 地点',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'androidamap://poi?sourceApplication=agentdock&keywords=${keyword}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '搜索关键字',
            required: true,
          },
        ],
      },
    },
  },

  baidumap: {
    id: 'baidumap',
    displayName: '百度地图',
    packageName: 'com.baidu.BaiduMap',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开地图',
        description: '打开百度地图主界面',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'baidumap://map/show',
        },
      },
      navigate: {
        id: 'navigate',
        displayName: '路线导航',
        description: '发起指定目的地的导航路线',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'baidumap://map/direction?destination=${destination}&mode=driving',
        },
        parameters: [
          {
            name: 'destination',
            description: '目的地名称',
            required: true,
          },
        ],
      },
      search: {
        id: 'search',
        displayName: '地点搜索',
        description: '搜索指定 POI 检索关键字',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'baidumap://map/place/search?query=${keyword}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '搜索地点关键词',
            required: true,
          },
        ],
      },
    },
  },

  meituan: {
    id: 'meituan',
    displayName: '美团',
    packageName: 'com.sankuai.meituan',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开应用',
        description: '打开美团首页',
        intent: {
          component: 'com.sankuai.meituan/com.meituan.android.pt.homepage.activity.MainActivity',
        },
      },
      search: {
        id: 'search',
        displayName: '商品/美食搜索',
        description: '搜索外卖、团购或商家',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'imeituan://www.meituan.com/search?q=${keyword}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '搜索商家或美食名',
            required: true,
          },
        ],
      },
      takeout: {
        id: 'takeout',
        displayName: '美团外卖',
        description: '直达美团外卖频道',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'imeituan://www.meituan.com/takeout',
        },
      },
    },
  },

  taobao: {
    id: 'taobao',
    displayName: '淘宝',
    packageName: 'com.taobao.taobao',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开淘宝',
        description: '打开淘宝首页',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'taobao://m.taobao.com',
        },
      },
      search: {
        id: 'search',
        displayName: '搜索宝贝',
        description: '搜索淘宝商品关键词',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'taobao://s.taobao.com/search?q=${keyword}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '搜索商品关键词',
            required: true,
          },
        ],
      },
      cart: {
        id: 'cart',
        displayName: '购物车',
        description: '直达淘宝购物车列表',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'taobao://m.taobao.com/cart',
        },
      },
      orders: {
        id: 'orders',
        displayName: '我的订单',
        description: '查看全部订单详情',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'taobao://my.taobao.com/order_list',
        },
      },
    },
  },

  jd: {
    id: 'jd',
    displayName: '京东',
    packageName: 'com.jingdong.app.mall',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开京东',
        description: '打开京东商城首页',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'openapp.jdmobile://virtual?params={"category":"jump","des":"home"}',
        },
      },
      search: {
        id: 'search',
        displayName: '搜索商品',
        description: '搜索京东商品关键字',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'openapp.jdmobile://virtual?params={"category":"jump","des":"productList","keyWord":"${keyword}"}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '商品名称',
            required: true,
          },
        ],
      },
      cart: {
        id: 'cart',
        displayName: '购物车',
        description: '打开京东购物车',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'openapp.jdmobile://virtual?params={"category":"jump","des":"cart"}',
        },
      },
    },
  },

  'netease-music': {
    id: 'netease-music',
    displayName: '网易云音乐',
    packageName: 'com.netease.cloudmusic',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开应用',
        description: '打开网易云音乐主界面',
        intent: {
          component: 'com.netease.cloudmusic/.activity.MainActivity',
        },
      },
      search: {
        id: 'search',
        displayName: '搜歌/搜歌手',
        description: '搜索单曲、歌手或专辑',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'orpheus://search/${keyword}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '歌曲名或歌手名',
            required: true,
          },
        ],
      },
      daily: {
        id: 'daily',
        displayName: '每日推荐',
        description: '打开每日歌曲推荐歌单',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'orpheus://daily_recommend',
        },
      },
    },
  },

  bilibili: {
    id: 'bilibili',
    displayName: '哔哩哔哩',
    packageName: 'tv.danmaku.bili',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开应用',
        description: '打开哔哩哔哩首页',
        intent: {
          component: 'tv.danmaku.bili/.ui.splash.SplashActivity',
        },
      },
      search: {
        id: 'search',
        displayName: '搜索视频',
        description: '搜索视频或UP主',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'bilibili://search?keyword=${keyword}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '搜索词',
            required: true,
          },
        ],
      },
      rank: {
        id: 'rank',
        displayName: '全站排行榜',
        description: '查看 B站热门视频排行榜',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'bilibili://rank',
        },
      },
    },
  },

  douyin: {
    id: 'douyin',
    displayName: '抖音',
    packageName: 'com.ss.android.ugc.aweme',
    defaultActionId: 'open',
    actions: {
      open: {
        id: 'open',
        displayName: '打开应用',
        description: '打开抖音首页刷视频',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'snssdk1128://',
        },
      },
      search: {
        id: 'search',
        displayName: '搜索短视频/用户',
        description: '搜索抖音内容',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: 'snssdk1128://search?keyword=${keyword}',
        },
        parameters: [
          {
            name: 'keyword',
            description: '搜索关键词',
            required: true,
          },
        ],
      },
    },
  },

  system: {
    id: 'system',
    displayName: '系统工具',
    packageName: 'com.android.settings',
    defaultActionId: 'settings',
    actions: {
      settings: {
        id: 'settings',
        displayName: '系统设置',
        description: '打开安卓系统主设置菜单',
        intent: {
          action: 'android.settings.SETTINGS',
        },
      },
      wifi: {
        id: 'wifi',
        displayName: 'WiFi 设置',
        description: '打开无线网络 WLAN 设置页',
        intent: {
          action: 'android.settings.WIFI_SETTINGS',
        },
      },
      bluetooth: {
        id: 'bluetooth',
        displayName: '蓝牙设置',
        description: '打开蓝牙连接设置页',
        intent: {
          action: 'android.settings.BLUETOOTH_SETTINGS',
        },
      },
      'app-info': {
        id: 'app-info',
        displayName: '应用详情设置',
        description: '打开指定应用的应用管理详情页',
        intent: {
          action: 'android.settings.APPLICATION_DETAILS_SETTINGS',
          uriTemplate: 'package:${package}',
        },
        parameters: [
          {
            name: 'package',
            description: '应用包名',
            required: true,
          },
        ],
      },
      browser: {
        id: 'browser',
        displayName: '打开网页',
        description: '用默认浏览器打开指定 URL',
        intent: {
          action: 'android.intent.action.VIEW',
          uriTemplate: '${url}',
        },
        parameters: [
          {
            name: 'url',
            description: '目标网址',
            required: true,
          },
        ],
      },
      dial: {
        id: 'dial',
        displayName: '拨号键盘',
        description: '打开系统拨号界面并填入电话号码',
        intent: {
          action: 'android.intent.action.DIAL',
          uriTemplate: 'tel:${phone}',
        },
        parameters: [
          {
            name: 'phone',
            description: '目标电话号码',
            required: true,
          },
        ],
      },
    },
  },
};

