const bundled = structuredClone(window.PORTFOLIO_CONTENT);
let content = structuredClone(bundled);
let activeFilter = 'All';
let currentGalleryIndex = 0;
let firebase = null;
const app = document.querySelector('#app');
const icon = n => `<i data-lucide="${n}"></i>`;
const tags = a => (a||[]).map(x=>`<span class="tag">${x}</span>`).join('');

async function initFirebase(){
  const c=window.FIREBASE_CONFIG||{};
  if(!c.apiKey||!c.projectId) return false;
  try{
    const [{initializeApp},{getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged},{getFirestore,doc,getDoc,setDoc}] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js')
    ]);
    const fbApp=initializeApp(c), auth=getAuth(fbApp), db=getFirestore(fbApp);
    firebase={auth,db,signInWithEmailAndPassword,signOut,onAuthStateChanged,doc,getDoc,setDoc};
    const snap=await getDoc(doc(db,'portfolio','content'));
    if(snap.exists()) content=snap.data();
    return true;
  }catch(e){console.warn(e);return false}
}

function render(){
  const cats=['All',...new Set(content.gallery.map(x=>x.category))];
  const gallery=activeFilter==='All'?content.gallery:content.gallery.filter(x=>x.category===activeFilter);
  app.innerHTML=`
  <header>
    <a class="brand" href="#home">${content.site.brand}</a>
    <button class="menu" aria-label="Open navigation">${icon('menu')}</button>
    <nav>
      ${['Home','About','Experience','Projects','Photo Editing','Certificates','Contact'].map(x=>`<a href="#${x.toLowerCase().replace(' ','-')}">${x}</a>`).join('')}
      <button class="nav-resume" type="button">Resume</button>
    </nav>
    <div class="head-actions"><button class="theme" aria-label="Toggle light mode">${icon('moon')}</button><a class="btn small" href="#contact">Contact Me</a></div>
  </header>
  <main>
    <section id="home" class="hero wrap">
      <div class="hero-copy">
        <p class="eyebrow">${content.hero.eyebrow}</p>
        <h1>${content.hero.name.replace(' Jr.',' <span>Jr.</span>')}</h1>
        <p class="roles">${content.hero.roles.join(' <b>|</b> ')}</p>
        <p class="lead">${content.hero.intro}</p>
        <div class="actions"><button class="btn open-resumes" type="button">${icon('file-text')} View Resumes</button><a class="btn ghost" href="#projects">View My Work ${icon('chevron-right')}</a></div>
        <div class="social"><span>Connect with me:</span>
          <a href="${content.site.facebook}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>
          <a href="${content.site.linkedin}" target="_blank" rel="noopener" aria-label="LinkedIn">${icon('linkedin')}</a>
          <a href="${content.site.github}" target="_blank" rel="noopener" aria-label="GitHub">${icon('github')}</a>
          <a href="mailto:${content.site.email}" aria-label="Email Rolando">${icon('mail')}</a>
        </div>
      </div>
      <div class="hero-img"><img src="${content.hero.image}" alt="Rolando Lagmay Jr."></div>
    </section>

    <section class="split wrap">
      <article id="about" class="panel"><h2>${icon('user')} About Me</h2><div class="about"><div class="about-photo"><img src="${content.about.image}" alt="Rolando Lagmay Jr."></div><div class="about-copy"><p>${content.about.text}</p></div></div></article>
      <article id="experience" class="panel"><h2>${icon('briefcase-business')} Experience</h2><div class="timeline">${content.experience.map(x=>`<div class="timeline-item"><span></span><div><div class="exp-head"><h3>${x.role}</h3><time>${x.date}</time></div><a>${x.company}</a><p>${x.details}</p></div></div>`).join('')}</div></article>
    </section>

    <section id="projects" class="panel wrap"><h2>${icon('folder-git-2')} Projects</h2><div class="projects">${content.projects.map((p,i)=>`<article class="card"><button class="media" data-project="${i}"><img src="${p.image}" alt="${p.title}">${p.mediaType==='video'?`<em>${icon('play')}</em>`:''}</button><div class="card-body"><h3>${p.title}</h3><p>${p.description}</p><div class="tags">${tags(p.tags)}</div><div class="actions">${p.mediaType==='video'
  ? `<button class="btn small" data-project="${i}">${p.primaryLabel}</button>`
  : `<a class="btn small" href="${p.primaryUrl}" ${p.primaryUrl.startsWith('http')?'target="_blank" rel="noopener"':''}>${p.primaryLabel}</a>`}
${p.secondaryUrl?`<a class="btn small ghost" target="_blank" rel="noopener" href="${p.secondaryUrl}">${icon('github')} ${p.secondaryLabel}</a>`:''}</div></div></article>`).join('')}</div></section>

    <section id="photo-editing" class="panel wrap">
      <h2>${icon('camera')} Photo Editing Portfolio</h2>
      <p class="section-note">Select a category, browse the Before-and-After samples, or click one to view it in full size.</p>
      <div class="filters">${cats.map(x=>`<button class="filter ${x===activeFilter?'active':''}" data-filter="${x}">${x}</button>`).join('')}</div>
      <div class="editing-carousel-shell">
        <button class="carousel-arrow carousel-left" type="button" aria-label="Previous editing samples">${icon('chevron-left')}</button>
        <div class="editing-carousel" tabindex="0" aria-label="Photo editing samples">
          ${gallery.map(x=>`<button class="gallery-card" data-gallery-index="${content.gallery.indexOf(x)}">
            <img src="${x.image}" alt="${x.title} Before and After" loading="lazy">
            <span class="view-full">${icon('zoom-in')} View Full</span>
            <strong>${x.title}</strong>
          </button>`).join('')}
        </div>
        <button class="carousel-arrow carousel-right" type="button" aria-label="Next editing samples">${icon('chevron-right')}</button>
      </div>
    </section>

    <section class="bottom wrap">
      <article id="certificates" class="panel"><h2>${icon('award')} Certificates</h2>${content.certificates.map(x=>`<div class="cert"><span>${x.title}</span><time>${x.year}</time></div>`).join('')}</article>
      <article id="contact" class="panel contact-panel"><h2>${icon('send')} Let's Work Together</h2><p>I'm open to opportunities and meaningful projects. Let's create something useful together.</p><ul><li>${icon('phone')} <a href="tel:+6390075150210">${content.site.phone}</a></li><li>${icon('mail')} <a href="mailto:${content.site.email}">${content.site.email}</a></li><li>${icon('map-pin')} ${content.site.location}</li></ul><div class="actions"><a class="btn" href="mailto:${content.site.email}">${icon('mail')} Send Email</a><a class="btn ghost" target="_blank" rel="noopener" href="${content.site.linkedin}">${icon('linkedin')} LinkedIn</a><a class="btn ghost" target="_blank" rel="noopener" href="${content.site.facebook}">${icon('facebook')} Facebook</a></div></article>
    </section>
  </main>
  <footer class="wrap"><a class="brand" href="#home">${content.site.brand}</a><span>© ${new Date().getFullYear()} ${content.site.name}</span><a href="#home">Back to top ↑</a></footer>
  <a class="admin-link" href="#admin">Admin</a><div id="modal"></div>`;
  bind(); lucide.createIcons();
}

