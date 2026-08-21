/**
 * 皮肤注册表：新角色在这里挂素材即上线。
 * 独立成模块是为了让 demo 试玩页（demo.ts）不经过 index.ts 入口
 * （index.ts 引入设置卡片 → react，demo bundle 不应含 react）。
 * 素材全部从本地 assets/ 内联（esbuild dataurl），随库发布；
 * 奶牛/熊猫/鲸鱼为手绘扁平风。
 * @module dsh-niulai-pet/skins
 */

import petImage from '../../assets/pet.png'
import petShout from '../../assets/pet_shout.png'
import petBlink from '../../assets/pet_blink.png'
import petYoung from '../../assets/pet_young.png'
import petYoungShout from '../../assets/pet_young_shout.png'
import petYoungBlink from '../../assets/pet_young_blink.png'
import petFly from '../../assets/pet_fly.png'
import petFlyShout from '../../assets/pet_fly_shout.png'
import petYoungFly from '../../assets/pet_young_fly.png'
import petYoungFlyShout from '../../assets/pet_young_fly_shout.png'
import cowImage from '../../assets/cow.png'
import cowBlink from '../../assets/cow_blink.png'
import pandaImage from '../../assets/panda.png'
import pandaBlink from '../../assets/panda_blink.png'
import whaleImage from '../../assets/whale.png'
import whaleBlink from '../../assets/whale_blink.png'
import whaleSpout from '../../assets/whale_spout.png'
import mama1 from '../../assets/mama1.mp3'
import mama2 from '../../assets/mama2.mp3'
import replyNiulai from '../../assets/reply.mp3'
import replyRef from '../../assets/reply_ref.mp3'
import replyMatch from '../../assets/reply_match.mp3'
import petOrig from '../../assets/pet_orig.png'
import petOrigShout from '../../assets/pet_orig_shout.png'
import petOrigBlink from '../../assets/pet_orig_blink.png'
import nailongImage from '../../assets/nailong.png'
import nailongBlink from '../../assets/nailong_blink.png'
import nailongShout from '../../assets/nailong_shout.png'
import nailongLaugh from '../../assets/nailong_laugh.mp3'
// 奶龙大笑逐帧序列（bv2 大笑切片 5–16s 抽帧清洗，共 23 帧；at = 占喊声全长比例）
import nailongS01 from '../../assets/nailong_s01.webp'
import nailongS02 from '../../assets/nailong_s02.webp'
import nailongS03 from '../../assets/nailong_s03.webp'
import nailongS04 from '../../assets/nailong_s04.webp'
import nailongS05 from '../../assets/nailong_s05.webp'
import nailongS06 from '../../assets/nailong_s06.webp'
import nailongS07 from '../../assets/nailong_s07.webp'
import nailongS08 from '../../assets/nailong_s08.webp'
import nailongS09 from '../../assets/nailong_s09.webp'
import nailongS10 from '../../assets/nailong_s10.webp'
import nailongS11 from '../../assets/nailong_s11.webp'
import nailongS12 from '../../assets/nailong_s12.webp'
import nailongS13 from '../../assets/nailong_s13.webp'
import nailongS14 from '../../assets/nailong_s14.webp'
import nailongS15 from '../../assets/nailong_s15.webp'
import nailongS16 from '../../assets/nailong_s16.webp'
import nailongS17 from '../../assets/nailong_s17.webp'
import nailongS18 from '../../assets/nailong_s18.webp'
import nailongS19 from '../../assets/nailong_s19.webp'
import nailongS20 from '../../assets/nailong_s20.webp'
import nailongS21 from '../../assets/nailong_s21.webp'
import nailongS22 from '../../assets/nailong_s22.webp'
import nailongS23 from '../../assets/nailong_s23.webp'
import type { SkinDef } from './pet.js'

/**
 * 语音识别参考模板（带原片底噪的旧版「牛来！」）：与干净版 reply.mp3 双模板
 * 互补——带噪输入对带噪模板更友好，干净输入对干净模板更准（voice.ts 取 min）。
 */
export const REPLY_REF = replyRef

/** 识别主模板：同一段「牛来！」的长切版（含完整衰减尾，抗短模板被「妈妈」局部强对齐）。仅匹配用，不播放。 */
export const REPLY_MATCH = replyMatch

