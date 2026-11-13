(() => {
  const form = document.getElementById('course-editor'); if (!form) return;
  const moduleOnly = form.hasAttribute('data-module-editor');
  const state = document.getElementById('course-state'), root = document.getElementById('editor-fields');
  const course = JSON.parse(state.value), bank = JSON.parse(document.getElementById('bank-state').value), domains = JSON.parse(document.getElementById('domains-state').value), others = JSON.parse(document.getElementById('prerequisites-state').value);
  course.modules.forEach((module, index) => { module.number ??= index + 1; });
  course.competencyAreas ||= [course.domain];
  for (const module of course.modules) module.outcomes ??= module.skills || [];
  course.tasks ||= []; course.outcomes ||= []; course.policy ||= {}; course.prerequisites ||= [];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const uuid = () => crypto.randomUUID();
  const get = path => path.split('.').reduce((o,k) => o?.[k], course);
  const set = (path,value) => { const keys = path.split('.'), last = keys.pop(); let obj = course; for (const k of keys) obj = obj[k] ??= {}; obj[last] = value; };
  const input = (label,path,type='text',extra='') => `<label class="field">${esc(label)}<input data-path="${path}" type="${type}" value="${esc(type === 'datetime-local' && get(path) ? new Date(new Date(get(path)).getTime()-new Date(get(path)).getTimezoneOffset()*60000).toISOString().slice(0,16) : get(path))}" ${extra}></label>`;
  const area = (label,path,rows=3,lines=false) => `<label class="field">${esc(label)}<textarea data-path="${path}" rows="${rows}" ${lines?'data-lines':''}>${esc(lines ? (get(path)||[]).join('\n') : get(path))}</textarea></label>`;
  const check = (label,path,defaultValue=false) => `<label class="check-label"><input type="checkbox" data-path="${path}" ${get(path) ?? defaultValue ? 'checked':''}>${esc(label)}</label>`;
  const select = (label,path,values) => `<label class="field">${esc(label)}<select data-path="${path}">${values.map(v => {const [val,title]=Array.isArray(v)?v:[v,v];return `<option value="${esc(val)}" ${String(get(path))===String(val)?'selected':''}>${esc(title)}</option>`;}).join('')}</select></label>`;
  const actions = (path, index) => `<div class="actions"><button type="button" class="button ghost" data-move="${path}" data-index="${index}" data-delta="-1" aria-label="Move item up">↑</button><button type="button" class="button ghost" data-move="${path}" data-index="${index}" data-delta="1" aria-label="Move item down">↓</button><button type="button" class="button ghost danger" data-remove="${path}" data-index="${index}">Remove</button></div>`;
  function render() {
    const bulkReviewed = form.elements.confirmReview.checked;
    root.innerHTML = `<section class="card"><h2>01 · Course overview</h2>${input('Course title','title','text','required maxlength="160"')}${area('Description','description',3)}<div class="grid cols-3">${'<fieldset><legend>Competency areas</legend>'+domains.map(d=>`<label class="check-label"><input type="checkbox" data-course-area value="${esc(d)}" ${course.competencyAreas.includes(d)?'checked':''}>${esc(d)}</label>`).join('')+'</fieldset>'}${select('Difficulty','level',['Foundation','Intermediate','Advanced'])}${input('Estimated learning time (minutes)','minutes','number','min="5" max="6000" required')}${input('Passing score (%)','passingScore','number','min="50" max="100" required')}</div><fieldset class="field"><legend>Prerequisite courses</legend>${others.filter(c => c.id !== course.id).map(c => `<label class="check-label"><input type="checkbox" data-prerequisite="${c.id}" ${course.prerequisites.includes(c.id)?'checked':''}>${esc(c.title)}</label>`).join('') || '<p class="small muted">No other published courses.</p>'}</fieldset></section>
    <section class="card space-top"><h2>02 · Modules & topics</h2><p class="small muted">Use the arrows to change the learning order. Review the full course, then use the single confirmation below when you are ready to publish.</p>${!course.published && course.modules.length > 1 ? '<button type="button" class="button secondary" data-merge-topics>Move all topics into first module</button>' : ''}${course.modules.map((m,i) => `<details class="editor-block" id="edit-module-${esc(m.id)}" open><summary>Module ${esc(m.number ?? i+1)} · ${esc(m.title || 'Untitled module')}</summary>${actions('modules',i)}${input('Module number',`modules.${i}.number`,'number','min="1" max="9999" required')}${input('Module title',`modules.${i}.title`)}${area('Learning outcomes · one per line',`modules.${i}.outcomes`,4,true)}${area('Skills earned · one per line',`modules.${i}.skills`,3,true)}${m.lessons.map((l,j) => `<div class="editor-lesson"><div class="row between"><h3>Topic Area ${j+1}</h3>${actions(`modules.${i}.lessons`,j)}</div>${input('Topic title',`modules.${i}.lessons.${j}.title`)}${area('Topic content',`modules.${i}.lessons.${j}.body`,6)}${area('Key takeaways · one per line',`modules.${i}.lessons.${j}.takeaways`,3,true)}${l.sourceNeedsReview?'<p class="notice info">No direct source quote could be verified. Review this lesson against the material or confirm it as general course knowledge.</p>':''}${input('Source page / slide / paragraph',`modules.${i}.lessons.${j}.sourceReference`)}${area('Supporting source quote',`modules.${i}.lessons.${j}.sourceQuote`,3)}</div>`).join('')}<button class="button secondary" type="button" data-add-lesson="${i}">+ Add topic</button></details>`).join('')}<button class="button secondary space-top" type="button" data-add-module>+ Add module</button></section>
    <section class="card space-top"><h2>03 · Quiz & final assessment questions (${course.questions.length})</h2><button class="button secondary" type="button" data-expand-questions>Expand all questions</button><p class="small muted">Module quizzes use their assigned questions. The final assessment covers all questions. Verify direct citations when available; general course knowledge can be faculty-reviewed too.</p>${course.questions.map((q,i) => `<details class="editor-block" data-editor-question ${i === 0 ? "open" : ""}><summary>Question ${i+1} · ${esc(q.prompt || 'New question')}</summary>${actions('questions',i)}${area('Question',`questions.${i}.prompt`,3)}${select('Module',`questions.${i}.moduleId`,course.modules.map(m => [m.id,m.title]))}${area('Answer choices · one per line (2–6)',`questions.${i}.options`,4,true)}${input('Correct choice number (starting at 1)',`questions.${i}.answer`,'number','min="0" max="5" data-zero-based')}${area('Answer explanation',`questions.${i}.explanation`,3)}${q.sourceNeedsReview?'<p class="notice info">No direct source quote could be verified. Confirm the answer from the material or review it as general course knowledge.</p>':''}${input('Source page / slide / paragraph',`questions.${i}.sourceReference`)}${area('Supporting source quote',`questions.${i}.sourceQuote`,3)}</details>`).join('')}<div class="actions space-top"><button type="button" class="button secondary" data-add-question>+ Write question</button><label class="field grow">Insert a reviewed bank question<select id="bank-choice"><option value="">Choose a question…</option>${bank.map((q,i) => `<option value="${i}">${esc(q.prompt)}</option>`).join('')}</select></label><button type="button" class="button secondary" data-add-bank>Insert question</button></div></section>
    <section class="card space-top"><h2>04 · Practical activities</h2><p class="small muted">Students submit a written response and an optional evidence/recording link. Assigned faculty grade using your rubric. Every required practical task must pass before completion.</p>${course.tasks.map((t,i) => `<details class="editor-block" open><summary>${esc(t.title || 'Practical activity')}</summary>${actions('tasks',i)}${input('Activity title',`tasks.${i}.title`)}${area('Instructions',`tasks.${i}.instructions`,4)}${check('Required for course completion',`tasks.${i}.required`,true)}${t.rubric.map((r,j) => `<div class="grid cols-3">${input('Rubric criterion',`tasks.${i}.rubric.${j}.label`)}${input('Maximum points',`tasks.${i}.rubric.${j}.max`,'number','min="1" max="100"')}${actions(`tasks.${i}.rubric`,j)}</div>`).join('')}<button type="button" class="button ghost" data-add-criterion="${i}">+ Add criterion</button></details>`).join('')}<button type="button" class="button secondary space-top" data-add-task>+ Add practical task</button></section>
    <section class="card space-top"><h2>05 · Assessment & enrollment settings</h2><div class="grid cols-3">${input('Quiz time limit in minutes (0 = no limit)','policy.quizMinutes','number','min="0" max="180"')}${input('Assessment submissions per scope (0 = unlimited)','policy.attemptLimit','number','min="0" max="20"')}${select('Answer explanation release','policy.feedbackTiming',[['immediate','After submission'],['after-completion','After course completion']])}${input('Module quiz weight (%)','policy.quizWeight','number','min="0" max="100"')}${input('Final assessment weight (%)','policy.finalWeight','number','min="0" max="100"')}${input('Practical activity weight (%)','policy.practicalWeight','number','min="0" max="100"')}</div><p class="small muted">Weights must total 100. Without practical tasks, use 0 for practical weight. Every module quiz, the final assessment and each practical task must also meet the passing score.</p><div class="checkbox-grid">${check('Include a diagnostic course pre-test','policy.pretest')}${check('Randomize question order','policy.randomize')}${check('Require course feedback before completion','policy.feedbackRequired')}${check('Issue a completion certificate and badge','certificateEnabled',true)}</div><div class="grid cols-3">${input('Enrollment opens (your local time)','enrollFrom','datetime-local')}${input('Enrollment closes (your local time)','enrollUntil','datetime-local')}${input('Recommended deadline (your local time)','deadline','datetime-local')}</div><p class="small muted">Deadlines flag late work; students may continue learning. Enrollment dates control new enrollments.</p><div class="notice info"><strong>Publish readiness checklist</strong><ul id="publish-checklist"></ul></div></section>`;
    if (moduleOnly) {
      for (const index of [0, 3, 4]) {
        for (const field of root.children[index].querySelectorAll('input, textarea, select, button')) field.disabled = true;
      }
      for (const action of root.querySelectorAll('[data-add-module], [data-merge-topics], [data-remove="modules"], [data-move="modules"]')) action.hidden = true;
    }
    const checks = [
      ['Course title, description and competency area', course.title?.trim().length >= 4 && Boolean(course.description?.trim()) && Boolean(course.domain)],
      ['Lessons and reviewed source evidence', Boolean(course.modules?.length) && course.modules.every(m => m.title?.trim() && m.lessons?.length && m.lessons.every(l => l.title?.trim() && (l.body || '').trim().length >= 30 && (l.sourceReviewed || bulkReviewed)))],
      ['Every module has reviewed quiz questions', Boolean(course.questions?.length) && course.modules.every(m => course.questions.some(q => q.moduleId === m.id)) && course.questions.every(q => (q.reviewed || bulkReviewed) && q.explanation?.trim() && q.options?.length >= 2)],
      ['Assessment weights total 100%', Number(course.policy.quizWeight) + Number(course.policy.finalWeight) + Number(course.policy.practicalWeight) === 100],
      ['Practical task rubrics are complete', course.tasks.every(t => t.title?.trim() && t.instructions?.trim() && t.rubric?.length && t.rubric.every(r => r.label?.trim() && Number(r.max) > 0))]
    ];
    root.querySelector('#publish-checklist').innerHTML = checks.map(([label, ok]) => `<li>${ok ? 'Ready' : 'Needs review'} · ${esc(label)}</li>`).join('');
    root.querySelectorAll('[data-zero-based]').forEach(el => {el.value=Number(get(el.dataset.path)||0)+1;el.min='1';el.max='6';});
  }
  const sync = () => {state.value=JSON.stringify(course);document.getElementById('editor-status').textContent='Unsaved changes · choose Save draft to store them.';const list=root.querySelector('#publish-checklist');if(list){const bulkReviewed=form.querySelector('[name="confirmReview"]')?.checked;const checks=[['Course title, description and competency area',course.title?.trim().length>=4&&Boolean(course.description?.trim())&&Boolean(course.domain)],['Lessons and reviewed source evidence',Boolean(course.modules?.length)&&course.modules.every(m=>m.title?.trim()&&m.lessons?.length&&m.lessons.every(l=>l.title?.trim()&&(l.body||'').trim().length>=30&&(l.sourceReviewed||bulkReviewed)))],['Every module has reviewed quiz questions',Boolean(course.questions?.length)&&course.modules.every(m=>course.questions.some(q=>q.moduleId===m.id))&&course.questions.every(q=>(q.reviewed||bulkReviewed)&&q.explanation?.trim()&&q.options?.length>=2)],['Assessment weights total 100%',Number(course.policy.quizWeight)+Number(course.policy.finalWeight)+Number(course.policy.practicalWeight)===100],['Practical task rubrics are complete',course.tasks.every(t=>t.title?.trim()&&t.instructions?.trim()&&t.rubric?.length&&t.rubric.every(r=>r.label?.trim()&&Number(r.max)>0))]];list.innerHTML=checks.map(([label,ok])=>`<li>${ok?'Ready':'Needs review'} · ${esc(label)}</li>`).join('');}};
  root.addEventListener('input', e => { const el=e.target; if(el.hasAttribute('data-course-area')){course.competencyAreas=[...root.querySelectorAll('[data-course-area]:checked')].map(box=>box.value);course.domain=course.competencyAreas[0]||'';sync();return;} if (el.dataset.path) {let v=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;if(el.hasAttribute('data-zero-based'))v-=1;if(el.hasAttribute('data-lines'))v=el.value.split('\n').map(s=>s.trim()).filter(Boolean);if(el.type==='datetime-local')v=el.value?new Date(el.value).toISOString():null;set(el.dataset.path,v);if(el.dataset.path.startsWith('questions.')&&!el.dataset.path.endsWith('.reviewed')){const i=Number(el.dataset.path.split('.')[1]);course.questions[i].reviewed=false;if(el.dataset.path.endsWith('.sourceReference')||el.dataset.path.endsWith('.sourceQuote'))course.questions[i].sourceNeedsReview=false;const box=root.querySelector(`[data-path="questions.${i}.reviewed"]`);if(box)box.checked=false;}if(el.dataset.path.startsWith('modules.')&&!el.dataset.path.endsWith('.sourceReviewed')){const parts=el.dataset.path.split('.'),m=Number(parts[1]),l=Number(parts[3]);if(course.modules[m]?.lessons[l]){course.modules[m].lessons[l].sourceReviewed=false;if(el.dataset.path.endsWith('.sourceReference')||el.dataset.path.endsWith('.sourceQuote'))course.modules[m].lessons[l].sourceNeedsReview=false;const box=root.querySelector(`[data-path="modules.${m}.lessons.${l}.sourceReviewed"]`);if(box)box.checked=false;}}sync();} });
  form.querySelector('[name="confirmReview"]')?.addEventListener('change', sync);
  root.addEventListener('change', e => {if(e.target.dataset.prerequisite){const n=Number(e.target.dataset.prerequisite);course.prerequisites=e.target.checked?[...new Set([...course.prerequisites,n])]:course.prerequisites.filter(x=>x!==n);sync();}});
  root.addEventListener('click', e => {
    const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if ('expandQuestions' in d) {
      const questions = [...root.querySelectorAll('[data-editor-question]')];
      const expand = questions.some(question => !question.open);
      for (const question of questions) question.open = expand;
      b.textContent = expand ? 'Collapse all questions' : 'Expand all questions';
      return;
    }
    if(d.remove){if(!confirm('Remove this item from the draft?'))return;get(d.remove).splice(Number(d.index),1);}
    else if ('mergeTopics' in d) {
      const [first, ...extra] = course.modules;
      const topics = extra.flatMap(module => module.lessons.map((lesson, index) =>
        index === 0 ? { ...lesson, title: module.title } : lesson));
      if (first.lessons.length + topics.length > 30) return alert('One module can contain up to 30 topics.');
      if (!confirm(`Move the topics and quiz questions from the other modules into "${first.title}"?`)) return;
      first.lessons.push(...topics);
      first.outcomes = [...new Set(course.modules.flatMap(module => module.outcomes || []))].slice(0, 12);
      first.skills = [...new Set(course.modules.flatMap(module => module.skills || []))].slice(0, 12);
      first.materials = [...new Map(course.modules.flatMap(module => module.materials || [])
        .map(file => [`${file.sourceId}:${file.documentKey}`, file])).values()];
      first.number = 1;
      course.questions = course.questions.map(question => ({ ...question, moduleId: first.id }));
      course.modules = [first];
    }
    else if(d.move){const a=get(d.move),i=Number(d.index),j=i+Number(d.delta);if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];}
    else if('addModule'in d)course.modules.push({id:uuid(),title:'New module',lessons:[]});
    else if('addLesson'in d)course.modules[Number(d.addLesson)].lessons.push({id:uuid(),title:'',body:'',takeaways:[],sourceReference:'',sourceQuote:'',sourceReviewed:false});
    else if('addQuestion'in d){if(!course.modules.length)return alert('Add a module first.');course.questions.push({id:uuid(),moduleId:course.modules[0].id,prompt:'',options:['','',''],answer:0,explanation:'',domain:course.domain,reviewed:false});}
    else if('addBank'in d){const i=document.getElementById('bank-choice').value;if(i===''||!course.modules.length)return;course.questions.push({...structuredClone(bank[Number(i)]),id:uuid(),moduleId:course.modules[0].id});}
    else if('addTask'in d)course.tasks.push({id:uuid(),title:'',instructions:'',required:true,rubric:[{id:uuid(),label:'Accuracy and application',max:10},{id:uuid(),label:'Communication and professionalism',max:10}]});
    else if('addCriterion'in d)course.tasks[Number(d.addCriterion)].rubric.push({id:uuid(),label:'',max:10});
    else return;
    sync();render();
  });
  if(course.policy.quizWeight===undefined)course.policy.quizWeight=course.tasks.length?30:40;
  if(course.policy.finalWeight===undefined)course.policy.finalWeight=course.tasks.length?40:60;
  if(course.policy.practicalWeight===undefined)course.policy.practicalWeight=course.tasks.length?30:0;
  function checkQuestions(label) {
    for (const [index, question] of course.questions.entries()) {
      const choices = question.options.map(choice => choice.trim().slice(0, 500));
      let issue;
      if (question.prompt.trim().length < 8) issue = ['prompt', 'Enter a prompt of at least 8 characters.'];
      else if (choices.length < 2 || choices.length > 6 || choices.some(choice => !choice) ||
        new Set(choices.map(choice => choice.toLowerCase())).size !== choices.length) {
        issue = ['options', 'Enter 2–6 different choices, one per line.'];
      } else if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= choices.length) {
        issue = ['answer', `Enter a correct choice number from 1 to ${choices.length}.`];
      }
      if (!issue) continue;
      const [field, message] = issue;
      const input = root.querySelector(`[data-path="questions.${index}.${field}"]`);
      input.closest('details').open = true;
      label.textContent = `Question ${index + 1}. ${message}`;
      label.style.color = '#a5284c';
      input.focus();
      input.scrollIntoView({ block: 'center' });
      return false;
    }
    return true;
  }
  form.addEventListener('submit', async e=>{e.preventDefault();state.value=JSON.stringify(course);const button=e.submitter, label=document.getElementById('editor-status');const body=new URLSearchParams({_csrf:form.elements._csrf.value,courseData:state.value,action:button?.value||'draft',confirmReview:form.elements.confirmReview.checked?'yes':''});if (button?.value === 'publish' && !checkQuestions(label)) return;button.disabled=true;label.textContent='Saving course…';try{const r=await fetch(form.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});if(!r.ok){const doc=new DOMParser().parseFromString(await r.text(),'text/html');throw new Error(doc.querySelector('main section p:not(.eyebrow)')?.textContent||'Course could not be saved. Check your fields.');}window.location.assign(r.url);}catch(err){label.textContent=err.message;label.style.color='#a5284c';button.disabled=false;}}); render();
  if (location.hash.startsWith("#edit-module-")) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();

