(() => {
  'use strict';

  const STORAGE_KEY = 'thinkmate_workspace_v1';
  const STOP = new Set(('about above after again against also among another any are because been before being between both could did does each few from further had has have here into its itself just more most other our out over same should since some such than that their them then there these they this those through under until very was were what when where which while with would your you the and for but not all can may our use using from into onto will than have has are his her its who how does made make like very much more most some other another their there what when then that this into your about after before while through being have into they those which each other only also because could does across between during where why how describe explain').split(/\s+/));
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const uid = () => 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const readStore = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { guides: [], attempts: [], theme: 'light' }; } catch { return { guides: [], attempts: [], theme: 'light' }; } };
  let store = readStore();
  store.guides ||= []; store.attempts ||= [];
  let activeGuideId = null;
  let flashIndex = 0;
  let flashRevealed = false;
  let quizState = null;
  let toastTimer;
  let pdfJsPromise = null;
  let mammothPromise = null;

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); return true; }
    catch { toast('Your browser storage is full. Try removing a guide or shortening the source text.'); return false; }
  }
  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function cleanSource(text, isHtml) {
    if (isHtml) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      doc.querySelectorAll('script,style,noscript,svg').forEach(node => node.remove());
      text = doc.body.textContent || '';
    }
    return String(text).replace(/\r/g,'').replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  }
  function splitSentences(text) {
    const chunks = text.replace(/\n+/g,'. ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 25);
    return chunks.length ? chunks : text.split(/\n+/).map(s => s.trim()).filter(s => s.length > 25);
  }
  function getKeywords(text) {
    const tally = new Map();
    (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).forEach(word => {
      const term = word.replace(/^[-']+|[-']+$/g,'');
      if (term.length > 3 && !STOP.has(term)) tally.set(term, (tally.get(term) || 0) + 1);
    });
    return [...tally].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([word]) => word);
  }
  const pretty = text => String(text).replace(/[-_]+/g,' ').replace(/\b\w/g,c => c.toUpperCase());
  const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function buildGuide(title, source) {
    const sentences = splitSentences(source);
    const terms = getKeywords(source);
    const usableTerms = terms.length ? terms : ['main idea'];
    const notes = sentences.slice(0, 10);
    const flashcards = usableTerms.slice(0, Math.min(10, Math.max(4, usableTerms.length))).map(term => {
      const found = sentences.find(sentence => new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(sentence));
      return { term: pretty(term), question: `What does your material say about “${pretty(term)}”?`, answer: found || `The term “${pretty(term)}” appears in the source material.` };
    });
    const quiz = [];
    const used = new Set();
    for (const sentence of sentences) {
      if (quiz.length >= 8) break;
      const matches = usableTerms.filter(term => sentence.toLowerCase().includes(term) && !used.has(term));
      if (!matches.length) continue;
      const answer = matches[0]; used.add(answer);
      const masked = sentence.replace(new RegExp(`\\b${escapeRegex(answer)}\\b`, 'i'), '______');
      const distractors = usableTerms.filter(term => term !== answer && !matches.includes(term)).slice(0,3);
      const options = [answer, ...distractors];
      if (options.length < 2) options.push('Not stated in the material');
      quiz.push({ id: 'q' + quiz.length, topic: pretty(answer), prompt: `Complete the statement from your notes: “${masked}”`, answer, options: shuffle(options), explanation: `Your source says: “${sentence}”` });
    }
    if (!quiz.length) {
      const sentence = sentences[0] || source.slice(0,180);
      quiz.push({ id:'q0', topic: title, prompt:'Which answer is taken directly from the source material?', answer: sentence.slice(0,120), options: shuffle([sentence.slice(0,120), 'The source does not mention this topic.']), explanation:`Your source says: “${sentence}”` });
    }
    return { sentences, terms: usableTerms, notes, flashcards, quiz };
  }
  async function fetchTopicSource(topic) {
    const params = new URLSearchParams({action:'query',list:'search',srsearch:topic,format:'json',origin:'*',srlimit:'1'});
    const searchResponse = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {headers:{Accept:'application/json'}});
    if (!searchResponse.ok) throw new Error('The topic search is unavailable right now. Paste your own notes instead.');
    const searchData = await searchResponse.json();
    const hit = searchData.query?.search?.[0];
    if (!hit) throw new Error('No Wikipedia background article was found for that topic. Try a more specific title or paste your own notes.');
    const pageParams = new URLSearchParams({action:'query',prop:'extracts',explaintext:'1',exchars:'1200',exsentences:'10',titles:hit.title,format:'json',origin:'*'});
    const pageResponse = await fetch(`https://en.wikipedia.org/w/api.php?${pageParams}`, {headers:{Accept:'application/json'}});
    if (!pageResponse.ok) throw new Error('The background article could not be loaded. Paste your own notes instead.');
    const pageData = await pageResponse.json();
    const page = Object.values(pageData.query?.pages || {})[0];
    const text = cleanSource(page?.extract || '', false);
    if (text.length < 50) throw new Error('The background article did not include enough text to build a guide. Try another topic.');
    return {title:page.title, text, url:`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g,'_'))}`};
  }
  function loadScript(url) {
    return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=()=>reject(new Error('A document reader could not be loaded. Check your internet connection or paste the text instead.'));document.head.appendChild(script)});
  }
  async function extractDocument(file) {
    const extension=file.name.split('.').pop().toLowerCase();
    if(extension==='pdf') {
      if(!pdfJsPromise) pdfJsPromise=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
      const pdfjs=await pdfJsPromise;
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
      if(pdf.numPages>50) throw new Error('This PDF has more than 50 pages. Please upload a shorter section or paste selected text.');
      const pages=[];
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) { const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();pages.push(content.items.map(item=>item.str).join(' ')); }
      const text=pages.join('\n\n');
      if(text.trim().length<50) throw new Error('No selectable text was found in this PDF. It may be a scanned image; use OCR first or paste the text.');
      return text;
    }
    if(extension==='docx') {
      if(!window.mammoth) {
        if(!mammothPromise) mammothPromise=loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.js');
        await mammothPromise;
      }
      const result=await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
      if(result.value.trim().length<50) throw new Error('No readable text was found in this Word document.');
      return result.value;
    }
    const raw=await file.text();
    return cleanSource(raw,/\.html?$/i.test(file.name));
  }
  function shuffle(items) { return [...items].sort(() => Math.random() - .5); }
  function openPage(name) {
    document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === 'page-' + name));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === name));
    const labels = {home:'Overview',library:'My library',study:'Study room',progress:'My progress'};
    $('crumb').textContent = labels[name] || 'Overview';
    $('sidebar').classList.remove('open');
    if (name === 'home') renderHome();
    if (name === 'library') renderLibrary();
    if (name === 'progress') renderProgress();
    if (name === 'study' && !activeGuideId) showStudyEntry();
    window.scrollTo({ top:0, behavior:'smooth' });
  }
  function guideById(id) { return store.guides.find(guide => guide.id === id); }
  function currentGuide() { return guideById(activeGuideId); }
  const icons = ['✧','◉','⌘','✿','◈'];
  const colors = ['blue','mint','peach','lilac'];
  function guideCard(guide, index) {
    const summary = guide.analysis.notes.slice(0,2).join(' ').slice(0,130) || 'Your study guide is ready to explore.';
    return `<article class="guide-card"><div class="guide-top"><span class="subject-icon ${colors[index%colors.length]}">${icons[index%icons.length]}</span><div class="guide-name"><strong title="${safe(guide.title)}">${safe(guide.title)}</strong><span>${new Date(guide.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · ${guide.analysis.quiz.length} practice questions</span></div><button class="kebab" data-delete-guide="${safe(guide.id)}" aria-label="Delete ${safe(guide.title)}">×</button></div><p class="guide-summary">${safe(summary)}${summary.length >= 130 ? '…' : ''}</p><div class="guide-footer"><small>${guide.source.length.toLocaleString()} characters</small><button class="guide-open" data-open-guide="${safe(guide.id)}">Open study guide →</button></div></article>`;
  }
  function emptyState(label, copy, action) { return `<div class="empty-state"><div class="empty-illustration">✦</div><h3>${label}</h3><p>${copy}</p><button class="button button-primary" data-action="${action}">Create a study guide <span>→</span></button></div>`; }
  function renderHome() {
    const guides = store.guides.slice(0,3);
    $('today-label').textContent = new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    $('library-count').textContent = store.guides.length;
    $('recent-guides').innerHTML = guides.length ? guides.map(guideCard).join('') : emptyState('Your study space is ready','Create your first guide to turn a topic into something you can learn from.','new-study');
    $('stat-sessions').textContent = store.attempts.length;
    $('stat-guides').textContent = store.guides.length;
    $('stat-average').textContent = store.attempts.length ? Math.round(store.attempts.reduce((sum,a)=>sum+a.percent,0)/store.attempts.length)+'%' : '—';
    const recent = store.attempts.slice(-6);
    const heights = recent.map(a => Math.max(8,Math.round(a.percent*.38)));
    $('mini-bars').innerHTML = (heights.length ? heights : [12,18,10,24,14,8]).map((h,i,all)=>`<span class="mini-bar ${i===all.length-1&&recent.length?'latest':''}" style="height:${h}px" title="${recent[i] ? recent[i].percent+'%' : 'No quiz yet'}"></span>`).join('');
  }
  function renderLibrary(filter='') {
    $('library-count').textContent = store.guides.length;
    $('library-subtitle').textContent = `${store.guides.length} ${store.guides.length===1?'study guide':'study guides'}`;
    const list = store.guides.filter(g => g.title.toLowerCase().includes(filter.toLowerCase()));
    $('all-guides').innerHTML = list.length ? list.map(guideCard).join('') : filter ? '<div class="empty-state"><h3>No matching guides</h3><p>Try another topic name.</p></div>' : emptyState('Nothing here just yet','Add a topic or your own notes to make your first guide.','new-study');
  }
  function showStudyEntry() {
    activeGuideId = null;
    $('study-empty').hidden = false; $('study-workspace').hidden = true;
    $('study-title').textContent = "Let's make it make sense.";
    $('study-subtitle').textContent = 'Start with a topic, or bring your own notes.';
    $('material-title').value = ''; $('material-text').value = ''; $('material-file').value = ''; $('file-name').textContent=''; $('char-count').textContent='0 characters'; $('form-error').textContent='';
  }
  function openGuide(id) {
    const guide = guideById(id); if (!guide) return;
    activeGuideId=id;
    $('study-empty').hidden=true; $('study-workspace').hidden=false;
    $('study-title').textContent=guide.title; $('study-subtitle').textContent='Your study guide, built from your source material.';
    $('source-label').textContent=guide.sourceName ? '· '+guide.sourceName : '· pasted notes';
    renderStudyTabs(guide); openPage('study');
  }
  function renderStudyTabs(guide) {
    const a=guide.analysis;
    $('tab-notes').innerHTML=`<div class="notes-content"><h2>${safe(guide.title)}</h2><div class="note-callout">These notes use only the material in your source. Check the original for context.${guide.sourceUrl?` Source: Wikipedia (CC BY-SA). <a href="${safe(guide.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source article ↗</a>`:''}</div><h3>Summary</h3><p>${safe(a.notes.slice(0,3).join(' ') || 'The source is ready to study.')}</p><h3>Key ideas</h3><ul>${a.notes.map(s=>`<li>${safe(s)}</li>`).join('')}</ul><button class="button button-quiet" id="download-notes">↓ Download notes</button></div>`;
    $('flashcard-count').textContent=a.flashcards.length;
    flashIndex=0;flashRevealed=false;renderFlashcard(guide);
    const branches=a.terms.slice(0,8).map(term=>{const sentence=a.sentences.find(s=>s.toLowerCase().includes(term));return `<div class="mind-branch"><h4>${safe(pretty(term))}</h4><div class="mind-line"></div><p>${safe(sentence || 'This key term appears in your source material.')}</p></div>`}).join('');
    $('tab-mindmap').innerHTML=`<div class="mindmap"><div class="mind-root">✦ ${safe(guide.title)}</div>${branches || '<p class="muted">Add more source details to discover key ideas.</p>'}</div>`;
    $('tab-tutor').innerHTML=`<div class="chat-box"><div class="chat-heading"><span class="chat-avatar">✧</span><div><strong>Source-aware study helper</strong><small>Finds matching passages in your material. No generated facts.</small></div></div><div class="chat-messages" id="chat-messages"><div class="chat-msg bot">Ask about a term or idea in your notes and I’ll find a related passage.</div></div><form class="chat-input-row" id="chat-form"><input id="chat-input" autocomplete="off" placeholder="Ask about your source material…" aria-label="Ask about your material"><button class="button button-primary">Ask</button></form></div>`;
    $('tab-videos').innerHTML=`<p class="muted" style="font-size:11px;margin:0 0 13px">Search YouTube for explanations related to your topic. Video results come from YouTube and may change.</p><div class="video-list">${a.terms.slice(0,8).map(term=>`<a class="video-link" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=${encodeURIComponent(pretty(term)+' '+guide.title)}"><span class="video-play">▶</span><span><strong>${safe(pretty(term))}</strong><small>YouTube learning search ↗</small></span></a>`).join('')}</div>`;
    document.querySelectorAll('.study-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.tab==='notes'));
    document.querySelectorAll('.tab-panel').forEach(panel=>panel.classList.toggle('active',panel.id==='tab-notes'));
    $('start-quiz').onclick=()=>startQuiz(guide.id);
    $('download-notes').onclick=()=>downloadNotes(guide);
  }
  function renderFlashcard(guide) {
    const list=guide.analysis.flashcards;
    if (!list.length) { $('tab-flashcards').innerHTML='<p class="muted">No flashcards were found in this source.</p>';return; }
    const card=list[flashIndex];
    $('tab-flashcards').innerHTML=`<div class="flashcard-wrap"><div class="flashcard" id="flashcard" tabindex="0" role="button" aria-label="Reveal flashcard answer"><small>${flashRevealed?'ANSWER':'QUESTION'} · ${flashIndex+1} / ${list.length}</small><h3>${safe(flashRevealed?card.answer:card.question)}</h3><p>${flashRevealed?'Click the card to see the question':'Tap the card to reveal the answer'}</p></div><div class="flashcard-actions"><button class="button button-quiet" id="flash-prev">← Previous</button><button class="button button-primary" id="flash-next">Next card →</button></div></div>`;
    $('flashcard').onclick=()=>{flashRevealed=!flashRevealed;renderFlashcard(guide)};
    $('flashcard').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flashRevealed=!flashRevealed;renderFlashcard(guide)}};
    $('flash-prev').onclick=()=>{flashIndex=(flashIndex-1+list.length)%list.length;flashRevealed=false;renderFlashcard(guide)};
    $('flash-next').onclick=()=>{flashIndex=(flashIndex+1)%list.length;flashRevealed=false;renderFlashcard(guide)};
  }
  function downloadNotes(guide) {
    const content=`${guide.title}\n\nSUMMARY\n${guide.analysis.notes.slice(0,3).join(' ')}\n\nKEY IDEAS\n${guide.analysis.notes.map(s=>'• '+s).join('\n')}\n\nFLASHCARDS\n${guide.analysis.flashcards.map(f=>'Q: '+f.question+'\nA: '+f.answer).join('\n\n')}`;
    const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=guide.title.replace(/[^a-z0-9-_]+/gi,'-')+'-study-notes.txt';link.click();URL.revokeObjectURL(url);
  }
  function findPassage(question, guide) {
    const words=(question.toLowerCase().match(/[a-z][a-z'-]{2,}/g)||[]).filter(w=>!STOP.has(w));
    const ranked=guide.analysis.sentences.map(sentence=>({sentence,score:words.reduce((sum,w)=>sum+(sentence.toLowerCase().includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score);
    return ranked[0]?.score ? ranked[0].sentence : '';
  }
  function startQuiz(id) {
    const guide=guideById(id); if(!guide) return;
    quizState={guideId:id,questions:shuffle(guide.analysis.quiz),answers:{},index:0,started:Date.now()};
    $('quiz-running').hidden=false;$('quiz-results').hidden=true;$('quiz-modal').classList.add('show');$('quiz-modal').setAttribute('aria-hidden','false');
    renderQuestion();
  }
  function renderQuestion() {
    const {questions,answers,index}=quizState, q=questions[index];
    $('quiz-counter').textContent=`Question ${index+1} of ${questions.length}`;
    $('quiz-topic').textContent=q.topic;
    $('quiz-question').textContent=q.prompt;
    $('quiz-progress-fill').style.width=`${((index+1)/questions.length)*100}%`;
    $('quiz-options').innerHTML=q.options.map((option,i)=>`<button class="quiz-option ${answers[q.id]===option?'selected':''}" data-answer-index="${i}"><span class="option-marker">${String.fromCharCode(65+i)}</span>${safe(option)}</button>`).join('');
    $('quiz-options').querySelectorAll('[data-answer-index]').forEach(button=>button.onclick=()=>{answers[q.id]=q.options[Number(button.dataset.answerIndex)];renderQuestion()});
    $('quiz-prev').disabled=index===0;
    $('quiz-next').hidden=index===questions.length-1;
    $('quiz-submit').hidden=index!==questions.length-1;
  }
  function submitQuiz() {
    const guide=guideById(quizState.guideId), questions=quizState.questions;
    const results=questions.map(q=>({id:q.id,topic:q.topic,prompt:q.prompt,selected:quizState.answers[q.id]||null,answer:q.answer,correct:quizState.answers[q.id]===q.answer,explanation:q.explanation}));
    const correct=results.filter(r=>r.correct).length;
    const byTopic={};results.forEach(r=>{const row=byTopic[r.topic]||(byTopic[r.topic]={correct:0,total:0});row.total++;if(r.correct)row.correct++});
    const attempt={id:uid(),guideId:guide.id,guideTitle:guide.title,createdAt:new Date().toISOString(),correct,total:results.length,percent:Math.round(100*correct/results.length),seconds:Math.round((Date.now()-quizState.started)/1000),results,topics:Object.entries(byTopic).map(([topic,v])=>({topic,...v,percent:Math.round(100*v.correct/v.total)}))};
    store.attempts.push(attempt);persist();renderResults(attempt);renderHome();
  }
  function renderResults(attempt) {
    $('quiz-running').hidden=true;$('quiz-results').hidden=false;
    const weak=attempt.topics.filter(t=>t.percent<70).map(t=>t.topic), strong=attempt.topics.filter(t=>t.percent>=70).map(t=>t.topic);
    const tone=attempt.percent>=80?'Nice work — you’ve got a strong start.':attempt.percent>=50?'You’re building understanding. A quick review can help.':'This is useful information. Revisit the notes and try again when you’re ready.';
    $('quiz-results').innerHTML=`<div class="eyebrow">PRACTICE REVIEW</div><div class="result-ring" style="--score:${attempt.percent*3.6}deg"><strong>${attempt.percent}%</strong></div><h2>${safe(tone)}</h2><p>You got ${attempt.correct} of ${attempt.total} questions right · ${Math.floor(attempt.seconds/60)}m ${attempt.seconds%60}s</p><div class="result-breakdown">${attempt.results.map((r,i)=>`<div class="result-item"><strong>${i+1}. ${safe(r.topic)} ${r.correct?'✓':'·'}</strong><p>${safe(r.prompt)}</p><p class="${r.correct?'right':'wrong'}">Your answer: ${safe(r.selected||'Skipped')}<br>Correct answer: <span class="right">${safe(r.answer)}</span></p>${!r.correct?`<p class="wrong">Compare your choice with the source phrase below to see what differed.</p>`:''}<p>${safe(r.explanation)}</p></div>`).join('')}<h3 style="font:700 13px Manrope;margin:18px 0 8px">Topics to revisit</h3><div>${weak.length?weak.map(t=>`<span class="badge">${safe(t)}</span>`).join(' '):'<span class="right">No weak topics from this attempt — nice.</span>'}</div>${strong.length?`<p class="right">Going well: ${strong.map(safe).join(', ')}</p>`:''}</div><div class="result-actions"><button class="button button-quiet" data-action="close-quiz">Back to study guide</button><button class="button button-primary" id="retry-quiz">Try again <span>↻</span></button></div>`;
    $('retry-quiz').onclick=()=>startQuiz(attempt.guideId);
  }
  function closeQuiz() { $('quiz-modal').classList.remove('show');$('quiz-modal').setAttribute('aria-hidden','true');quizState=null; }
  function renderProgress() {
    const content=$('progress-content');
    if(!store.attempts.length){content.innerHTML=emptyState('Your progress starts with practice','After your first quiz, you’ll see your scores and topics to revisit here.','new-study');return;}
    const avg=Math.round(store.attempts.reduce((n,a)=>n+a.percent,0)/store.attempts.length);
    const perTopic={};store.attempts.forEach(a=>a.topics.forEach(t=>{const row=perTopic[t.topic]||(perTopic[t.topic]={correct:0,total:0});row.correct+=t.correct;row.total+=t.total}));
    content.innerHTML=`<div class="progress-cards"><div class="progress-stat"><strong>${store.attempts.length}</strong><span>quizzes completed</span></div><div class="progress-stat"><strong>${avg}%</strong><span>average score</span></div><div class="progress-stat"><strong>${store.guides.length}</strong><span>study guides made</span></div></div><div class="progress-section"><h3>How topics are feeling</h3>${Object.entries(perTopic).map(([topic,v])=>{const pct=Math.round(100*v.correct/v.total);return `<div class="score-row"><span>${safe(topic)}</span><div class="score-track"><div class="score-fill" style="width:${pct}%"></div></div><span>${pct}%</span></div>`}).join('')}</div><div class="progress-section"><h3>Recent quiz sessions</h3>${[...store.attempts].reverse().slice(0,8).map(a=>`<div class="score-row"><span>${safe(a.guideTitle)}</span><div class="score-track"><div class="score-fill" style="width:${a.percent}%"></div></div><span>${a.percent}%</span></div>`).join('')}</div>`;
  }
  function removeGuide(id) {
    const guide=guideById(id);if(!guide)return;
    if(!confirm(`Delete “${guide.title}” and its quiz history from this browser?`))return;
    store.guides=store.guides.filter(g=>g.id!==id);store.attempts=store.attempts.filter(a=>a.guideId!==id);persist();
    if(activeGuideId===id){activeGuideId=null;showStudyEntry()}
    renderHome();renderLibrary($('library-search').value);
  }
  function setupEvents() {
    $('brand-home').addEventListener('click',e=>{e.preventDefault();openPage('home')});
    document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>openPage(button.dataset.page)));
    $('recent-guides').addEventListener('click',handleGuideClick);$('all-guides').addEventListener('click',handleGuideClick);
    function handleGuideClick(e){const open=e.target.closest('[data-open-guide]');const remove=e.target.closest('[data-delete-guide]');if(open)openGuide(open.dataset.openGuide);if(remove){e.stopPropagation();removeGuide(remove.dataset.deleteGuide)}}
    $('library-search').addEventListener('input',e=>renderLibrary(e.target.value));
    $('mobile-menu').onclick=()=>$('sidebar').classList.toggle('open');
    $('theme-toggle').onclick=()=>{store.theme=store.theme==='dark'?'light':'dark';document.body.classList.toggle('dark',store.theme==='dark');persist()};
    $('clear-data').onclick=()=>{if(confirm('Clear all study guides, quiz history, and settings saved in this browser?')){localStorage.removeItem(STORAGE_KEY);store={guides:[],attempts:[],theme:'light'};activeGuideId=null;showStudyEntry();renderHome();renderLibrary();renderProgress();toast('Your local study space has been cleared.')}};
    $('material-text').addEventListener('input',e=>$('char-count').textContent=`${e.target.value.length.toLocaleString()} characters`);
    $('material-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024){$('form-error').textContent='Please use a document smaller than 10 MB.';e.target.value='';return}try{$('file-name').textContent=`Reading ${file.name}…`;$('form-error').textContent='';const text=cleanSource(await extractDocument(file),false);$('material-text').value=text;$('char-count').textContent=`${text.length.toLocaleString()} characters`;$('file-name').textContent=`Loaded ${file.name}`;if(!$('material-title').value)$('material-title').value=file.name.replace(/\.[^.]+$/,'')}catch(error){$('file-name').textContent='';$('form-error').textContent=error.message||'That file could not be read. Paste your material instead.'}});
    $('create-guide').onclick=async()=>{const button=$('create-guide');let source=cleanSource($('material-text').value,false);let title=$('material-title').value.trim()||'My study guide';let sourceName=$('material-file').files[0]?.name||'Pasted notes';let sourceUrl='';$('form-error').textContent='';if(source.length<50){if(!$('material-title').value.trim()){$('form-error').textContent='Enter a topic, or add at least 50 characters of study material.';return}button.disabled=true;button.textContent='Finding a background source…';try{const found=await fetchTopicSource($('material-title').value.trim());title=found.title;source=found.text;sourceName='Wikipedia background article';sourceUrl=found.url}catch(error){$('form-error').textContent=error.message||'Could not retrieve a background source. Please paste study material instead.';button.disabled=false;button.innerHTML='Build my study guide <span>→</span>';return}button.disabled=false;button.innerHTML='Build my study guide <span>→</span>'}if(source.length>100000){$('form-error').textContent='Please keep source material below 100,000 characters so it fits in browser storage.';return}const file=$('material-file').files[0];const guide={id:uid(),title,source,sourceName:file?file.name:sourceName,sourceUrl,createdAt:new Date().toISOString()};guide.analysis=buildGuide(title,source);store.guides.unshift(guide);if(persist()){openGuide(guide.id);toast('Your source-based study guide is ready.')}};
    $('back-to-library').onclick=()=>openPage('library');
    document.querySelectorAll('.study-tab').forEach(tab=>tab.onclick=()=>{document.querySelectorAll('.study-tab').forEach(t=>t.classList.toggle('active',t===tab));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+tab.dataset.tab))});
    $('quiz-prev').onclick=()=>{if(quizState.index>0){quizState.index--;renderQuestion()}};
    $('quiz-next').onclick=()=>{if(quizState.index<quizState.questions.length-1){quizState.index++;renderQuestion()}};
    $('quiz-submit').onclick=submitQuiz;
    $('quiz-modal').addEventListener('click',e=>{if(e.target===$('quiz-modal'))closeQuiz()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&quizState)closeQuiz()});
    document.body.addEventListener('click',e=>{const start=e.target.closest('[data-action="new-study"]');if(start){showStudyEntry();openPage('study')}if(e.target.closest('[data-action="close-quiz"]'))closeQuiz()});
    document.body.addEventListener('submit',e=>{if(e.target.id==='chat-form'){e.preventDefault();const input=$('chat-input');const question=input.value.trim();if(!question)return;const guide=currentGuide();const messages=$('chat-messages');messages.insertAdjacentHTML('beforeend',`<div class="chat-msg user">${safe(question)}</div>`);const passage=findPassage(question,guide);messages.insertAdjacentHTML('beforeend',`<div class="chat-msg bot">${passage?'I found this related passage in your source: “'+safe(passage)+'”':'I couldn’t find a close match. Try a key term from your notes. I only search your supplied text.'}</div>`);input.value='';messages.scrollTop=messages.scrollHeight;}});
  }
  $('today-label').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  document.body.classList.toggle('dark',store.theme==='dark');setupEvents();renderHome();
})();