function bind(){
  document.querySelector('.menu').onclick=()=>document.querySelector('nav').classList.toggle('open');
  document.querySelectorAll('nav a').forEach(a=>a.onclick=()=>document.querySelector('nav').classList.remove('open'));
  document.querySelector('.nav-resume').onclick=()=>{document.querySelector('nav').classList.remove('open');openResumeChooser()};
  document.querySelectorAll('.open-resumes').forEach(b=>b.onclick=openResumeChooser);
  document.querySelector('.theme').onclick=()=>{document.documentElement.classList.toggle('light');localStorage.setItem('theme',document.documentElement.classList.contains('light')?'light':'dark'); updateThemeIcon()};
  document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{activeFilter=b.dataset.filter;render()});
  document.querySelectorAll('[data-gallery-index]').forEach(b=>b.onclick=()=>{currentGalleryIndex=Number(b.dataset.galleryIndex);openGalleryViewer()});
  setupEditingCarousel();
  document.querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>openProject(content.projects[+b.dataset.project]));
  updateThemeIcon();
}

function setupEditingCarousel(){
  const track=document.querySelector('.editing-carousel');
  const left=document.querySelector('.carousel-left');
  const right=document.querySelector('.carousel-right');
  if(!track||!left||!right)return;

  const scrollAmount=()=>Math.max(260,Math.floor(track.clientWidth*.82));

  const updateArrows=()=>{
    const maxScroll=Math.max(0,track.scrollWidth-track.clientWidth);
    const atStart=track.scrollLeft<=4;
    const atEnd=track.scrollLeft>=maxScroll-4;
    left.hidden=atStart||maxScroll<6;
    right.hidden=atEnd||maxScroll<6;
  };

  left.onclick=()=>track.scrollBy({left:-scrollAmount(),behavior:'smooth'});
  right.onclick=()=>track.scrollBy({left:scrollAmount(),behavior:'smooth'});
  track.addEventListener('scroll',updateArrows,{passive:true});
  window.addEventListener('resize',updateArrows,{passive:true});

  track.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'){e.preventDefault();track.scrollBy({left:scrollAmount(),behavior:'smooth'})}
    if(e.key==='ArrowLeft'){e.preventDefault();track.scrollBy({left:-scrollAmount(),behavior:'smooth'})}
  });

  // Convert a vertical mouse-wheel gesture into horizontal carousel movement.
  track.addEventListener('wheel',e=>{
    if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){
      e.preventDefault();
      track.scrollLeft+=e.deltaY;
    }
  },{passive:false});

  requestAnimationFrame(updateArrows);
  setTimeout(updateArrows,250);
}

