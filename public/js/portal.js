(() => {
  const csrf = () => document.querySelector('meta[name=csrf-token]')?.content || document.querySelector('input[name=_csrf]')?.value;
  for (const form of document.querySelectorAll('[data-confirm]')) form.addEventListener('submit', e => {if(!confirm(form.dataset.confirm))e.preventDefault();});
  for (const form of document.querySelectorAll('[data-upload]')) form.addEventListener('submit', async e => {
    e.preventDefault();const b=form.querySelector('button'),status=form.querySelector('.upload-status');b.disabled=true;status.textContent='Uploading and processing…';
    try {const r=await fetch(form.action,{method:'POST',headers:{'X-CSRF-Token':csrf(),Accept:'application/json'},body:new FormData(form)});if(!r.ok){const body=await r.text();let data;try{data=JSON.parse(body);}catch{}const parsed=new DOMParser().parseFromString(body,'text/html');throw new Error(data?.message ? data.message+(data.reference?' · Reference '+data.reference:'') : parsed.querySelector('.notice, .message, main p')?.textContent||'Upload failed. Check the file type and size, then retry.');}window.location.assign(r.url);}
    catch(err){status.textContent=err.message;b.disabled=false;}
  });
  for(const f of document.querySelectorAll('[data-question-form]')){
    const options=f.querySelector('[data-options]'),answer=f.querySelector('[data-answer-index]');if(options.dataset.choices)options.value=JSON.parse(options.dataset.choices).join('\n');if(answer)answer.value=Number(answer.dataset.answerIndex)+1;
    f.addEventListener('submit',()=>{f.elements.options.value=JSON.stringify(options.value.split('\n').map(s=>s.trim()).filter(Boolean));f.elements.answer.value=Number(f.elements.answerNumber.value)-1;});
  }
  for(const form of document.querySelectorAll('form:not(#course-editor)'))form.addEventListener('submit',()=>{for(const input of form.querySelectorAll('input[type=datetime-local]')){if(input.value){const hidden=document.createElement('input');hidden.type='hidden';hidden.name=input.name;hidden.value=new Date(input.value).toISOString();input.removeAttribute('name');form.append(hidden);}}});
  const createAccount=document.querySelector('form[method="post"][action="/admin/users"]');if(createAccount){const role=createAccount.querySelector('select[name=role]');const update=()=>{const faculty=role.value==='faculty';for(const name of ['studentId','section','gender','facultyId','approvalStatus']){const el=createAccount.elements[name],show=['facultyId','approvalStatus'].includes(name)?faculty:!faculty;el.closest('.field').hidden=!show;el.disabled=!show;if(name!=='approvalStatus')el.required=show;}};role.addEventListener('change',update);update();}
  const counters=document.querySelectorAll('[data-notification-count]');if(counters.length){const refresh=async()=>{if(document.hidden)return;try{const r=await fetch('/notifications/count');if(!r.ok||!r.headers.get('content-type')?.includes('json'))return;const d=await r.json();for(const el of counters){el.textContent=d.unread>99?'99+':d.unread;el.hidden=!d.unread;}}catch{}};setInterval(refresh,30000);}
  for(const form of document.querySelectorAll('[data-draft-url]')){
    let revision=Number(form.dataset.revision),timer,busy=false,dirty=false,blocked=false;
    const label=form.querySelector('.quiz-draft');
    const save=async()=>{if(busy||!dirty||blocked)return;busy=true;dirty=false;const answers={};for(const i of form.querySelectorAll('input[type=radio]:checked'))answers[i.name.match(/^answers\[(.+)\]$/)[1]]=i.value;
      try{const r=await fetch(form.dataset.draftUrl,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify({revision,answers})});if(r.status===409){blocked=true;throw new Error('This assessment changed or expired. Reload the page to continue.');}if(!r.ok)throw new Error('Answers pending · check your connection or sign in again.');const d=await r.json();revision=d.revision;label.textContent=dirty?'Saving newer answers…':'Saved to your account ✓';label.classList.toggle('saved',!dirty);}
      catch(e){dirty=true;label.textContent=e.message;label.classList.remove('saved');}finally{busy=false;if(dirty&&!blocked)timer=setTimeout(save,3000);}};
    form.addEventListener('change',()=>{dirty=true;label.textContent='Saving answers…';label.classList.remove('saved');clearTimeout(timer);timer=setTimeout(save,350);});
    window.addEventListener('online',save);window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
    form.addEventListener('submit',()=>{dirty=false;clearTimeout(timer);});
  }
  for(const timer of document.querySelectorAll('[data-timer]')){let seconds=Number(timer.dataset.timer);const tick=()=>{timer.textContent=seconds>0?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} remaining`:'Time expired · restart below';seconds=Math.max(0,seconds-1);};tick();setInterval(tick,1000);}
  const outline=document.querySelector('.lesson-outline');if(outline&&matchMedia('(max-width: 800px)').matches)outline.open=false;
})();
