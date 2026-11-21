import type { JSONContent, ObjType, PropertyDef } from '../db/schema';
import { BUILTIN_TYPES } from '../db/seed';
import type { Translate } from './i18n';

const defaults = new Map(BUILTIN_TYPES.map((type) => [type.id, type]));

export function typeLabel(type: ObjType | undefined, t: Translate, fallback = 'Unknown') {
  if (!type) return t(fallback);
  return type.builtin && defaults.get(type.id)?.name === type.name ? t(type.name) : type.name;
}

export function propertyLabel(type: ObjType | undefined, property: PropertyDef, t: Translate) {
  const original = type?.builtin && defaults.get(type.id)?.properties.find((item) => item.key === property.key);
  return original && original.name === property.name ? t(property.name) : property.name;
}

export function optionLabel(type: ObjType | undefined, property: PropertyDef, option: string, t: Translate) {
  const original = type?.builtin && defaults.get(type.id)?.properties.find((item) => item.key === property.key);
  return original && original.options?.includes(option) ? t(option) : option;
}

export function defaultTemplate(type: ObjType | undefined, t: Translate): JSONContent | null | undefined {
  const template = type?.defaultTemplate;
  if (!template || t.language === 'en' || !type?.builtin) return template;
  if (JSON.stringify(template) !== JSON.stringify(defaults.get(type.id)?.defaultTemplate)) return template;
  const localize = (node: JSONContent): JSONContent => ({
    ...node,
    ...(node.text ? { text: t(node.text) } : {}),
    ...(node.content ? { content: node.content.map(localize) } : {}),
  });
  return localize(template);
}