function updateThemeIcon(){const b=document.querySelector('.theme');if(!b)return;b.innerHTML=icon(document.documentElement.classList.contains('light')?'sun':'moon');lucide.createIcons()}
function show(html, cls=''){const m=document.querySelector('#modal');m.innerHTML=`<div class="backdrop"><div class="modal-box ${cls}"><button class="close" aria-label="Close">${icon('x')}</button>${html}</div></div>`;m.querySelector('.close').onclick=()=>m.innerHTML='';m.querySelector('.backdrop').onclick=e=>{if(e.target===e.currentTarget)m.innerHTML=''};document.addEventListener('keydown',escClose,{once:true});lucide.createIcons()}
function escClose(e){
  if(e.key==='Escape'){
    const m=document.querySelector('#modal');
    if(m)m.innerHTML='';
    return;
  }
  if(!document.querySelector('.clean-photo-viewer'))return;

  const items=activeFilter==='All'
    ? content.gallery.map((x,i)=>({x,i}))
    : content.gallery.map((x,i)=>({x,i})).filter(v=>v.x.category===activeFilter);
  const p=items.findIndex(v=>v.i===currentGalleryIndex);

  if(e.key==='ArrowRight'&&p<items.length-1){
    currentGalleryIndex=items[p+1].i;
    openGalleryViewer();
  }
  if(e.key==='ArrowLeft'&&p>0){
    currentGalleryIndex=items[p-1].i;
    openGalleryViewer();
  }
}
function openGalleryViewer(){
  const item=content.gallery[currentGalleryIndex];
  const visibleItems=activeFilter==='All'
    ? content.gallery.map((x,i)=>({x,i}))
    : content.gallery.map((x,i)=>({x,i})).filter(v=>v.x.category===activeFilter);
  const position=visibleItems.findIndex(v=>v.i===currentGalleryIndex);

  show(`<div class="clean-photo-viewer" tabindex="0">
    <img class="clean-viewer-image" src="${item.image}" alt="${item.title} Before and After" draggable="false">
    <button class="clean-viewer-control clean-viewer-prev" type="button" aria-label="Previous sample">${icon('chevron-left')}</button>
    <button class="clean-viewer-control clean-viewer-next" type="button" aria-label="Next sample">${icon('chevron-right')}</button>
    <button class="clean-viewer-control clean-viewer-zoom" type="button" aria-label="Zoom image">${icon('zoom-in')}</button>
    <div class="clean-viewer-counter">${position+1} / ${visibleItems.length}</div>
  </div>`,'clean-image-modal');

  const modal=document.querySelector('.clean-image-modal');
  const viewer=modal.querySelector('.clean-photo-viewer');
  const image=modal.querySelector('.clean-viewer-image');
  const prev=modal.querySelector('.clean-viewer-prev');
  const next=modal.querySelector('.clean-viewer-next');
  const zoom=modal.querySelector('.clean-viewer-zoom');
  let zoomed=false,startX=0;

  const move=direction=>{
    const items=activeFilter==='All'
      ? content.gallery.map((x,i)=>({x,i}))
      : content.gallery.map((x,i)=>({x,i})).filter(v=>v.x.category===activeFilter);
    const p=items.findIndex(v=>v.i===currentGalleryIndex);
    const nextPos=p+direction;
    if(nextPos<0||nextPos>=items.length)return;
    currentGalleryIndex=items[nextPos].i;
    openGalleryViewer();
  };

  prev.hidden=position<=0;
  next.hidden=position>=visibleItems.length-1;
  prev.onclick=e=>{e.stopPropagation();move(-1)};
  next.onclick=e=>{e.stopPropagation();move(1)};
  zoom.onclick=e=>{
    e.stopPropagation();
    zoomed=!zoomed;
    image.classList.toggle('is-zoomed',zoomed);
    zoom.innerHTML=icon(zoomed?'zoom-out':'zoom-in');
    lucide.createIcons();
  };
  image.ondblclick=()=>{
    zoomed=!zoomed;
    image.classList.toggle('is-zoomed',zoomed);
  };
  viewer.addEventListener('touchstart',e=>startX=e.changedTouches[0].screenX,{passive:true});
  viewer.addEventListener('touchend',e=>{
    const distance=e.changedTouches[0].screenX-startX;
    if(Math.abs(distance)>55)move(distance<0?1:-1);
  },{passive:true});
  viewer.focus();
}
function openResumeChooser(){show(`<div class="modal-heading"><div>${icon('file-text')}</div><div><h2>Choose a Resume</h2><p>Select a resume to preview or download.</p></div></div><div class="resume-grid">${content.resumes.map((x,i)=>`<button class="resume-choice" data-choice="${i}">${icon('file-text')}<span><strong>${x.title}</strong><small>Preview PDF or download a copy</small></span>${icon('chevron-right')}</button>`).join('')}</div>`,'resume-chooser');document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>openResume(content.resumes[+b.dataset.choice]))}
function openResume(x){show(`<div class="resume-view-head"><div><h2>${x.title}</h2><p>Preview the document below or open it in a new tab.</p></div><div class="actions"><a class="btn small" target="_blank" rel="noopener" href="${x.file}">Open PDF</a><a class="btn small ghost" download href="${x.file}">Download</a></div></div><iframe title="${x.title}" src="${x.file}#view=FitH"></iframe>`,'resume-viewer')}
function openProject(x){
  const projectImage=x.title==='IT Support & Maintenance'?'assets/images/it-support-ojt-original.jpg':x.image;
  show(`${x.mediaType==='video'
  ? `<video class="blender-player" controls playsinline preload="metadata" poster="${x.image}">
       <source src="${x.primaryUrl}" type="video/mp4">
       Your browser cannot play this MP4 video.
     </video>`
  : `<img class="full-image" src="${projectImage}" alt="${x.title}">`}
  <h2>${x.title}</h2><p>${x.description}</p><div class="tags">${tags(x.tags)}</div>`)
}

