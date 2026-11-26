// Turns Orbit's Traditional Chinese UI strings into Simplified Chinese (mainland wording).
// Run `npm run i18n:hans` after adding zh-Hant strings; a test fails while src/lib/i18n.zh-Hans.ts is out of date.
import * as OpenCC from 'opencc-js';

const convert = OpenCC.Converter({ from: 'twp', to: 'cn' });

/** Words OpenCC leaves in Taiwan/Hong Kong usage, or Orbit names that read better another way on the mainland. */
const WORDS = [
  ['甚么', '什么'],
  ['行事历', '日历'],
  ['预设', '默认'],
  ['拷贝', '复制'],
  ['帐号', '账号'],
  ['帐户', '账户'],
  ['物件', '对象'],
  ['还未', '还没'],
  ['撷取', '截取'],
  ['资料库', '数据库'],
  ['资料', '数据'],
  ['讯息', '消息'],
  ['滑鼠', '鼠标'],
  ['列印', '打印'],
  ['捷径', '快捷入口'],
  ['外挂', '插件'],
  ['回馈', '反馈'],
  ['登出', '退出登录'],
  ['帐单', '账单'],
  ['代码区块', '代码块'],
  ['区块', '块'],
  ['群组', '分组'],
  ['浏览器分页', '浏览器标签页'],
  ['关闭此分页', '关闭此标签页'],
  ['另存新档', '另存为新文件'],
  ['原档', '原文件'],
  ['复本', '副本'],
  ['拖曳', '拖动'],
  ['突显', '突出'],
];

export function toHans(text) {
  let out = convert(text);
  for (const [from, to] of WORDS) out = out.split(from).join(to);
  // Mainland punctuation uses curly quotes rather than corner brackets.
  return out.replace(/「/g, '“').replace(/」/g, '”').replace(/『/g, '‘').replace(/』/g, '’');
}
