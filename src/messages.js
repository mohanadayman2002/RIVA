/** Bot copy, per language. Placeholders: {brand} {n} {url} */

export const COPY = {
  en: {
    greeting:
      '👋 Welcome to {brand}.\n\nI turn your photos + details into a shareable property presentation.\n\n📸 *Step 1* — send me the photos of the unit. You can send several at once.',
    firstPhoto: 'Got it 📸 Keep sending photos — tap *Done* when you have sent them all.',
    photoCount: '{n} photos received.',
    needPhotos: 'Please send at least one photo first 📸',
    keepSending: 'Keep sending photos 📸 — tap *Done* when you have finished.',
    askText:
      '✅ {n} photo(s) received.\n\n📝 *Step 2* — now send the details in one message: price, size, bedrooms, bathrooms, location, finishing, payment plan… anything you want on the presentation.',
    askFloorplan: 'Do you want to add a floor plan?',
    floorplanPrompt: '📐 Send the floor plan image(s). Tap *Done* when finished.',
    floorplanCount: '{n} floor plan(s) received.',
    generating: '⏳ Building your presentation…',
    ready: '✅ Your presentation is ready:\n{url}\n\nOpen it, swipe through, and share the link with your client.',
    startNew: 'Send anything to start a new presentation, or tap the button below.',
    unsupported: 'I can work with photos and text only. Please send the photos as images 📸',
    error: '⚠️ Something went wrong on my side. Please try sending that again.',
    mediaError: '⚠️ I could not download that photo. Please send it again.',
    limitReached: 'That is the maximum of {n} photos. Tap *Done* to continue.',
    buttons: {
      donePhotos: '✅ Done',
      yes: 'Yes',
      no: 'No',
      donePlans: '✅ Done',
      newDeck: '🆕 New presentation',
    },
  },

  ar: {
    greeting:
      '👋 أهلاً بك في {brand}.\n\nأحوّل صورك وتفاصيل الوحدة إلى عرض تقديمي بلينك تقدر تشاركه.\n\n📸 *الخطوة ١* — ابعت صور الوحدة. تقدر تبعت أكثر من صورة مرة واحدة.',
    firstPhoto: 'تمام 📸 كمّل إرسال الصور — واضغط *تم* لما تخلّص.',
    photoCount: 'تم استلام {n} صورة.',
    needPhotos: 'من فضلك ابعت صورة واحدة على الأقل أولاً 📸',
    keepSending: 'كمّل إرسال الصور 📸 — واضغط *تم* لما تخلّص.',
    askText:
      '✅ تم استلام {n} صورة.\n\n📝 *الخطوة ٢* — ابعت التفاصيل في رسالة واحدة: السعر، المساحة، عدد الغرف، الحمامات، الموقع، التشطيب، نظام السداد… أي حاجة عايزها في العرض.',
    askFloorplan: 'تحب تضيف مخطط للوحدة؟',
    floorplanPrompt: '📐 ابعت صورة المخطط. اضغط *تم* لما تخلّص.',
    floorplanCount: 'تم استلام {n} مخطط.',
    generating: '⏳ جاري تجهيز العرض…',
    ready: '✅ العرض جاهز:\n{url}\n\nافتحه واسحب بين الشرائح، وشارك اللينك مع العميل.',
    startNew: 'ابعت أي رسالة لبدء عرض جديد، أو اضغط الزر بالأسفل.',
    unsupported: 'أقدر أتعامل مع الصور والنصوص فقط. من فضلك ابعت الصور كصور 📸',
    error: '⚠️ حصلت مشكلة عندي. من فضلك جرّب تبعت تاني.',
    mediaError: '⚠️ لم أتمكن من تحميل الصورة. من فضلك ابعتها مرة أخرى.',
    limitReached: 'وصلت للحد الأقصى {n} صورة. اضغط *تم* للمتابعة.',
    buttons: {
      donePhotos: '✅ تم',
      yes: 'نعم',
      no: 'لا',
      donePlans: '✅ تم',
      newDeck: '🆕 عرض جديد',
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
