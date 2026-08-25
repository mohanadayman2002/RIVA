/**
 * Renders a presentation: the agent's text exactly as they typed it, with the
 * photographs listed underneath. Nothing is parsed, reordered or rewritten —
 * line breaks and spacing are preserved as sent.
 *
 * The only concession to layout is that the first line is set larger, the way a
 * first line reads as a heading in any message. Its words are untouched.
 */

const ARABIC_RE = /[؀-ۿ]/;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const mediaPath = (rel) => `/media/${rel.split('/').map(encodeURIComponent).join('/')}`;
const mediaUrl = (baseUrl, rel) => `${baseUrl}${mediaPath(rel)}`;

/**
 * Splits off the first non-empty line for display and for the page title.
 * The remainder keeps its original spacing, blank lines and all.
 */
function splitFirstLine(text) {
  const source = String(text || '');
  const match = source.match(/^([^\n]*\S[^\n]*)\n?([\s\S]*)$/);
  if (!match) return { head: '', body: source };
  return { head: match[1].trim(), body: match[2].replace(/^\n+/, '') };
}

/**
 * Arabic counts take the plural form for 3–10 and the singular above that, and
 * the numeral should match the Arabic-Indic digits used by the date beside it.
 */
function photoCount(n, rtl) {
  if (!rtl) return `${n} ${n === 1 ? 'photo' : 'photos'}`;
  const numeral = n.toLocaleString('ar-EG');
  if (n === 1) return 'صورة واحدة';
  if (n === 2) return 'صورتان';
  return `${numeral} ${n <= 10 ? 'صور' : 'صورة'}`;
}

/** WhatsApp display names often arrive wrapped in tildes. */
const cleanName = (name) => String(name || '').replace(/^~+|~+$/g, '').trim();

function initials(name, phone) {
  const words = cleanName(name).split(/\s+/).filter(Boolean);
  if (words.length) {
    return words
      .slice(0, 2)
      .map((word) => [...word][0])
      .join('')
      .toUpperCase();
  }
  return String(phone || '').replace(/\D/g, '').slice(-2) || '·';
}

const PHONE_GLYPH =
  'M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 ' +
  '.6-.4 1-1 1C10.7 21 3 13.3 3 3.9c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1l-2.2 2.3z';

// The scalloped "verified" seal beside the name, and the tick that sits on the
// avatar, both as drawn in the reference design.
const SEAL_GLYPH =
  'M12 .6Q14.43 2.92 17.7 2.13Q18.65 5.35 21.87 6.3Q21.08 9.57 23.4 12Q21.08 14.43 21.87 ' +
  '17.7Q18.65 18.65 17.7 21.87Q14.43 21.08 12 23.4Q9.57 21.08 6.3 21.87Q5.35 18.65 2.13 ' +
  '17.7Q2.92 14.43 .6 12Q2.92 9.57 2.13 6.3Q5.35 5.35 6.3 2.13Q9.57 2.92 12 .6Z';

const TICK_GLYPH = 'M10.4 16.6 6.6 12.8l1.5-1.5 2.3 2.3 5.5-5.5 1.5 1.5z';

// The button's mark is a hollow outline in the reference rather than a solid
// glyph: the bubble is stroked, and the handset inside it is stroked too.
const WHATSAPP_OUTLINE =
  '<path d="M12.4 21.3a9 9 0 1 0-7.7-4.4l-1.5 4.7 4.9-1.4a9 9 0 0 0 4.3 1.1z"/>' +
  '<path d="M9.1 9c.2-.4.5-.5.8-.5h.5l1 2.2-.9 1c.5 1.1 1.6 2.2 2.7 2.7l1-.9 2.2 ' +
  '1v.5c0 .3 0 .6-.5.8-.6.3-1.5.2-2.5-.2a9.5 9.5 0 0 1-4.4-4.4c-.4-1-.5-1.9-.2-2.5z"/>';

