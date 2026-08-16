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

const mediaUrl = (baseUrl, rel) => `${baseUrl}/media/${rel.split('/').map(encodeURIComponent).join('/')}`;

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

export function renderPresentation(presentation, { baseUrl }) {
  const text = presentation.text || '';
  const brand = presentation.brand || {};
  const rtl = ARABIC_RE.test(text);

  const images = [...(presentation.images || []), ...(presentation.floorplans || [])].map((rel) =>
    mediaUrl(baseUrl, rel),
  );
  const { head, body } = splitFirstLine(text);
  const title = head || brand.name || 'Property';

  const created = presentation.createdAt ? new Date(presentation.createdAt) : null;
  const dateLine = created
    ? created.toLocaleDateString(rtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f3f2ef">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
${images[0] ? `<meta property="og:image" content="${escapeHtml(images[0])}">` : ''}
<meta property="og:type" content="website">
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:#f3f2ef;color:#191817;
    font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue","Noto Sans Arabic",Arial,sans-serif;
    font-size:17px;line-height:1.6;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
    padding:clamp(0px,3vw,44px) clamp(0px,3vw,24px);
  }

  .card{
    max-width:860px;margin:0 auto;background:#fff;
    border-radius:clamp(0px,1vw,10px);
    box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 34px rgba(0,0,0,.07);
    overflow:hidden;
  }
  .inner{padding:clamp(26px,5vw,52px) clamp(20px,5vw,56px)}

  .brand{
    font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:#9a9791;
    margin:0 0 22px;font-weight:600;
  }
  html[dir="rtl"] .brand{letter-spacing:0;text-transform:none;font-size:.84rem}

  h1{
    font-size:clamp(1.45rem,4vw,2.05rem);line-height:1.22;font-weight:600;
    letter-spacing:-.012em;margin:0;max-width:24ch;
  }
  html[dir="rtl"] h1{letter-spacing:0;line-height:1.4}

  /* the rest of the message, exactly as it was sent */
  .text{
    white-space:pre-wrap;overflow-wrap:break-word;
    margin:22px 0 0;font-size:1.045rem;line-height:1.75;color:#37342f;
    max-width:56ch;
  }
  .text:empty{display:none}
  .meta{
    margin:30px 0 0;padding-top:18px;border-top:1px solid #eceae5;
    font-size:.78rem;color:#9a9791;display:flex;gap:14px;flex-wrap:wrap;
  }

  .gallery{display:grid;gap:clamp(6px,1.4vw,12px);padding:clamp(6px,1.4vw,12px)}
  .gallery.has-many{grid-template-columns:1fr 1fr}
  .gallery figure{margin:0;position:relative;overflow:hidden;background:#eceae5;border-radius:3px}
  .gallery figure.wide{grid-column:1/-1}
  .gallery img{
    width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;
    opacity:0;transition:opacity .45s ease,transform .5s ease;
  }
  .gallery img.ready{opacity:1}
  .gallery figure:hover img{transform:scale(1.02)}
  .gallery figure.wide img{aspect-ratio:16/10}
  .gallery figure:not(.wide) img{aspect-ratio:4/3}
  @media (max-width:560px){
    .gallery.has-many{grid-template-columns:1fr}
    .gallery figure:not(.wide) img{aspect-ratio:16/11}
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
    .viewer{display:none !important}
  }
</style>
</head>
<body>
<article class="card">
  <div class="inner">
    ${brand.name ? `<p class="brand">${escapeHtml(brand.name)}</p>` : ''}
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

         // fade each photo in once it has actually decoded
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
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f2ef;color:#191817;
       font-family:"Segoe UI",system-ui,sans-serif;text-align:center;padding:24px}
  div{background:#fff;padding:44px 52px;border-radius:10px;box-shadow:0 8px 34px rgba(0,0,0,.07)}
  h1{font-weight:600;font-size:1.3rem;margin:0 0 8px}
  p{color:#9a9791;margin:0;font-size:.9rem}
</style></head>
<body><div><h1>Not available</h1><p>This link has expired.</p></div></body></html>`;
}
