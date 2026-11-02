(() => {
  const header = document.querySelector('.public-site-header');
  const updateHeader = () => header?.classList.toggle('is-scrolled', scrollY > 12);
  updateHeader(); window.addEventListener('scroll', updateHeader, { passive: true });
  for (const dropdown of document.querySelectorAll('.public-nav-dropdown')) {
    dropdown.addEventListener('toggle', () => { if (dropdown.open) for (const other of document.querySelectorAll('.public-nav-dropdown')) if (other !== dropdown) other.open = false; });
    dropdown.addEventListener('keydown', event => { if (event.key === 'Escape') { dropdown.open = false; dropdown.querySelector('summary').focus(); event.stopPropagation(); } });
    dropdown.querySelectorAll('a').forEach(link => link.addEventListener('click', () => dropdown.open = false));
  }
  const menu = document.getElementById('mobileNavMenu'), menuButton = document.getElementById('mobileMenuBtn');
  const closeMenu = () => { if(menu)menu.hidden=true; menuButton?.setAttribute('aria-expanded','false'); };
  menuButton?.addEventListener('click', () => {menu.hidden=!menu.hidden;menuButton.setAttribute('aria-expanded',String(!menu.hidden));});
  menu?.querySelectorAll('a,button').forEach(el => el.addEventListener('click',closeMenu));
  document.addEventListener('click',e=>{if(!e.target.closest('.public-site-header'))closeMenu();for(const details of document.querySelectorAll('.public-nav-dropdown[open]'))if(!details.contains(e.target))details.open=false;});
  window.addEventListener('resize',()=>{if(innerWidth>=1100)closeMenu();});
  window.toggleFaq = id => {const content=document.getElementById(`faq-content-${id}`),icon=document.getElementById(`faq-icon-${id}`);if(!content)return;const opening=content.classList.contains('hidden');document.querySelectorAll('[id^=faq-content-]').forEach(el=>el.classList.add('hidden'));document.querySelectorAll('[id^=faq-icon-]').forEach(el=>el.classList.remove('rotate-180'));if(opening){content.classList.remove('hidden');icon?.classList.add('rotate-180');}};
  const slides=[...document.querySelectorAll('.carousel-slide')], dots=[...document.querySelectorAll('.carousel-dot')];let current=0;
  window.setCarouselSlide = n => {if(!slides.length)return;current=(n+slides.length)%slides.length;slides.forEach((slide,i)=>{slide.classList.toggle('opacity-100',i===current);slide.classList.toggle('opacity-0',i!==current);slide.classList.toggle('pointer-events-none',i!==current);slide.setAttribute('aria-hidden',String(i!==current));});dots.forEach((dot,i)=>{dot.classList.toggle('bg-rose-500',i===current);dot.classList.toggle('bg-rose-200',i!==current);dot.setAttribute('aria-pressed',String(i===current));});};
  if(slides.length&&!matchMedia('(prefers-reduced-motion: reduce)').matches)setInterval(()=>{if(!document.hidden&&!document.querySelector('.auth-overlay:not(.hidden)'))window.setCarouselSlide(current+1);},4500);
  const dialogs={login:document.getElementById('loginModal'),register:document.getElementById('registerModal')};
  if(!dialogs.login||!dialogs.register)return;
  let active=null,trigger=null,historyInstalled=false;
  const viewport=()=>{const vv=window.visualViewport;document.documentElement.style.setProperty('--auth-viewport-height',`${Math.round(vv?.height||innerHeight)}px`);document.documentElement.style.setProperty('--auth-offset-top',`${Math.round(vv?.offsetTop||0)}px`);};
  viewport();window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);
  const role=()=>dialogs.register.querySelector('[data-account-type]')?.value==='faculty'?'faculty':'student';
  const authUrl=kind=>`/?auth=${kind}${kind==='register'?'&role='+role():''}`;
  function hide(){for(const d of Object.values(dialogs)){d.classList.add('hidden');d.classList.remove('flex');}active=null;document.body.style.overflow='';}
  function open(kind,{history=true,replace=false}={}){
    if(location.pathname!=='/'&&!['/login','/register'].includes(location.pathname)){location.assign(authUrl(kind));return;}
    trigger=document.activeElement;hide();active=kind;closeMenu();const d=dialogs[kind],card=d.querySelector('[id$=ModalCard]');d.classList.remove('hidden');d.classList.add('flex');document.body.style.overflow='hidden';viewport();card.scrollTop=0;card.focus({preventScroll:true});
    if(history){const url=authUrl(kind);if(location.pathname!=='/'||!historyInstalled){window.history.replaceState({},'','/');historyInstalled=true;window.history.pushState({careerbridgeAuth:kind},'',url);}else if(replace)window.history.replaceState({careerbridgeAuth:kind},'',url);else if(location.search!==url.slice(1))window.history.pushState({careerbridgeAuth:kind},'',url);}
  }
  async function cancelPending(){if(dialogs.register.dataset.pendingGoogle!=='true')return;const token=dialogs.register.querySelector('input[name=_csrf]')?.value;const r=await fetch('/register/cancel-google',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:token,exit:'yes'})});if(!r.ok)throw new Error('Unable to leave registration. Reload and try again.');dialogs.register.dataset.pendingGoogle='false';}
  async function close(){const pending=active==='register'&&dialogs.register.dataset.pendingGoogle==='true';if(pending){try{await cancelPending();location.replace('/');}catch(e){alert(e.message);}return;}hide();if(location.pathname!=='/'){location.replace('/');return;}window.history.replaceState({},'','/');window.scrollTo({top:0,behavior:'auto'});trigger?.focus({preventScroll:true});}
  window.openLoginModal=()=>open('login');window.openRegisterModal=()=>open('register');window.closeLoginModal=close;window.closeRegisterModal=close;
  window.switchToLoginModal=async()=>{if(dialogs.register.dataset.pendingGoogle==='true'){try{await cancelPending();location.assign('/?auth=login');}catch(e){alert(e.message);}return;}open('login',{replace:true});};
  window.switchToRegisterModal=()=>open('register',{replace:true});
  window.toggleModalPassword=(id,button)=>{const input=document.getElementById(id);if(!input)return;const show=input.type==='password';input.type=show?'text':'password';button.setAttribute('aria-label',show?'Hide password':'Show password');};
  for(const [kind,d] of Object.entries(dialogs)){
    d.querySelector('[data-close-auth]').addEventListener('click',e=>{e.preventDefault();close();});
    d.addEventListener('click',e=>{if(e.target===d)close();});
    d.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const fields=[...d.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea')].filter(el=>!el.disabled&&el.getClientRects().length);if(!fields.length)return;if(e.shiftKey&&(document.activeElement===fields[0]||document.activeElement===d.querySelector('[id$=ModalCard]'))){fields.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===fields.at(-1)){fields[0].focus();e.preventDefault();}});
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(active)close();else{closeMenu();for(const d of document.querySelectorAll('.public-nav-dropdown'))d.open=false;}}});
  window.addEventListener('popstate',()=>{const kind=new URLSearchParams(location.search).get('auth');if(['login','register'].includes(kind))open(kind,{history:false});else{const pending=active==='register'&&dialogs.register.dataset.pendingGoogle==='true';hide();if(pending)cancelPending().then(()=>location.replace('/')).catch(()=>location.replace('/'));}});
  const initial=document.body.dataset.initialAuth||new URLSearchParams(location.search).get('auth');if(['login','register'].includes(initial))open(initial);
})();
