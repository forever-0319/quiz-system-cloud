const App = (() => {
  let state = {
    bank: null,
    match: null,
    progress: null,
    timer: null,
    currentModule: null,
    currentQuestion: null,
    currentValue: null,
    playerKey: null
  };

  function $(s){ return document.querySelector(s); }
  function $$(s){ return document.querySelectorAll(s); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function fmtBJ(ts){
    if(!ts) return '-';
    const d = new Date(ts);
    if(isNaN(d.getTime())) return '-';
    const utcMs = d.getTime();
    const bjMs = utcMs + 8 * 60 * 60 * 1000;
    const bj = new Date(bjMs);
    const Y = bj.getUTCFullYear();
    const M = pad(bj.getUTCMonth()+1);
    const D = pad(bj.getUTCDate());
    const h = pad(bj.getUTCHours());
    const m = pad(bj.getUTCMinutes());
    const s = pad(bj.getUTCSeconds());
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
  }

  function showView(name){
    $$('.view').forEach(v => v.classList.remove('active'));
    const t = document.getElementById('view-' + name);
    if(t) t.classList.add('active');
    window.scrollTo(0,0);
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function showToast(msg, type){
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);'+
      'background:'+(type==='err'?'#dc2626':type==='ok'?'#16a34a':'#2563eb')+
      ';color:#fff;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;'+
      'box-shadow:0 4px 12px rgba(0,0,0,.15)';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2500);
  }

  function pad(n){ return String(n).padStart(2,'0'); }

  function refreshUserInfo(){
    const u = Storage.getPlayer();
    const el = $('#userInfo');
    const out = $('#logoutBtn');
    if(u){
      el.textContent = `👤 ${u.name} | 房间 ${u.roomId}`;
      if(out) out.classList.remove('hidden');
    } else {
      el.textContent = '';
      if(out) out.classList.add('hidden');
    }
  }

  function fmtBJFull(ts){
    if(!ts) return '-';
    const d = new Date(ts);
    if(isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function logout(){
    if(!confirm('确定退出登录？\n当前答题进度将被清除')) return;
    if(state.timer){ clearInterval(state.timer); state.timer = null; }
    Storage.clearPlayer();
    Storage.clearProgress(state.playerKey);
    Storage.clearResult ? null : null;
    localStorage.removeItem('exam_result_' + state.playerKey);
    state.progress = null;
    state.bank = null;
    state.match = null;
    state.playerKey = null;
    $('#timer').classList.add('hidden');
    refreshUserInfo();
    showView('home');
    showToast('已退出', 'ok');
  }

  function startTimer(expiresAt){
    if(state.timer) clearInterval(state.timer);
    const warnedAt = { 30:false, 10:false, 5:false, 1:false };
    state.timer = setInterval(() => {
      const left = expiresAt - Date.now();
      const t = $('#timer');
      t.classList.remove('hidden');
      if(left <= 0){
        clearInterval(state.timer);
        t.textContent = '⏱ 已超时';
        t.classList.add('warn');
        if(state.progress && !state.progress.finished){
          alert('⏰ 时间到，自动交卷');
          finishExam();
        }
        return;
      }
      const h = Math.floor(left/3600000);
      const m = Math.floor((left%3600000)/60000);
      const s = Math.floor((left%60000)/1000);
      t.textContent = `⏱ ${pad(h)}:${pad(m)}:${pad(s)}`;
      t.classList.toggle('warn', left < 60000);
      const leftMin = Math.ceil(left / 60000);
      [30, 10, 5, 1].forEach(threshold => {
        if(leftMin === threshold && !warnedAt[threshold]){
          warnedAt[threshold] = true;
          showToast(`⏰ 还剩 ${threshold} 分钟！`, threshold <= 5 ? 'err' : 'ok');
        }
      });
    }, 500);
  }

  function renderDashboard(){
    if(!state.bank){
      const fb = $('#dashboardFallback');
      fb.classList.remove('hidden');
      fb.textContent = '⚠️ 题库未加载';
      showView('dashboard');
      return;
    }
    $('#dashboardFallback').classList.add('hidden');
    const total = TriggerEngine.getTotalStats(state.progress, state.bank);
    $('#totalUnlocked').textContent = total.unlocked;
    $('#totalAnswered').textContent = total.answered;
    const grid = $('#moduleGrid');
    grid.innerHTML = state.bank.modules.map(m => {
      const isUnlocked = state.progress.unlockedModules.includes(m.id);
      const stats = TriggerEngine.getModuleStats(state.progress, state.bank, m.id);
      return `
        <div class="module-card ${isUnlocked?'':'locked'}" data-module="${m.id}">
          <div class="module-icon">${m.icon}</div>
          <div class="module-name">${escapeHtml(m.name)}</div>
          ${isUnlocked
            ? `<div class="module-progress">已答 <b>${stats.answered}</b> / <b>${stats.unlocked}</b> 题</div>
               <span class="module-status">已解锁</span>`
            : `<div class="module-progress">未解锁</div>
               <span class="module-status locked">🔒 锁定</span>`
          }
        </div>`;
    }).join('');
    grid.querySelectorAll('.module-card').forEach(c => {
      c.addEventListener('click', () => {
        if(c.classList.contains('locked')){
          showToast('该模块尚未解锁', 'err');
          return;
        }
        openModule(c.dataset.module);
      });
    });
    showView('dashboard');
  }

  function openModule(moduleId){
    state.currentModule = moduleId;
    const m = state.bank.modules.find(mm => mm.id === moduleId);
    $('#moduleTitle').textContent = m.icon + ' ' + m.name;
    const allQs = TriggerEngine.getQuestionsByModule(state.bank, moduleId);
    const unlockedQs = allQs.filter(q => state.progress.unlockedQuestions.includes(q.id));
    state.unlockedQuestions = unlockedQs.map(q => q.id);
    const totalAll = allQs.length;
    const unlockedCount = unlockedQs.length;
    const answeredCount = unlockedQs.filter(q => {
      const a = state.progress.answers[q.id];
      return a && (a.state === 'draft' || a.state === 'submitted');
    }).length;
    $('#modUnlocked').textContent = unlockedCount;
    $('#modAnswered').textContent = answeredCount;
    const list = $('#questionList');
    if(!unlockedQs.length){
      list.innerHTML = `<div class="muted" style="text-align:center;padding:30px">
        <div style="font-size:32px;margin-bottom:10px">🔒</div>
        <div>该模块暂未解锁任何题目</div>
        <div class="small mt-10">本模块共 ${totalAll} 道题，正在等待触发条件</div>
      </div>`;
    } else {
      list.innerHTML = unlockedQs.map((q,i) => {
        const ans = state.progress.answers[q.id];
        let stateClass = '';
        let stateText = '○ 未作答';
        let numClass = '';
        if(ans?.state === 'submitted'){
          stateClass = 'submitted';
          stateText = '✓ 已提交';
          numClass = 'submitted';
        } else if(ans?.state === 'draft'){
          stateClass = '';
          stateText = '◐ 草稿';
        }
        return `
          <div class="qitem ${stateClass}" data-qid="${q.id}" data-index="${i}">
            <div class="qitem-head">
              <span class="qitem-num ${numClass}">${i+1}</span>
              <span class="qitem-stem">${escapeHtml(q.stem.slice(0,50))}${q.stem.length>50?'...':''}</span>
              <span class="qitem-state">${stateText}</span>
            </div>
          </div>`;
      }).join('');
      list.querySelectorAll('.qitem').forEach(item => {
        item.addEventListener('click', () => {
          openQuestion(item.dataset.qid);
        });
      });
    }
    showView('module');
  }

  function openQuestion(qid){
    state.currentQuestion = qid;
    if(!state.unlockedQuestions || !state.unlockedQuestions.includes(qid)){
      state.unlockedQuestions = state.progress.unlockedQuestions.slice();
    }
    const q = TriggerEngine.getQuestion(state.bank, qid);

    $('#quizType').textContent = q.type === 'single' ? '单选' : q.type === 'multi' ? '多选' : '填空';
    $('#quizType').className = 'qtype ' + (q.type === 'multi' ? 'multi' : q.type === 'fill' ? 'fill' : '');
    $('#quizId').textContent = qid;
    $('#quizStem').textContent = q.stem;

    if(q.image){
      $('#quizImage').classList.remove('hidden');
      $('#quizImage').innerHTML = `<img src="images/${q.image}" alt="${escapeHtml(q.image)}" onerror="this.parentElement.classList.add('hidden')">`;
    } else {
      $('#quizImage').classList.add('hidden');
    }

    const opts = $('#quizOptions');
    const fill = $('#quizFill');
    opts.innerHTML = '';
    fill.classList.add('hidden');

    const prev = state.progress.answers[qid];
    const isMulti = q.type === 'multi';

    if(q.type === 'fill'){
      fill.classList.remove('hidden');
      fill.innerHTML = '<input type="text" id="fillInput" class="fill-input-el" placeholder="请输入答案" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">';
      const fillInputEl = $('#fillInput');
      fillInputEl.value = prev?.value || '';
      state.currentValue = prev?.value || '';
      fillInputEl.addEventListener('input', e => { state.currentValue = e.target.value; });
      fillInputEl.addEventListener('focus', () => fillInputEl.select());
    } else {
      q.options.forEach((text, i) => {
        const L = String.fromCharCode(65+i);
        const div = document.createElement('label');
        div.className = 'opt';
        div.innerHTML = `
          <input type="${isMulti?'checkbox':'radio'}" name="opt" value="${L}">
          <span class="opt-letter">${L}.</span>
          <span class="opt-text">${escapeHtml(text)}</span>`;
        div.querySelector('input').addEventListener('change', onOptionChange);
        div.addEventListener('click', e => {
          if(e.target.tagName !== 'INPUT'){
            const inp = div.querySelector('input');
            inp.checked = !inp.checked;
            onOptionChange();
          }
        });
        opts.appendChild(div);
      });
      if(prev?.value){
        const vals = Array.isArray(prev.value) ? prev.value : [prev.value];
        vals.forEach(L => {
          const inp = opts.querySelector(`input[value="${L}"]`);
          if(inp){ inp.checked = true; inp.closest('.opt').classList.add('selected'); }
        });
        state.currentValue = vals;
      } else {
        state.currentValue = [];
      }
    }

    const status = $('#quizStatus');
    const submitted = prev?.state === 'submitted';
    if(submitted){
      status.innerHTML = '<b style="color:#f59e0b">已提交</b> · 题目已锁定，全局完成后判分';
      $$('#quizOptions input, #fillInput').forEach(el => { el.disabled = true; });
      $$('#quizOptions .opt').forEach(d => d.classList.add('disabled'));
      $('#quizSave').classList.add('hidden');
      $('#quizSubmit').classList.add('hidden');
    } else if(prev?.state === 'draft'){
      status.innerHTML = '<span style="color:#3b82f6">草稿状态</span> · 可继续修改';
      $('#quizSave').classList.remove('hidden');
      $('#quizSubmit').classList.remove('hidden');
    } else {
      status.textContent = '';
      $('#quizSave').classList.remove('hidden');
      $('#quizSubmit').classList.remove('hidden');
    }

    showView('quiz');
  }

  function onOptionChange(){
    const checked = Array.from($$('#quizOptions input:checked')).map(i => i.value);
    $$('#quizOptions .opt').forEach(d => {
      d.classList.toggle('selected', d.querySelector('input').checked);
    });
    state.currentValue = checked;
  }

  function isOnline(){ return window.Cloud && window.Cloud.isConnected(); }

  async function syncProgressToCloud(){
    if(!isOnline() || !state.match || !state.match.id) return;
    try {
      await window.Cloud.upsertProgress(
        state.match.id,
        state.player.name,
        state.player.inviteCode,
        state.progress
      );
      if(state.currentQuestion && state.progress.answers[state.currentQuestion]){
        await window.Cloud.upsertAnswer(
          state.match.id,
          state.player.name,
          state.player.inviteCode,
          state.currentQuestion,
          state.progress.answers[state.currentQuestion]
        );
      }
    } catch(err){ console.warn('云端同步失败:', err); }
  }

  async function saveDraft(){
    if(!state.currentQuestion) return;
    const val = state.currentValue;
    const empty = !val || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && !val.trim());
    if(empty){ showToast('请先选择或输入答案', 'err'); return; }
    TriggerEngine.onAnswer(state.progress, state.bank, state.currentQuestion, val, false);
    Storage.saveProgress(state.playerKey, state.progress);
    Realtime.emit('player:progress', {
      name: state.player?.name,
      key: state.playerKey,
      progress: state.progress
    });
    syncProgressToCloud();
    showToast('💾 已保存草稿' + (isOnline()?'（已同步云端）':''), 'ok');
    if(state.currentModule) openModule(state.currentModule);
  }

  async function submitAnswer(){
    if(!state.currentQuestion) return;
    const val = state.currentValue;
    const empty = !val || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && !val.trim());
    if(empty){ showToast('请先选择或输入答案', 'err'); return; }
    const result = TriggerEngine.onAnswer(state.progress, state.bank, state.currentQuestion, val, true);
    Storage.saveProgress(state.playerKey, state.progress);
    Realtime.emit('player:progress', {
      name: state.player?.name,
      key: state.playerKey,
      progress: state.progress,
      isCorrect: result.isCorrect,
      qid: state.currentQuestion,
      unlocked: result
    });
    syncProgressToCloud();

    if(result.unlockedModules.length || result.unlockedQuestions.length){
      const msg = [];
      if(result.unlockedModules.length) msg.push('🔓 解锁模块：' + result.unlockedModules.join('、'));
      if(result.unlockedQuestions.length) msg.push('🔓 解锁题目：' + result.unlockedQuestions.length + ' 道');
      showToast(msg.join(' | '), 'ok');
    } else {
      showToast('✅ 已提交' + (isOnline()?'（云端）':''), 'ok');
    }

    setTimeout(() => {
      if(state.currentModule) openModule(state.currentModule);
    }, 800);
  }

  async function finishExam(){
    if(!confirm('确认完成答题？完成后将统一判分，不可再修改')) return;
    const result = TriggerEngine.finishExam(state.progress, state.bank);
    Storage.saveResult(state.playerKey, result);
    Storage.saveProgress(state.playerKey, state.progress);
    Realtime.emit('player:finish', {
      name: state.player?.name,
      key: state.playerKey,
      result
    });
    if(state.timer) clearInterval(state.timer);
    if(isOnline() && state.match && state.match.id){
      try {
        await window.Cloud.upsertResult(state.match.id, state.player.name, state.player.inviteCode, result);
      } catch(err){ console.warn('云端判分结果上传失败:', err); }
    }
    renderResult();
  }

  function updateArchiveOnFinish(result){
    const m = Storage.getMatch();
    if(!m) return;
    const existing = Storage.getArchive(m.roomId);
    const baseArchive = existing || (() => {
      const r = {
        matchId: m.roomId,
        bankSummary: m.bankSnapshot ? {
          modules: m.bankSnapshot.modules.length,
          questions: m.bankSnapshot.questions.length,
          moduleNames: m.bankSnapshot.modules.map(mm => mm.name)
        } : null,
        totalMinutes: m.totalMinutes,
        codeCount: m.codes.length,
        usedCount: m.codes.filter(c => c.used).length,
        completedCount: 0,
        totalCount: 0,
        avgScore: 0,
        maxScore: 0,
        createdAt: m.createdAt,
        startedAt: m.startedAt,
        finishedAt: null,
        finalStatus: 'running',
        match: m,
        results: {}
      };
      return r;
    })();
    const player = Storage.getPlayer();
    baseArchive.results = baseArchive.results || {};
    baseArchive.results[Storage.getPlayer()?.inviteCode] = {
      playerName: player?.name,
      score: result.score,
      total: result.total,
      correctCount: result.correctCount,
      wrongCount: result.wrongCount,
      duration: result.duration
    };
    const resultsArr = Object.values(baseArchive.results);
    baseArchive.completedCount = resultsArr.length;
    baseArchive.totalCount = m.codes.filter(c => c.used).length;
    baseArchive.avgScore = resultsArr.length ? Math.round(resultsArr.reduce((s,r)=>s+r.score,0) / resultsArr.length) : 0;
    baseArchive.maxScore = resultsArr.length ? Math.max(...resultsArr.map(r => r.score)) : 0;

    if(existing){
      Storage.updateArchive(m.roomId, () => baseArchive);
    } else {
      Storage.addArchive(baseArchive);
    }
    if(Judge && Judge.refreshArchiveList) Judge.refreshArchiveList();
  }

  function renderResult(){
    const r = Storage.getResult(state.playerKey);
    if(!r) return;
    const correctRate = r.total > 0 ? Math.round(r.correctCount * 100 / r.total) : 0;
    $('#resultSummary').innerHTML = `
      <div class="result-stat score"><b>${r.score}</b><span class="label">得分</span></div>
      <div class="result-stat"><b>${r.correctCount}</b><span class="label">正确</span></div>
      <div class="result-stat"><b>${r.wrongCount}</b><span class="label">错误</span></div>
      <div class="result-stat"><b>${r.total}</b><span class="label">已作答</span></div>
      <div class="result-stat"><b>${Math.round(r.duration/60)}</b><span class="label">用时（分）</span></div>
    `;
    $('#resultDetail').innerHTML = r.detail.map((d,i) => {
      const cls = d.isCorrect ? 'correct' : 'wrong';
      const sym = d.isCorrect ? '✓' : '✗';
      const correctStr = Array.isArray(d.correctAnswer)
        ? d.correctAnswer.join(' / ')
        : d.correctAnswer || '-';
      const myStr = Array.isArray(d.myAnswer)
        ? d.myAnswer.join('、') || '(空)'
        : d.myAnswer || '(空)';
      return `
        <div class="qdetail">
          <div class="qdetail-head">
            <b>${i+1}. [${d.q.type==='single'?'单选':d.q.type==='multi'?'多选':'填空'}] ${d.q.id}</b>
            <span class="${cls}" style="font-weight:600">${sym} ${d.isCorrect?'正确':'错误'}</span>
          </div>
          <div class="qdetail-stem">${escapeHtml(d.q.stem)}</div>
          <div class="qdetail-line ${cls}"><span class="label">你的答案：</span>${escapeHtml(myStr)}</div>
          <div class="qdetail-line answer"><span class="label">正确答案：</span>${escapeHtml(correctStr)}</div>
          ${d.q.explanation ? `<div class="qdetail-line"><span class="label">解析：</span>${escapeHtml(d.q.explanation)}</div>` : ''}
        </div>`;
    }).join('');
    showView('result');
  }

  function renderWrongList(){
    const r = Storage.getResult(state.playerKey);
    if(!r){ $('#wrongList').textContent = '暂无错题数据'; return; }
    const wrongs = r.detail.filter(d => !d.isCorrect);
    $('#wrongCount').textContent = wrongs.length;
    if(!wrongs.length){
      $('#wrongList').innerHTML = '<span class="muted">🎉 全部正确，没有错题</span>';
      return;
    }
    $('#wrongList').innerHTML = wrongs.map((d,i) => {
      const correctStr = Array.isArray(d.correctAnswer)
        ? d.correctAnswer.join(' / ')
        : d.correctAnswer || '-';
      const myStr = Array.isArray(d.myAnswer)
        ? d.myAnswer.join('、') || '(空)'
        : d.myAnswer || '(空)';
      return `
        <div class="qdetail">
          <div class="qdetail-head"><b>${i+1}. ${d.q.id}</b><span class="wrong">✗</span></div>
          <div class="qdetail-stem">${escapeHtml(d.q.stem)}</div>
          <div class="qdetail-line wrong"><span class="label">你的答案：</span>${escapeHtml(myStr)}</div>
          <div class="qdetail-line answer"><span class="label">正确答案：</span>${escapeHtml(correctStr)}</div>
          ${d.q.explanation ? `<div class="qdetail-line"><span class="label">解析：</span>${escapeHtml(d.q.explanation)}</div>` : ''}
        </div>`;
    }).join('');
  }

  async function tryRestoreSession(){
    const player = Storage.getPlayer();
    let match = Storage.getMatch();
    refreshUserInfo();
    if(!player){
      showView('home');
      return;
    }

    if(isOnline()){
      try {
        const dbMatch = await window.Cloud.getMatchByRoom(player.roomId);
        if(dbMatch){
          match = {
            id: dbMatch.id,
            roomId: dbMatch.room_id,
            totalMinutes: dbMatch.total_minutes,
            status: dbMatch.status,
            startedAt: dbMatch.started_at ? new Date(dbMatch.started_at).getTime() : null,
            expiresAt: dbMatch.expires_at ? new Date(dbMatch.expires_at).getTime() : null,
            finishedAt: dbMatch.finished_at ? new Date(dbMatch.finished_at).getTime() : null,
            createdAt: new Date(dbMatch.created_at).getTime(),
            encryptedBank: match ? match.encryptedBank : null
          };
          Storage.saveMatch(match);
        }
      } catch(err){ console.warn('云端比赛拉取失败:', err); }
    }

    if(!match){
      showView('home');
      return;
    }

    state.player = player;
    state.playerKey = player.roomId + '_' + player.inviteCode;
    state.match = match;

    if(match.encryptedBank && match.encryptedBank.bankId && (isOnline())){
      try {
        const cloudBank = await window.Cloud.getBank(match.encryptedBank.bankId);
        if(cloudBank && cloudBank.encrypted_data){
          const cached = localStorage.getItem('cached_bank_' + match.id);
          if(cached){
            try {
              state.bank = JSON.parse(cached);
            } catch(e){}
          }
          if(!state.bank){
            const bankPwd = prompt('请输入题库密码继续答题：');
            if(bankPwd){
              try {
                state.bank = await Crypto.decrypt(cloudBank.encrypted_data, bankPwd);
                localStorage.setItem('cached_bank_' + match.id, JSON.stringify(state.bank));
              } catch(err){
                console.warn('题库解锁失败:', err);
                Storage.clearPlayer();
                state.match = null;
                showView('home');
                showToast('题库密码错误，请重新登录', 'err');
                return;
              }
            } else {
              Storage.clearPlayer();
              state.match = null;
              showView('home');
              return;
            }
          }
        }
      } catch(err){ console.warn('云端题库拉取失败:', err); }
    }
    if(!state.bank){
      state.bank = Storage.getBank() || match.bankSnapshot;
    }

    let progress = Storage.getProgress(state.playerKey);
    if(!progress && state.bank){
      progress = TriggerEngine.initProgress(state.bank, ['现勘']);
    }

    if(match.status === 'running' && match.expiresAt){
      if(!progress.startedAt){
        progress.startedAt = match.startedAt || Date.now();
        progress.expiresAt = match.expiresAt;
      } else if(!progress.expiresAt){
        progress.expiresAt = match.expiresAt;
      }
    } else if(match.status === 'pending'){
      // Do not start countdown before the judge starts the match.
      progress.startedAt = null;
      progress.expiresAt = null;
    } else {
      if(!progress.startedAt){
        TriggerEngine.startExam(progress, match.totalMinutes);
      }
    }

    Storage.saveProgress(state.playerKey, progress);
    state.progress = progress;

    if(isOnline() && match.id){
      try {
        await window.Cloud.upsertProgress(match.id, player.name, player.inviteCode, progress);
      } catch(err){}
    }

    if(window.Realtime && match.id) window.Realtime.setMatch(match.id);

    if(progress.finished){
      renderResult();
      return;
    }
    if(match.status === 'pending'){
      showWaitingForStart();
      subscribeToMatch(match.id);
      return;
    }
    if(match.status === 'finished'){
      Storage.clearPlayer();
      showView('home');
      showToast('本场比赛已结束', 'err');
      return;
    }
    if(match.status === 'running' && match.expiresAt && match.expiresAt <= Date.now()){
      Storage.clearPlayer();
      Storage.clearProgress(state.playerKey);
      localStorage.removeItem('exam_result_' + state.playerKey);
      showView('home');
      showToast('比赛已超时，请联系裁判', 'err');
      return;
    }
    startTimer(match.expiresAt);
    renderDashboard();
    subscribeToMatch(match.id);
  }

  function showWaitingForStart(){
    const m = Storage.getMatch();
    const p = Storage.getPlayer();
    $('#waitingRoomId').textContent = m.roomId;
    $('#waitingName').textContent = p.name;
    $('#waitingMinutes').textContent = m.totalMinutes;
    showView('waiting');
  }

  function subscribeToMatch(matchId){
    if(!window.Cloud || !window.Cloud.isConnected() || !matchId) return;
    try {
      if(window._currentSub && window._currentSub.id === matchId) return;
      if(window._currentSub && window._currentSub.unsubscribe){
        window._currentSub.unsubscribe();
      }
      window._currentSub = {
        id: matchId,
        unsubscribe: window.Cloud.subscribeMatch(matchId, msg => {
          if(msg.type === 'answer' || msg.type === 'progress' || msg.type === 'result'){
            window.Cloud.getMatch(matchId).then(dbMatch => {
              if(!dbMatch) return;
              const localMatch = Storage.getMatch();
              if(!localMatch) return;
              localMatch.status = dbMatch.status;
              if(dbMatch.expires_at) localMatch.expiresAt = new Date(dbMatch.expires_at).getTime();
              if(dbMatch.started_at) localMatch.startedAt = new Date(dbMatch.started_at).getTime();
              if(dbMatch.finished_at) localMatch.finishedAt = new Date(dbMatch.finished_at).getTime();
              Storage.saveMatch(localMatch);
              if(dbMatch.status === 'pending'){
                showWaitingForStart();
              } else if(dbMatch.status === 'running' && state.progress && !state.progress.finished){
                startTimer(localMatch.expiresAt);
                renderDashboard();
              } else if(dbMatch.status === 'finished' && state.progress && !state.progress.finished){
                finishExam();
              }
            });
          }
        })
      };
    } catch(err){ console.warn('订阅比赛状态失败:', err); }
  }

  function refreshLoginMatchStatus(){
    const box = $('#loginMatchStatus');
    if(!box) return;
    const online = isOnline();

    if(!online){
      const m = Storage.getMatch();
      if(m){
        const usedCount = m.codes.filter(c => c.used).length;
        const totalCount = m.codes.length;
        let status = '';
        let className = 'match-status-box ok-bg';
        if(m.status === 'pending') status = '比赛已生成，等待开始';
        else if(m.status === 'running'){
          const left = Math.max(0, Math.ceil((m.expiresAt - Date.now()) / 60000));
          status = `比赛中，剩余约 ${left} 分钟`;
        } else if(m.status === 'finished'){
          status = '比赛已结束';
          className = 'match-status-box finished-bg';
        }
        box.innerHTML = `
          <div class="match-status ok">
            <b>✅ 已检测到比赛（本地模式）</b>
            <p class="muted small">房间号 <code style="font-weight:600">${m.roomId}</code> · 时长 ${m.totalMinutes} 分钟 · 已用 ${usedCount}/${totalCount} 邀请码</p>
            <p class="muted small">${status}</p>
            <p class="muted small">⚠️ 未连接云端，只能访问此浏览器的本地比赛数据</p>
          </div>`;
        box.className = className;
      } else {
        box.innerHTML = `
          <div class="match-status warn">
            <b>☁️ 云端未连接，本地也无比赛</b>
            <p class="muted small">需要：</p>
            <ol class="muted small">
              <li>等待云端连接成功</li>
              <li>或联系裁判在同浏览器生成比赛</li>
              <li>或使用"📥 导入比赛包"</li>
            </ol>
          </div>`;
        box.className = 'match-status-box warn-bg';
      }
    } else {
      box.innerHTML = `
        <div class="match-status ok">
          <b>☁️ 云端已连接</b>
          <p class="muted small">任何设备的浏览器都可以访问此系统的数据</p>
          <p class="muted small">只需向裁判索取：<b>房间号 + 邀请码 + 题库密码</b></p>
        </div>`;
      box.className = 'match-status-box ok-bg';
    }
  }

  async function importMatchPackage(file){
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      if(!pkg.__type || pkg.__type !== 'exam_match_v2'){
        throw new Error('不是有效的比赛包文件');
      }
      if(!pkg.match || !pkg.match.roomId){
        throw new Error('比赛包数据损坏');
      }
      const m = pkg.match;
      Storage.saveMatch(m);
      if(pkg.bank) Storage.saveBank(pkg.bank);
      showToast('✅ 比赛包导入成功', 'ok');
      refreshLoginMatchStatus();
    } catch(err){
      showToast('❌ ' + err.message, 'err');
    }
  }

  function init(){
    Realtime.init();
    if(window.Cloud){
      window.Cloud.init().then(() => {
        console.log('Cloud ready');
      });
    }

    Realtime.on('judge:action', (data) => {
      if(!state.playerKey) return;
      if(data.type === 'forceSubmit' || data.type === 'forceSubmitAll'){
        if(state.playerKey === data.key || data.type === 'forceSubmitAll'){
          if(!state.progress?.finished){
            const m = Storage.getMatch();
            if(m && m.bankSnapshot){
              const result = TriggerEngine.finishExam(state.progress, m.bankSnapshot);
              Storage.saveResult(state.playerKey, result);
              Storage.saveProgress(state.playerKey, state.progress);
              if(state.timer) clearInterval(state.timer);
              showToast('⏹ 裁判强制交卷', 'err');
              renderResult();
            }
          }
        }
      } else if(data.type === 'reset'){
        if(state.playerKey === data.key){
          Storage.clearPlayer();
          Storage.clearProgress(state.playerKey);
          localStorage.removeItem('exam_result_' + state.playerKey);
          if(state.timer) clearInterval(state.timer);
          state.progress = null;
          state.bank = null;
          state.match = null;
          state.playerKey = null;
          $('#timer').classList.add('hidden');
          refreshUserInfo();
          showView('home');
          showToast('裁判已重置你的进度', 'err');
        }
      } else if(data.type === 'unlockAll'){
        if(state.playerKey === data.key && state.bank){
          const m = Storage.getMatch();
          if(m && m.bankSnapshot){
            state.progress.unlockedModules = m.bankSnapshot.modules.map(mm => mm.id);
            state.progress.unlockedQuestions = m.bankSnapshot.questions.map(q => q.id);
            Storage.saveProgress(state.playerKey, state.progress);
            if(state.currentModule){
              renderModule(state.currentModule);
            } else {
              renderDashboard();
            }
            showToast('🔓 裁判已为你解锁全部模块', 'ok');
          }
        }
      }
    });

    Judge.init();

    $$('[data-view]').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.dataset.view;
        if(v === 'home') showView('home');
        else if(v === 'login'){
          showView('login');
          refreshLoginMatchStatus();
        }
      });
    });
    $$('[data-go]').forEach(b => {
      b.addEventListener('click', () => {
        const go = b.dataset.go;
        if(go === 'dashboard') renderDashboard();
      });
    });

    $('#loginSubmit').addEventListener('click', async () => {
      const name = $('#loginName').value.trim();
      const roomId = $('#loginRoom').value.trim().toUpperCase();
      const inviteCode = $('#loginInvite').value.trim().toUpperCase();
      const bankPwd = $('#loginBankPwd').value;
      if(!name){ showToast('请输入姓名', 'err'); return; }
      if(!roomId){ showToast('请输入房间号', 'err'); return; }
      if(!inviteCode){ showToast('请输入邀请码', 'err'); return; }
      if(!bankPwd){ showToast('请输入题库密码', 'err'); return; }

      const status = $('#loginStatus');
      const submitBtn = $('#loginSubmit');
      status.textContent = '☁️ 正在验证（10秒超时）...';
      status.style.color = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '登录中...';

      const cleanup = () => {
        submitBtn.disabled = false;
        submitBtn.textContent = '登录';
      };

      try {
        const v = await window.Cloud && window.Cloud.isConnected()
          ? await Promise.race([
              Match.validateLogin(name, roomId, inviteCode),
              new Promise((_, reject) => setTimeout(() => reject(new Error('验证超时（10秒），请检查网络')), 10000))
            ])
          : await Match.validateLogin(name, roomId, inviteCode);
        if(!v.ok){
          status.textContent = '❌ ' + v.msg;
          status.style.color = 'var(--danger)';
          showToast('❌ ' + v.msg, 'err');
          cleanup();
          return;
        }

        status.textContent = '☁️ 标记邀请码...';
        await Match.useCode(roomId, inviteCode, name);

        let bank = null;
        let match = null;
        let encryptedBank = v.match.encryptedBank;

        if(v.online && v.match.id){
          status.textContent = '☁️ 加载比赛数据...';
          try {
            const dbMatch = await Promise.race([
              window.Cloud.getMatch(v.match.id),
              new Promise((_, reject) => setTimeout(() => reject(new Error('加载比赛超时')), 8000))
            ]);
            match = {
              id: dbMatch.id,
              roomId: dbMatch.room_id,
              totalMinutes: dbMatch.total_minutes,
              status: dbMatch.status,
              startedAt: dbMatch.started_at ? new Date(dbMatch.started_at).getTime() : null,
              expiresAt: dbMatch.expires_at ? new Date(dbMatch.expires_at).getTime() : null,
              finishedAt: dbMatch.finished_at ? new Date(dbMatch.finished_at).getTime() : null,
              createdAt: new Date(dbMatch.created_at).getTime(),
              encryptedBank: encryptedBank
            };
            Storage.saveMatch(match);
          } catch(err){
            console.warn('云端比赛拉取失败:', err);
            status.textContent = '⚠️ ' + err.message + '，使用本地数据';
          }
        }

        if(!match){
          match = v.match;
        }

        if(match.encryptedBank && match.encryptedBank.bankId && (window.Cloud && window.Cloud.isConnected())){
          status.textContent = '☁️ 加载题库...';
          try {
            console.log('[登录] 题库引用:', match.encryptedBank);
            const cloudBank = await Promise.race([
              window.Cloud.getBank(match.encryptedBank.bankId),
              new Promise((_, reject) => setTimeout(() => reject(new Error('加载题库超时')), 8000))
            ]);
            if(cloudBank && cloudBank.encrypted_data){
              const cached = localStorage.getItem('cached_bank_' + match.id);
              if(cached){
                try { bank = JSON.parse(cached); state.bank = bank; }
                catch(e){}
              }
              if(!bank){
                try {
                  bank = await Crypto.decrypt(cloudBank.encrypted_data, bankPwd);
                  localStorage.setItem('cached_bank_' + match.id, JSON.stringify(bank));
                  state.bank = bank;
                  showToast('✅ 题库已解锁', 'ok');
                } catch(err){
                  status.textContent = '❌ 题库密码错误';
                  status.style.color = 'var(--danger)';
                  showToast('❌ 题库密码错误', 'err');
                  Storage.clearPlayer();
                  cleanup();
                  return;
                }
              }
            }
          } catch(err){
            console.warn('云端题库拉取失败:', err);
            status.textContent = '⚠️ ' + err.message;
          }
        }

        if(!match){
          status.textContent = '❌ 找不到比赛数据';
          status.style.color = 'var(--danger)';
          cleanup();
          return;
        }

        if(!match.encryptedBank || !match.encryptedBank.bankId){
          console.warn('[登录] 比赛没有题库引用:', match);
        }

        const player = { name, roomId, inviteCode, loggedAt:Date.now() };
        Storage.savePlayer(player);
        refreshUserInfo();

        state.player = player;
        state.playerKey = roomId + '_' + inviteCode;
        if(!state.bank && match.bankSnapshot){
          state.bank = match.bankSnapshot;
        }
        state.match = match;

        let progress = Storage.getProgress(state.playerKey);
        if(!progress){
          progress = { unlockedModules:[], unlockedQuestions:[], answers:{}, finished:false, startedAt:null, expiresAt:null, submittedCount:0, correctCount:0 };
        }

          if(match.expiresAt <= Date.now()){
            status.textContent = '⚠️ 本场比赛已超时，无法进入';
            status.style.color = 'var(--danger)';
            showToast('本场比赛已超时，请联系裁判', 'err');
            Storage.clearPlayer();
            cleanup();
            return;
          }
          if(!progress.startedAt){
            progress.startedAt = match.startedAt || Date.now();
            progress.expiresAt = match.expiresAt;
          } else if(!progress.expiresAt){
            progress.expiresAt = match.expiresAt;
          }
        } else if(match.status === 'pending'){
          // Pending matches should not start timing on the player side.
          progress.startedAt = null;
          progress.expiresAt = null;
        } else {
          if(!progress.startedAt){
            TriggerEngine.startExam(progress, match.totalMinutes);
          }
        }

        Storage.saveProgress(state.playerKey, progress);
        state.progress = progress;

        if(window.Cloud && window.Cloud.isConnected() && match.id){
          try {
            await window.Cloud.upsertProgress(match.id, name, inviteCode, progress);
          } catch(err){}
        }

        if(window.Realtime && match.id) window.Realtime.setMatch(match.id);

        status.textContent = '';
        cleanup();

        if(progress.finished){
          renderResult();
          return;
        }
        if(match.status === 'pending'){
          showWaitingForStart();
          subscribeToMatch(match.id);
        } else if(match.status === 'finished'){
          showToast('比赛已结束', 'err');
          status.textContent = '⚠️ 本场比赛已结束';
          status.style.color = 'var(--danger)';
          Storage.clearPlayer();
          cleanup();
          return;
        } else {
          renderDashboard();
        }

        cleanup();
      } catch(err){
        console.error('[登录] 错误:', err);
        status.textContent = '❌ ' + (err.message || '登录失败');
        status.style.color = 'var(--danger)';
        showToast('❌ ' + (err.message || '登录失败'), 'err');
        cleanup();
      }
    });

    $('#finishBtn').addEventListener('click', finishExam);

    $('#loginImportMatch').addEventListener('click', () => $('#loginMatchFile').click());
    $('#loginMatchFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if(f){ await importMatchPackage(f); }
      e.target.value = '';
    });

    $$('#loginRoom, #loginInvite').forEach(el => {
      el.addEventListener('input', () => {
        el.value = el.value.toUpperCase();
      });
    });
    $('#backToModule').addEventListener('click', () => {
      if(state.currentModule) openModule(state.currentModule);
    });
    $('#quizSave').addEventListener('click', saveDraft);
    $('#quizSubmit').addEventListener('click', submitAnswer);
    $('#quizPrev').addEventListener('click', () => {
      if(!state.unlockedQuestions) return;
      const idx = state.unlockedQuestions.indexOf(state.currentQuestion);
      if(idx > 0) openQuestion(state.unlockedQuestions[idx-1]);
    });
    $('#quizNext').addEventListener('click', () => {
      if(!state.unlockedQuestions) return;
      const idx = state.unlockedQuestions.indexOf(state.currentQuestion);
      if(idx >= 0 && idx < state.unlockedQuestions.length - 1){
        openQuestion(state.unlockedQuestions[idx+1]);
      } else {
        showToast('已是最后一题', 'ok');
      }
    });
    $('#viewWrongBtn').addEventListener('click', () => {
      renderWrongList();
      showView('wrong');
    });
    $('#logoutBtn').addEventListener('click', logout);

    tryRestoreSession();
  }

  return { init, refreshLoginMatchStatus, updateArchiveOnFinish, openModule, openQuestion, getState: () => state };
})();

document.addEventListener('DOMContentLoaded', App.init);