function renderAdmin(){
  app.innerHTML=`<main class="admin-wrap"><div class="admin-head"><a class="brand" href="#home">${content.site.brand}</a><a class="btn ghost" href="#home">Back to Portfolio</a></div><section class="panel"><h1>Portfolio Admin</h1><p id="status"></p><div id="admin-body"></div></section></main>`;lucide.createIcons();
  if(!firebase){document.querySelector('#status').textContent='Firebase is not configured yet.';document.querySelector('#admin-body').innerHTML='<p>The website works normally. To update it online without coding, follow SETUP.md and connect a free Firebase project.</p>';return}
  firebase.onAuthStateChanged(firebase.auth,user=>user?editor(user):login());
}
function login(){document.querySelector('#status').textContent='Sign in with your Firebase administrator account.';document.querySelector('#admin-body').innerHTML=`<form id="login"><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" required></label><button class="btn">Sign In</button><p id="msg"></p></form>`;document.querySelector('#login').onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{await firebase.signInWithEmailAndPassword(firebase.auth,f.get('email'),f.get('password'))}catch(err){document.querySelector('#msg').textContent=err.message}}}
function editor(user){document.querySelector('#status').innerHTML=`Signed in as <strong>${user.email}</strong>. Edit the content and save.`;document.querySelector('#admin-body').innerHTML=`<div class="actions"><button id="save" class="btn">${icon('save')} Save Changes</button><button id="logout" class="btn ghost">Log Out</button></div><p>Edit the portfolio data below. Keep the JSON punctuation valid.</p><textarea id="json">${JSON.stringify(content,null,2)}</textarea><p id="msg"></p>`;lucide.createIcons();document.querySelector('#logout').onclick=()=>firebase.signOut(firebase.auth);document.querySelector('#save').onclick=async()=>{try{let next=JSON.parse(document.querySelector('#json').value);await firebase.setDoc(firebase.doc(firebase.db,'portfolio','content'),next);content=next;document.querySelector('#msg').textContent='Saved successfully.'}catch(e){document.querySelector('#msg').textContent=e.message}}}

(async()=>{if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light');await initFirebase();if(location.hash==='#admin')renderAdmin();else render();window.addEventListener('hashchange',()=>location.hash==='#admin'?renderAdmin():render())})();