/** 皮肤注册表（demo standalone 试玩页也复用此表）。新增皮肤时同步 host 半 index.js 的 SKIN_IDS。 */
export const SKINS: SkinDef[] = [
  {
    id: 'niulai',
    name: '牛来',
    image: petImage,
    imageShout: petShout,
    imageBlink: petBlink,
    imageFly: petFly,
    imageFlyShout: petFlyShout,
    voice: 'mama',
    sounds: [mama1, mama2],
    replySound: replyNiulai,
    signature: 'hops',
    shoutBubble: '妈~~妈~~',
    quips: ['妈——！', '我会飞你信不信'],
  },
  {
    id: 'orig',
    name: '牛来原皮',
    image: petOrig,
    imageShout: petOrigShout,
    imageBlink: petOrigBlink,
    voice: 'mama',
    sounds: [mama1, mama2],
    replySound: replyNiulai,
    signature: 'hops',
    shoutBubble: '妈~~妈~~',
    quips: ['妈——！', '我还没长角呢'],
  },
  {
    id: 'young',
    name: '小黄',
    image: petYoung,
    imageShout: petYoungShout,
    imageBlink: petYoungBlink,
    imageFly: petYoungFly,
    imageFlyShout: petYoungFlyShout,
    voice: 'mama',
    sounds: [mama1, mama2],
    replySound: replyNiulai,
    signature: 'roll',
    shoutBubble: '妈~~',
    quips: ['我还小，别卷我'],
  },
  {
    id: 'cow',
    name: '奶牛',
    image: cowImage,
    imageBlink: cowBlink,
    voice: 'moo',
    signature: 'roll',
    shoutBubble: '哞——！',
    quips: ['今天的奶产量达标了吗', '黑白配，永不过时'],
  },
  {
    id: 'panda',
    name: '熊猫',
    image: pandaImage,
    imageBlink: pandaBlink,
    voice: 'squeak',
    signature: 'roll',
    shoutBubble: '嗯嗯！',
    quips: ['竹子比 bug 好吃', '滚滚滚，别催'],
  },
  {
    id: 'whale',
    name: '蓝鲸',
    image: whaleImage,
    imageBlink: whaleBlink,
    imageSpout: whaleSpout,
    voice: 'whale',
    signature: 'breach',
    shoutBubble: '噗——！',
    quips: ['深海里没有 deadline', '咕嘟咕嘟'],
  },
  {
    id: 'nailong',
    name: '奶龙',
    image: nailongImage,
    imageShout: nailongShout,
    imageBlink: nailongBlink,
    voice: 'mama',
    sounds: [nailongLaugh],
    signature: 'sway', // 帧演出即签名；静音时的兜底动作选捧腹摇
    shoutBubble: '哈~哈~',
    // 大笑逐帧演出：站捧腹抖肚 → 抱头弯腰 → 回抱肚渐弯 → 仰头 → 憋不住倒下 → 躺地蹬腿打滚
    shoutAnim: [
      { src: nailongS01, at: 0 },
      { src: nailongS02, at: 0.036 },
      { src: nailongS03, at: 0.072 },
      { src: nailongS04, at: 0.107 },
      { src: nailongS05, at: 0.179 },
      { src: nailongS06, at: 0.214 },
      { src: nailongS07, at: 0.25 },
      { src: nailongS08, at: 0.286 },
      { src: nailongS09, at: 0.375 },
      { src: nailongS10, at: 0.429 },
      { src: nailongS11, at: 0.465 },
      { src: nailongS12, at: 0.5 },
      { src: nailongS13, at: 0.554 },
      { src: nailongS14, at: 0.607 },
      { src: nailongS15, at: 0.661 },
      { src: nailongS16, at: 0.715 },
      { src: nailongS17, at: 0.751 },
      { src: nailongS18, at: 0.769 },
      { src: nailongS19, at: 0.786 },
      { src: nailongS20, at: 0.84 },
      { src: nailongS21, at: 0.894 },
      { src: nailongS22, at: 0.947 },
      { src: nailongS23, at: 0.983 },
    ],
    quips: ['嘿嘿，今天也是快乐的一天', '捧腹大笑是基本功'],
  },
]
