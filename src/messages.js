/**
 * Bot copy. Deliberately tiny: the whole conversation is four questions and a
 * link. Placeholders: {url}
 */

export const COPY = {
  en: {
    askAvatar: 'Do you want to add a profile picture?',
    start: 'Send anything to start a new presentation.',
    donePhotos: 'Are you done with the photos?',
    doneText: 'Are you done with the text?',
    askFloorplan: 'Do you want a floor plan?',
    donePlans: 'Are you done with the floor plan?',
    ready: '{url}',
    mediaError: '⚠️ That photo did not arrive. Please send it again.',
    buttons: {
      done: '✅ Done',
      yes: 'Yes',
      no: 'No',
    },
  },

  ar: {
    askAvatar: 'تحب تضيف صورة شخصية؟',
    start: 'ابعت أي حاجة لبدء عرض جديد.',
    donePhotos: 'خلصت الصور؟',
    doneText: 'خلصت النص؟',
    askFloorplan: 'تحب تضيف مخطط؟',
    donePlans: 'خلصت المخطط؟',
    ready: '{url}',
    mediaError: '⚠️ الصورة دي مـوصلتش. ابعتها تاني من فضلك.',
    buttons: {
      done: '✅ تم',
      yes: 'نعم',
      no: 'لا',
    },
  },
};

export function t(lang, key, vars = {}) {
  const pack = COPY[lang] || COPY.en;
  const path = key.split('.');
  let value = pack;
  for (const part of path) value = value?.[part];
  if (value == null) value = key;
  return String(value).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ''));
}