export function renderPresentation(presentation, { baseUrl }) {
  const text = presentation.text || '';
  const brand = presentation.brand || {};
  const mark = brand.mark ?? brand.markRight ?? '';
  const rtl = ARABIC_RE.test(text);

  // Same-origin assets use root-relative urls, so the page renders correctly
  // even if BASE_URL is stale. Only og:image has to be absolute, because
  // crawlers fetch it out of context.
  const files = [...(presentation.images || []), ...(presentation.floorplans || [])];
  const images = files.map(mediaPath);
  const ogImage = files[0] ? mediaUrl(baseUrl, files[0]) : '';
  const { head, body } = splitFirstLine(text);
  const title = head || brand.name || 'Property';

  // What WhatsApp shows under the title when the link is forwarded: the rest of
  // the message on one line, trimmed at a word boundary.
  const flat = body.replace(/\s+/g, ' ').trim();
  const preview = flat.length > 160 ? `${flat.slice(0, 157).replace(/\s\S*$/, '')}…` : flat;

  const created = presentation.createdAt ? new Date(presentation.createdAt) : null;
  const dateLine = created
    ? created.toLocaleDateString(rtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  // ---- the agent who sent this in ----
  const agentName = cleanName(presentation.profileName);
  const agentDigits = String(presentation.waId || '').replace(/\D/g, '');
  const agentPhone = presentation.phone || (agentDigits ? `+${agentDigits}` : '');
  // WhatsApp gives no access to a sender's profile picture, so this points at a
  // photo uploaded to avatars/<number>.jpg. When there isn't one the <img>
  // fails, removes itself, and the initials underneath show through.
  const avatar = agentDigits ? `/media/avatars/${agentDigits}.jpg` : '';
  const waLink = agentDigits ? `https://wa.me/${agentDigits}` : '';
  const chatLabel = rtl ? 'مراسلة على واتساب' : 'Message on WhatsApp';

  return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f2f1ee">
<meta name="format-detection" content="telephone=no">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/brand/favicon.png" type="image/png">
<!-- The contact card is set in the reference design's faces: Jost for the
     latin, Cairo for the arabic. Only the card uses them, and display=swap
     means the text is legible on the system font before they land. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Jost:wght@400;600;700&display=swap">
<meta property="og:title" content="${escapeHtml(title)}">
${preview ? `<meta property="og:description" content="${escapeHtml(preview)}">` : ''}
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
<meta property="og:type" content="website">
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:#f2f1ee;color:#171614;
    font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue","Noto Sans Arabic",Arial,sans-serif;
    font-size:17px;line-height:1.6;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
    padding:clamp(0px,3vw,48px) clamp(0px,3vw,24px);
  }

  .card{
    max-width:880px;margin:0 auto;background:#fff;
    border-radius:clamp(0px,1.2vw,14px);
    box-shadow:0 1px 2px rgba(23,22,20,.04),0 12px 44px rgba(23,22,20,.08);
    overflow:hidden;
  }
  .inner{padding:clamp(24px,4.5vw,48px) clamp(20px,5vw,56px) clamp(26px,5vw,44px)}

  /* direction:ltr keeps the mark in the physical top-left even when the
     listing is Arabic and the page as a whole is RTL */
  .marks{direction:ltr;margin:0 0 clamp(20px,3vw,30px);line-height:0}
  .marks img{height:clamp(36px,6vw,46px);width:auto;display:block}
  .marks span{
    font-size:.82rem;letter-spacing:.24em;text-transform:uppercase;
    color:#6f6c66;font-weight:700;line-height:1.6;
  }

  h1{
    font-size:clamp(1.5rem,4.2vw,2.15rem);line-height:1.2;font-weight:650;
    letter-spacing:-.015em;margin:0;max-width:22ch;
  }
  html[dir="rtl"] h1{letter-spacing:0;line-height:1.45}

  /* the rest of the message, exactly as it was sent */
  .text{
    white-space:pre-wrap;overflow-wrap:break-word;
    margin:clamp(16px,2.5vw,22px) 0 0;font-size:1.05rem;line-height:1.78;color:#3a3733;
    max-width:58ch;
  }
  .text:empty{display:none}

  .meta{
    margin:clamp(24px,4vw,32px) 0 0;padding-top:16px;border-top:1px solid #ecebe6;
    font-size:.78rem;letter-spacing:.02em;color:#9b9891;display:flex;gap:16px;flex-wrap:wrap;
  }

  .gallery{display:grid;gap:clamp(6px,1.2vw,10px);padding:clamp(6px,1.2vw,10px)}
  .gallery.has-many{grid-template-columns:1fr 1fr}
  .gallery figure{margin:0;position:relative;overflow:hidden;background:#eceae5;border-radius:6px}
  .gallery figure.wide{grid-column:1/-1}
  .gallery img{
    width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;
    opacity:0;transition:opacity .45s ease,transform .6s cubic-bezier(.2,.7,.3,1);
  }
  .gallery img.ready{opacity:1}
  .gallery figure:hover img{transform:scale(1.025)}
  .gallery figure.wide img{aspect-ratio:16/10}
  .gallery figure:not(.wide) img{aspect-ratio:4/3}
  @media (max-width:560px){
    .gallery.has-many{grid-template-columns:1fr}
    .gallery figure:not(.wide) img{aspect-ratio:16/11}
  }

  /* ---- who sent it ---- */
  .agent{
    padding:clamp(18px,3vw,26px) clamp(16px,4vw,40px) clamp(22px,4vw,36px);
    border-top:1px solid #ecebe6;background:#fff;
  }
  /* the reference gives the card no outline: against a white footer it reads by
     its shadow alone */
  .contact{
    position:relative;overflow:hidden;background:#fff;border-radius:18px;
    padding:clamp(20px,5vw,26px);
    font-family:"Jost","Cairo","Segoe UI",system-ui,-apple-system,"Noto Sans Arabic",Arial,sans-serif;
    box-shadow:0 1px 2px rgba(23,22,20,.03),0 14px 34px rgba(23,22,20,.09);
  }
  /* a fine dot field run flush into the corner, so the card's radius clips it,
     and concentric hairlines sweeping across the other side. Both decorative,
     so they stay behind the content. */
  .contact::after{
    content:"";position:absolute;inset-block-start:0;inset-inline-end:0;z-index:0;
    width:clamp(78px,25%,120px);height:clamp(38px,12%,52px);pointer-events:none;
    background-image:radial-gradient(#1f9d55 1.25px, transparent 1.25px);
    background-size:10px 10px;opacity:.28;
  }
  /* The arcs are struck from a centre well outside the card, so what crosses it
     are gentle near-vertical sweeps rather than tight concentric rings. */
  .contact::before{
    content:"";position:absolute;inset-block:0;inset-inline-start:0;z-index:0;
    width:27%;pointer-events:none;opacity:.5;
    background:repeating-radial-gradient(circle at -170px 50%,
      transparent 0 17px,#eceae4 17px 18px);
    -webkit-mask-image:linear-gradient(to right,#000 30%,transparent);
    mask-image:linear-gradient(to right,#000 30%,transparent);
  }
  .who,.chat{position:relative;z-index:1}

  /* The card keeps the same layout in both languages: the avatar leads, the
     details sit beside it behind a hairline, and the icon comes ahead of the
     button's label. Mirroring all of that for Arabic reads as a different card,
     so only the words inside run right-to-left. */
  html[dir="rtl"] .contact{direction:ltr;text-align:left}

  .who{display:flex;align-items:center;gap:clamp(12px,2.5vw,18px);min-width:0}
  /* the hairline between the avatar and the details, overrunning the row by a
     few pixels as it does in the reference */
  .who .rule{flex:none;align-self:stretch;width:1px;background:#eae8e3;margin-block:-3px}
  .face{
    position:relative;width:clamp(56px,13vw,68px);height:clamp(56px,13vw,68px);
    flex:none;border-radius:50%;
    background:linear-gradient(155deg,#2c7a52 0%,#0f3f2a 100%);
    color:#fff;display:grid;place-items:center;
    font-weight:700;font-size:clamp(1.15rem,3.4vw,1.4rem);letter-spacing:.02em;
    box-shadow:0 0 0 4px #eef2ef,0 4px 14px rgba(15,63,42,.28);
  }
  .face img{
    position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;
  }
  /* the tick the reference puts on the avatar */
  .face::after{
    content:"";position:absolute;inset-block-end:-1px;inset-inline-end:-1px;
    width:clamp(18px,4.8vw,21px);height:clamp(18px,4.8vw,21px);
    border-radius:50%;background:#1f9d55;border:2.5px solid #fff;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fff'%3E%3Cpath d='M10.4 16.6 6.6 12.8l1.5-1.5 2.3 2.3 5.5-5.5 1.5 1.5z'/%3E%3C/svg%3E");
    background-size:76% 76%;background-position:center;background-repeat:no-repeat;
  }

  .who-text{min-width:0;flex:1}
  /* the name leads: the reference sets it at roughly twice the number's size.
     The seal sits in the text flow rather than beside the paragraph, so a name
     long enough to wrap keeps it at the end of the last word. */
  .who-name{
    margin:0;font-weight:700;font-size:clamp(1.76rem,5.6vw,1.9rem);
    color:#141312;letter-spacing:-.02em;line-height:1.2;
    overflow-wrap:anywhere;
  }
  .who-name .seal{
    width:.56em;height:.56em;margin-inline-start:.2em;vertical-align:.08em;
  }
  .who-name .seal .disc{fill:#1f9d55}
  .who-name .seal .tick{fill:#fff}
  .who-phone{
    margin:8px 0 0;display:flex;align-items:center;gap:8px;
    font-size:clamp(.88rem,2.6vw,.95rem);
  }
  /* a discreet disc, barely taller than the digits beside it */
  .who-phone .pip{
    width:clamp(15px,4vw,18px);height:clamp(15px,4vw,18px);
    flex:none;border-radius:50%;background:#e7f5ed;
    display:grid;place-items:center;
  }
  .who-phone .pip svg{width:60%;height:60%;fill:#1f9d55}
  /* iOS auto-links phone numbers and paints them blue; this is our own link */
  .who-phone a{color:#6f6c66;text-decoration:none;direction:ltr;unicode-bidi:plaintext}
  .who-phone a:hover{color:#1f9d55}

  .chat{
    display:flex;align-items:center;justify-content:center;gap:10px;
    margin-top:clamp(26px,7vw,32px);text-decoration:none;
    background:linear-gradient(100deg,#25a75c 0%,#127a42 100%);
    color:#fff;font-weight:700;font-size:clamp(.95rem,2.8vw,1rem);
    line-height:1;padding:10px 22px;border-radius:999px;
    box-shadow:0 6px 18px rgba(18,122,66,.28);
    transition:filter .15s ease,transform .15s ease,box-shadow .15s ease;
  }
  .chat:hover{filter:brightness(1.07);transform:translateY(-1px);box-shadow:0 8px 22px rgba(18,122,66,.34)}
  .chat:active{transform:translateY(0)}
  /* drawn hollow, as an outline */
  .chat svg{
    width:18px;height:18px;flex:none;
    fill:none;stroke:currentColor;stroke-width:1.6;
    stroke-linecap:round;stroke-linejoin:round;
  }
  /* a phone cannot hold the details and the button side by side without
     squeezing the name, so below this width the button takes its own line */
  @media (max-width:560px){
    .agent{gap:16px}
    .chat{width:100%;justify-content:center;padding:10px 20px}
  }

  /* full-size viewer */
  .viewer{
    position:fixed;inset:0;background:rgba(16,15,14,.94);z-index:50;
    display:none;place-items:center;padding:20px;
  }
  .viewer.open{display:grid}
  .viewer img{max-width:100%;max-height:88vh;object-fit:contain;cursor:zoom-out}
  .viewer .nav{
    position:absolute;inset-block:0;width:22%;border:0;background:transparent;
    cursor:pointer;color:#fff;font-size:2rem;opacity:.55;
  }
  .viewer .nav:hover{opacity:1}
  .viewer .prev{inset-inline-start:0}
  .viewer .next{inset-inline-end:0}
  .viewer .close{
    position:absolute;top:14px;inset-inline-end:18px;border:0;background:transparent;
    color:#fff;font-size:1.7rem;cursor:pointer;opacity:.6;line-height:1;
  }
  .viewer .close:hover{opacity:1}
  .viewer .count{
    position:absolute;bottom:16px;inset-inline:0;text-align:center;
    color:rgba(255,255,255,.7);font-size:.78rem;letter-spacing:.08em;
  }

  @media print{
    body{background:#fff;padding:0;font-size:12pt}
    .card{box-shadow:none;border-radius:0;max-width:none}
    .gallery{grid-template-columns:1fr 1fr}
    .gallery img{opacity:1 !important;aspect-ratio:auto !important;height:auto}
    .gallery figure{break-inside:avoid;page-break-inside:avoid}
    .agent{background:none;break-inside:avoid}
    .chat{background:none;color:#171614;padding:0}
    .chat svg{display:none}
    .viewer{display:none !important}
  }
</style>
</head>
<body>
<article class="card">
  <div class="inner">
    <header class="marks"><img src="/brand/cg-logo.png" alt="${escapeHtml(mark || 'logo')}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${escapeHtml(mark)}'}))"></header>
    ${head ? `<h1>${escapeHtml(head)}</h1>` : ''}
    <p class="text">${escapeHtml(body)}</p>
    ${
      dateLine || images.length
        ? `<div class="meta">
             ${dateLine ? `<span>${escapeHtml(dateLine)}</span>` : ''}
             ${images.length ? `<span>${escapeHtml(photoCount(images.length, rtl))}</span>` : ''}
           </div>`
        : ''
    }
  </div>
  ${
    images.length
      ? `<div class="gallery${images.length > 1 ? ' has-many' : ''}">${images
          .map(
            (src, i) =>
              `<figure${i === 0 || images.length === 1 ? ' class="wide"' : ''}><img src="${escapeHtml(src)}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" data-index="${i}"></figure>`,
          )
          .join('')}</div>`
      : ''
  }
  ${
    agentDigits
      ? `<footer class="agent">
           <div class="contact">
             <div class="who">
               <div class="face">${escapeHtml(initials(agentName, agentPhone))}${
                 avatar ? `<img src="${escapeHtml(avatar)}" alt="" onerror="this.remove()">` : ''
               }</div>
               <span class="rule" aria-hidden="true"></span>
               <div class="who-text">
                 ${
                   agentName
                     ? `<p class="who-name">${escapeHtml(agentName)}<svg class="seal" viewBox="0 0 24 24" aria-hidden="true"><path class="disc" d="${SEAL_GLYPH}"/><path class="tick" d="${TICK_GLYPH}"/></svg></p>`
                     : ''
                 }
                 <p class="who-phone">
                   <span class="pip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PHONE_GLYPH}"/></svg></span>
                   <a href="tel:${escapeHtml(agentPhone)}">${escapeHtml(agentPhone)}</a>
                 </p>
               </div>
             </div>
             <a class="chat" href="${escapeHtml(waLink)}" target="_blank" rel="noopener">
               <svg viewBox="0 0 24 24" aria-hidden="true">${WHATSAPP_OUTLINE}</svg>
               ${escapeHtml(chatLabel)}
             </a>
           </div>
         </footer>`
      : ''
  }
</article>

${
  images.length
    ? `<div class="viewer" id="viewer">
         <button class="close" type="button" aria-label="Close">&times;</button>
         <button class="nav prev" type="button" aria-label="Previous">&#8249;</button>
         <img id="viewerImage" src="" alt="">
         <button class="nav next" type="button" aria-label="Next">&#8250;</button>
         <div class="count" id="viewerCount"></div>
       </div>
       <script>
       (function(){
         var sources=${JSON.stringify(images)};
         var viewer=document.getElementById('viewer');
         var big=document.getElementById('viewerImage');
         var count=document.getElementById('viewerCount');
         var at=0;

         Array.prototype.forEach.call(document.querySelectorAll('.gallery img'),function(img){
           if(img.complete){img.classList.add('ready');}
           else{img.addEventListener('load',function(){img.classList.add('ready')});}
           img.addEventListener('click',function(){show(Number(img.dataset.index))});
         });

         function show(i){
           at=(i+sources.length)%sources.length;
           big.src=sources[at];
           count.textContent=(at+1)+' / '+sources.length;
           viewer.classList.add('open');
           document.body.style.overflow='hidden';
         }
         function hide(){
           viewer.classList.remove('open');
           document.body.style.overflow='';
         }
         viewer.querySelector('.close').addEventListener('click',hide);
         big.addEventListener('click',hide);
         viewer.addEventListener('click',function(e){if(e.target===viewer)hide()});
         viewer.querySelector('.prev').addEventListener('click',function(e){e.stopPropagation();show(at-1)});
         viewer.querySelector('.next').addEventListener('click',function(e){e.stopPropagation();show(at+1)});
         document.addEventListener('keydown',function(e){
           if(!viewer.classList.contains('open'))return;
           if(e.key==='Escape')hide();
           else if(e.key==='ArrowRight')show(at+1);
           else if(e.key==='ArrowLeft')show(at-1);
         });
       })();
       </script>`
    : ''
}
</body>
</html>`;
}

export function renderNotFound() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f1ee;color:#171614;
       font-family:"Segoe UI",system-ui,sans-serif;text-align:center;padding:24px}
  div{background:#fff;padding:44px 52px;border-radius:14px;box-shadow:0 12px 44px rgba(23,22,20,.08)}
  h1{font-weight:650;font-size:1.3rem;margin:0 0 8px}
  p{color:#9b9891;margin:0;font-size:.9rem}
</style></head>
<body><div><h1>Not available</h1><p>This link has expired.</p></div></body></html>`;
}
