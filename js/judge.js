const Judge = (() => {
  let judgeLoggedIn = false;
  let currentMatchId = null;
  let currentBankId = null;
  let realtimeUnsub = null;

  function $(s){ return document.querySelector(s); }
  function $$(s){ return document.querySelectorAll(s); }
  function pad(n){ return String(n).padStart(2,'0'); }

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

  function isOnline(){ return window.Cloud && window.Cloud.isConnected(); }

  function refreshBankStatus(){
    const bank = Storage.getBank();
    const el = $('#jBankStatus');
    if(!bank){
      el.innerHTML = '题库未加载' + (isOnline() ? '（也可从云端导入）' : '');
      el.style.color = '';
    } else {
      el.innerHTML = `✅ 已加载 · <b>${bank.modules.length}</b> 模块 · <b>${bank.questions.length}</b> 题`;
      el.style.color = 'var(--success)';
    }
  }

  async function refreshMatchUI(){
    const m = Storage.getMatch();
    const pending = $('#jMatchPending');
    const created = $('#jMatchCreated');
    const control = $('#jMatchControl');

    if(!m){
      pending.classList.remove('hidden');
      created.classList.add('hidden');
      control.innerHTML = '<div class="muted">尚未生成比赛</div>';
      if(realtimeUnsub){ realtimeUnsub(); realtimeUnsub = null; }
      return;
    }

    pending.classList.add('hidden');
    created.classList.remove('hidden');
    $('#jRoomId').textContent = m.roomId;
    if(window.Realtime) window.Realtime.setMatch(m.id);

    if(isOnline() && m.id){
      try {
        const codes = await window.Cloud.listInviteCodes(m.id);
        if(codes.length){
          m.codes = codes;
          Storage.saveMatch(m);
        }
        if(!realtimeUnsub){
          realtimeUnsub = window.Cloud.subscribeMatch(m.id, msg => {
            refreshPlayerList();
            if(msg.type === 'answer' || msg.type === 'progress'){
              showToast('📨 收到选手答题更新（云端）', 'ok');
            }
          });
        }
      } catch(err){ console.warn('云端拉取失败:', err); }
    }

    $('#jCodeTotal').textContent = m.codes.length;
    $('#jCodeUsed').textContent = m.codes.filter(c => c.used).length;

    const codeList = $('#jCodeList');
    codeList.innerHTML = m.codes.map((c, i) => `
      <div class="code-item ${c.used?'used':''}">
        <span class="code-num">${i+1}.</span>
        <code class="code-text">${c.code}</code>
        <span class="code-status">${c.used ? '✓ ' + escapeHtml(c.playerName||c.player_name||'') : '未使用'}</span>
      </div>
    `).join('');

    if(m.status === 'pending'){
      control.innerHTML = `
        <p class="muted">比赛已生成，房间号和邀请码见上方。</p>
        <button id="jStartMatch" class="btn primary">▶ 开始比赛（启动计时）</button>
        <button id="jDiscardMatch" class="btn ghost">🗑 放弃本次比赛</button>
      `;
      $('#jStartMatch')?.addEventListener('click', startMatch);
      $('#jDiscardMatch')?.addEventListener('click', discardMatch);
    } else if(m.status === 'running'){
      const left = m.expiresAt - Date.now();
      const leftMin = Math.max(0, Math.ceil(left / 60000));
      control.innerHTML = `
        <p>状态：<b style="color:var(--success)">进行中</b> · 剩余约 <b>${leftMin}</b> 分钟</p>
        <button id="jEndMatch" class="btn danger">⏹ 立即结束比赛</button>
      `;
      $('#jEndMatch')?.addEventListener('click', endMatch);
      refreshPlayerList();
    } else if(m.status === 'finished'){
      control.innerHTML = `
        <p>状态：<b>已结束</b></p>
        <button id="jNewMatch" class="btn primary">🔄 创建新比赛</button>
      `;
      $('#jNewMatch')?.addEventListener('click', () => {
        Storage.clearMatch();
        Storage.clearPlayer();
        if(realtimeUnsub){ realtimeUnsub(); realtimeUnsub = null; }
        refreshMatchUI();
      });
      refreshPlayerList();
    }
  }

  async function startMatch(){
    if(!confirm('开始比赛？所有选手登录后开始计时，时间到自动结束。')) return;
    try {
      await Match.startMatch();
      showToast('▶ 比赛已开始', 'ok');
      refreshMatchUI();
      refreshPlayerList();
    } catch(e){
      showToast('❌ ' + e.message, 'err');
    }
  }

  async function endMatch(){
    if(!confirm('立即结束比赛？所有未交卷选手将自动交卷。')) return;
    await Match.endMatch();
    showToast('比赛已结束', 'ok');
    refreshMatchUI();
    refreshPlayerList();
  }

  async function discardMatch(){
    if(!confirm('放弃本次比赛？所有选手答题数据归档。')) return;
    const cur = Storage.getMatch();
    if(cur){
      Match.archiveMatch(cur, 'abandoned');
    }
    Storage.clearMatch();
    Storage.clearPlayer();
    if(realtimeUnsub){ realtimeUnsub(); realtimeUnsub = null; }
    showToast('已放弃', 'ok');
    refreshMatchUI();
  }

  async function refreshPlayerList(){
    const m = Storage.getMatch();
    if(!m) return;
    if(realtimeUnsub){ realtimeUnsub(); realtimeUnsub = null; }
    const stats = await Match.getPlayerStats(m);
    $('#jPlayerCount').textContent = stats.length;
    const el = $('#jPlayerList');
    if(!stats.length){
      el.innerHTML = '<div class="muted">暂无选手登录</div>';
      return;
    }
    el.innerHTML = `
      <table class="tbl">
        <thead><tr>
          <th>#</th><th>姓名</th><th>邀请码</th><th>状态</th>
          <th>作答/触发</th><th>正确率</th><th>得分</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${stats.map((s, i) => {
            const answeredPct = s.unlocked ? Math.round(s.answered / s.unlocked * 100) : 0;
            const statusBadge = s.status === '已完成'
              ? '<span style="color:var(--success)">✓ 已完成</span>'
              : s.status === '进行中'
                ? '<span style="color:var(--primary)">▶ 进行中</span>'
                : '<span style="color:var(--muted)">○ 未开始</span>';
            const accuracyColor = s.accuracy >= 80 ? 'var(--success)' :
                                  s.accuracy >= 60 ? '#f59e0b' :
                                  s.accuracy > 0 ? 'var(--danger)' : 'var(--muted)';
            const finalScore = s.result ? s.result.score : null;
            const liveScore = s.submitted > 0 ? Math.round(s.correct / s.submitted * 100) : null;
            return `
              <tr>
                <td>${i+1}</td>
                <td><b>${escapeHtml(s.name)}</b></td>
                <td><code>${s.code}</code></td>
                <td>${statusBadge}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;background:#e5e7eb;height:8px;border-radius:4px;overflow:hidden;min-width:80px">
                      <div style="background:${answeredPct===100?'var(--success)':'var(--primary)'};height:100%;width:${answeredPct}%"></div>
                    </div>
                    <span class="muted small">${s.answered}/${s.unlocked}</span>
                  </div>
                </td>
                <td>
                  ${finalScore !== null
                    ? `<b style="color:${finalScore>=60?'var(--success)':'var(--danger)'};font-size:15px">${finalScore}</b>
                       <span class="muted small">(${s.correct}/${s.submitted})</span>`
                    : s.submitted > 0
                      ? `<b style="color:${accuracyColor};font-size:15px">${s.accuracy}%</b>
                         <span class="muted small">(${s.correct}/${s.submitted})</span>`
                      : '<span class="muted">-</span>'}
                </td>
                <td>${liveScore !== null && finalScore === null
                  ? `<b style="color:${accuracyColor}">${liveScore}</b> <span class="muted small">实时</span>`
                  : finalScore !== null ? `<b>${finalScore}</b>` : '-'}</td>
                <td><button class="btn small ghost" onclick="Judge.showPlayerDetail('${s.code}')">详情</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  let currentDetailCode = null;
  async function showPlayerDetail(code){
    const m = Storage.getMatch();
    if(!m) return;
    const cd = m.codes.find(c => c.code === code);
    if(!cd) return;
    currentDetailCode = code;
    $('#playerModalTitle').textContent = `👤 ${cd.playerName||cd.player_name} - ${code}`;

    let progress = Storage.getProgress(m.roomId + '_' + code);
    let result = Storage.getResult(m.roomId + '_' + code);

    if(isOnline() && m.id && cd.playerName){
      try {
        const cloudProgress = await window.Cloud.getProgress(m.id, cd.playerName, code);
        const allAnswers = await window.Cloud.listAllMatchAnswers(m.id);
        if(cloudProgress){
          progress = {
            unlockedModules: cloudProgress.unlocked_modules || [],
            unlockedQuestions: cloudProgress.unlocked_questions || [],
            answers: {}
          };
        }
        if(allAnswers){
          const mine = allAnswers.filter(a => a.player_name === cd.playerName && a.invite_code === code);
          mine.forEach(a => {
            progress.answers = progress.answers || {};
            progress.answers[a.question_id] = {
              state: a.state,
              value: a.value,
              isCorrect: a.is_correct,
              submittedAt: a.submitted_at
            };
          });
        }
        const cloudResults = await window.Cloud.listResults(m.id);
        const myResult = cloudResults.find(r => r.player_name === cd.playerName && r.invite_code === code);
        if(myResult){
          result = {
            score: myResult.total_score,
            total: myResult.total_questions,
            correctCount: myResult.correct_count,
            wrongCount: myResult.wrong_count,
            duration: myResult.duration
          };
        }
      } catch(err){ console.warn('云端读取失败:', err); }
    }

    let submitted = 0, drafts = 0, correct = 0;
    if(progress){
      Object.values(progress.answers || {}).forEach(a => {
        if(a.state === 'submitted'){ submitted++; if(a.isCorrect) correct++; }
        if(a.state === 'draft') drafts++;
      });
    }
    const liveScore = submitted > 0 ? Math.round(correct / submitted * 100) : 0;

    const body = $('#playerModalBody');
    body.innerHTML = `
      <div class="result-summary">
        <div class="result-stat"><b>${progress ? progress.unlockedQuestions.length : 0}</b><span class="label">已触发</span></div>
        <div class="result-stat"><b>${submitted}</b><span class="label">已提交</span></div>
        <div class="result-stat"><b>${correct}</b><span class="label" style="color:var(--success)">正确</span></div>
        <div class="result-stat"><b>${submitted - correct}</b><span class="label" style="color:var(--danger)">错误</span></div>
        <div class="result-stat ${result?'score':''}"><b>${result ? result.score : (submitted>0?liveScore:'-')}</b><span class="label">${result?'最终得分':'实时得分'}</span></div>
      </div>
      <h3>答题明细（实时 · ${isOnline()?'云端':''}）</h3>
      <div class="qlist" style="max-height:400px;overflow-y:auto">
        ${progress && progress.unlockedQuestions && progress.unlockedQuestions.length ? progress.unlockedQuestions.map(qid => {
          const q = (m.bankSnapshot ? m.bankSnapshot.questions : []).find(qq => qq.id === qid);
          if(!q) return '';
          const ans = progress.answers[qid];
          let stateBadge, itemClass = '';
          if(ans?.state === 'submitted'){
            if(ans.isCorrect === true){
              stateBadge = '<span style="color:var(--success);font-weight:600">✓ 正确</span>';
              itemClass = 'correct';
            } else if(ans.isCorrect === false){
              stateBadge = '<span style="color:var(--danger);font-weight:600">✗ 错误</span>';
              itemClass = 'wrong';
            } else {
              stateBadge = '<span style="color:var(--muted)">已提交</span>';
            }
          } else if(ans?.state === 'draft'){
            stateBadge = '<span style="color:#3b82f6">◐ 草稿</span>';
          } else {
            stateBadge = '<span style="color:var(--muted)">○ 未作答</span>';
          }
          const myAns = ans?.value;
          const myStr = Array.isArray(myAns) ? myAns.join('、') || '(空)' : myAns || '(空)';
          let correctStr = '';
          if(ans?.state === 'submitted' && ans.isCorrect === false && ans.correctAnswer){
            const ca = Array.isArray(ans.correctAnswer) ? ans.correctAnswer.join(' / ') : ans.correctAnswer;
            correctStr = `<div class="muted small" style="color:var(--success);margin-top:2px">正确答案：${escapeHtml(ca)}</div>`;
          }
          return `
            <div class="qitem ${itemClass}">
              <div class="qitem-head">
                <span class="qitem-num ${itemClass}">${qid}</span>
                <span class="qitem-stem">${escapeHtml((q.stem || '').slice(0,50))}${q.stem.length>50?'...':''}</span>
                <span class="qitem-state">${stateBadge}</span>
              </div>
              <div class="muted small" style="margin-top:4px">答案：${escapeHtml(myStr)}</div>
              ${correctStr}
            </div>
          `;
        }).join('') : '<div class="muted">该选手尚未触发任何题目</div>'}
      </div>
    `;
    $('#playerModal').classList.remove('hidden');
  }

  function hidePlayerDetail(){
    $('#playerModal').classList.add('hidden');
    currentDetailCode = null;
  }

  async function forceSubmitPlayer(){
    if(!currentDetailCode){ showToast('请先选择选手', 'err'); return; }
    if(!confirm(`强制交卷？该选手将立即完成答题。`)) return;
    const m = Storage.getMatch();
    if(!m) return;
    const playerKey = m.roomId + '_' + currentDetailCode;
    const progress = Storage.getProgress(playerKey);
    if(!progress){ showToast('该选手无进度', 'err'); return; }
    if(progress.finished){ showToast('已交卷', 'ok'); return; }
    const cd = m.codes.find(c => c.code === currentDetailCode);
    if(!cd || !cd.playerName){ showToast('选手信息缺失', 'err'); return; }
    const result = TriggerEngine.finishExam(progress, m.bankSnapshot);
    Storage.saveResult(playerKey, result);
    Storage.saveProgress(playerKey, progress);
    if(isOnline() && m.id){
      try {
        await window.Cloud.upsertAnswer(m.id, cd.playerName, currentDetailCode, '__finish__', {
          state: 'submitted', value:null
        });
        await window.Cloud.upsertResult(m.id, cd.playerName, currentDetailCode, result);
      } catch(err){ console.warn('云端同步失败:', err); }
    }
    if(window.App && window.App.state && window.App.state.progress){
      if(window.App.state.progress.finished){
        alert('此裁判操作：已对当前选手强制交卷');
      }
    }
    showToast('已强制交卷', 'ok');
    hidePlayerDetail();
    refreshPlayerList();
  }

  async function forceEndAll(){
    if(!confirm('一键交卷所有选手？所有未交卷选手将立即完成答题。')) return;
    const m = Storage.getMatch();
    if(!m) return;
    let count = 0;
    for(const c of m.codes){
      if(!c.used) continue;
      const playerKey = m.roomId + '_' + c.code;
      const progress = Storage.getProgress(playerKey);
      if(!progress || progress.finished) continue;
      const result = TriggerEngine.finishExam(progress, m.bankSnapshot);
      Storage.saveResult(playerKey, result);
      Storage.saveProgress(playerKey, progress);
      if(isOnline() && m.id && c.playerName){
        try {
          await window.Cloud.upsertResult(m.id, c.playerName, c.code, result);
        } catch(err){}
      }
      count++;
    }
    showToast(`已交卷 ${count} 名选手`, 'ok');
    refreshPlayerList();
  }

  async function setupJudge(){
    const p1 = $('#judgePwd1').value;
    const p2 = $('#judgePwd2').value;
    if(!p1 || p1.length < 4){ showToast('密码至少 4 位', 'err'); return; }
    if(p1 !== p2){ showToast('两次密码不一致', 'err'); return; }
    Storage.saveJudge({ pwdHash: hashPwd(p1), createdAt: Date.now() });
    judgeLoggedIn = true;
    showToast('✅ 裁判账号已设置', 'ok');
    enterJudgePanel();
  }

  function loginJudge(){
    const pwd = $('#judgePwdLogin').value;
    const j = Storage.getJudge();
    if(!j){ showToast('请先设置密码', 'err'); return; }
    if(j.pwdHash !== hashPwd(pwd)){ showToast('密码错误', 'err'); return; }
    judgeLoggedIn = true;
    enterJudgePanel();
  }

  function resetJudge(){
    if(!confirm('重置裁判账号？所有题库、比赛数据将清空。')) return;
    Storage.clearAll();
    judgeLoggedIn = false;
    showToast('已重置', 'ok');
    showView('judge-auth');
    initJudgeAuth();
    refreshBankStatus();
    refreshMatchUI();
  }

  function enterJudgePanel(){
    showView('judge');
    $('#userInfo').textContent = '👨‍⚖️ 裁判';
    $('#logoutBtn').classList.remove('hidden');
    $('#jMinutes').value = Storage.getMatch()?.totalMinutes || 120;
    $('#jInviteCount').value = Storage.getMatch()?.codes.length || 5;
    refreshBankStatus();
    refreshMatchUI();
  }

  function logoutJudge(){
    judgeLoggedIn = false;
    Storage.savePlayer(null);
    $('#userInfo').textContent = '';
    $('#logoutBtn').classList.add('hidden');
    showView('home');
  }

  function initJudgeAuth(){
    const has = Storage.hasJudge();
    $('#judgeAuthFirst').classList.toggle('hidden', has);
    $('#judgeAuthLogin').classList.toggle('hidden', !has);
  }

  function hashPwd(pwd){
    let h = 5381;
    for(let i=0;i<pwd.length;i++){
      h = ((h << 5) + h) + pwd.charCodeAt(i);
      h = h & 0xFFFFFFFF;
    }
    return 'h' + Math.abs(h).toString(16);
  }

  async function loadExcel(file){
    return ExcelParser.parseFile(file).then(bank => {
      Storage.saveBank(bank);
      refreshBankStatus();
      showToast(`✅ 已加载 ${bank.modules.length} 模块，${bank.questions.length} 题`, 'ok');
    });
  }

  async function loadEncrypted(file){
    const text = await file.text();
    const encObj = JSON.parse(text);
    const pwd = prompt('请输入题库密码：');
    if(!pwd) return;
    try {
      const bank = await Crypto.decrypt(encObj, pwd);
      Storage.saveBank(bank);
      refreshBankStatus();
      showToast(`✅ 已加载加密题库（${bank.modules.length} 模块）`, 'ok');
    } catch(e){
      showToast('❌ ' + e.message, 'err');
    }
  }

  async function loadDemo(){
    try {
      const resp = await fetch('templates/题库模板.xlsx');
      if(!resp.ok) throw new Error('示例文件不存在');
      const buf = await resp.arrayBuffer();
      const bank = ExcelParser.parseArrayBuffer(new Uint8Array(buf));
      Storage.saveBank(bank);
      refreshBankStatus();
      showToast(`✅ 已加载示例题库（${bank.modules.length} 模块）`, 'ok');
    } catch(e){
      showToast('❌ ' + e.message, 'err');
    }
  }

  async function uploadBankToCloud(){
    const bank = Storage.getBank();
    const pwd = prompt('请设置题库密码（选手需输入才能加载题库）：');
    if(!pwd || pwd.length < 4){
      showToast('密码至少 4 位', 'err');
      return;
    }
    try {
      const encData = await Crypto.encrypt(JSON.stringify(bank), pwd);
      const saved = await window.Cloud.saveBank(bank.modules.length + '题-' + new Date().toLocaleDateString(), encData, pwd);
      showToast(`☁️ 题库已上传（密码：${pwd}），选手需用此密码解锁`, 'ok');
      console.log('题库上传成功:', saved.id);
    } catch(err){
      showToast('❌ 上传失败：' + err.message, 'err');
    }
  }

  async function listCloudBanks(){
    const judgeId = window.Cloud.getJudgeId();
    const banks = await window.Cloud.listBanks(judgeId);
    if(!banks.length){
      showToast('云端暂无题库', 'ok');
      return;
    }
    const list = banks.map(b => {
      const dt = new Date(b.created_at);
      return `${b.id.slice(0,8)}... | ${b.name} | ${dt.toLocaleDateString()}`;
    }).join('\n');
    alert('云端题库：\n' + list);
  }

  function copyText(text){
    if(navigator.clipboard){
      navigator.clipboard.writeText(text).then(()=>showToast('已复制', 'ok'));
    } else {
      const ta = document.createElement('a');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('已复制', 'ok');
    }
  }

  async function exportStats(){
    const m = Storage.getMatch();
    if(!m){ showToast('暂无比赛', 'err'); return; }
    const csv = await Match.exportStats(m);
    const blob = new Blob(['\ufeff' + csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `比赛报告_${m.roomId}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function createMatchClick(){
    console.log('[createMatch] 开始');
    const minutes = parseInt($('#jMinutes').value, 10);
    const codeCount = parseInt($('#jInviteCount').value, 10);
    if(!minutes || minutes < 1){ showToast('时长无效', 'err'); return; }
    if(!codeCount || codeCount < 1){ showToast('邀请码数量无效', 'err'); return; }
    const bank = Storage.getBank();
    if(!bank){ showToast('请先加载题库', 'err'); return; }

    const pwd = prompt('请设置题库密码（选手访问时要输入此密码才能加载题库，至少4位）：');
    if(!pwd || pwd.length < 4){ showToast('密码无效', 'err'); return; }

    let encryptedBank = null;
    if(isOnline()){
      try {
        console.log('[createMatch] 1. 加密题库...');
        const encData = await Crypto.encrypt(JSON.stringify(bank), pwd);
        console.log('[createMatch] 2. 上传加密题库...');
        const saved = await window.Cloud.saveBank(
          bank.modules.length + '题-' + new Date().toLocaleDateString(),
          encData,
          pwd
        );
        encryptedBank = { bankId: saved.id, password: pwd };
        console.log('[createMatch] ✅ 题库已上传:', saved.id);
      } catch(err){
        console.error('[createMatch] ❌ 题库上传失败:', err);
        showToast('❌ 题库上传失败：' + err.message + '（本地继续）', 'err');
      }
    } else {
      encryptedBank = { bankId: null, password: pwd };
      console.log('[createMatch] 离线模式，跳过云端上传');
    }

    try {
      console.log('[createMatch] 3. 生成邀请码并创建比赛...');
      const codes = [];
      for(let i=0;i<codeCount;i++) codes.push({ code: Match.generateInviteCode() });
      const m = await Match.createMatch(bank, minutes, codeCount, encryptedBank);
      m.encryptedBank = encryptedBank;
      Storage.saveMatch(m);
      console.log('[createMatch] ✅ 比赛已创建:', {
        id: m.id,
        roomId: m.roomId,
        codes: m.codes.map(c => c.code),
        codesStored: m.codes.length,
        bankId: encryptedBank?.bankId
      });
      showToast(`🎮 比赛已生成（${isOnline()?'同步到云端':''}）`, 'ok');
      refreshMatchUI();
    } catch(e){
      console.error('[createMatch] ❌ 比赛创建失败:', e);
      showToast('❌ ' + e.message, 'err');
    }
  }

  function init(){
    Realtime.init();
    Realtime.on('cloud:answer', () => { refreshPlayerList(); });
    Realtime.on('cloud:progress', () => { refreshPlayerList(); });
    Realtime.on('cloud:result', () => {
      refreshPlayerList();
      showToast('🏁 选手已完成比赛（云端）', 'ok');
    });

    $$('[data-role]').forEach(b => {
      b.addEventListener('click', () => {
        const role = b.dataset.role;
        if(role === 'player'){
          showView('login');
          setTimeout(() => {
            if(window.App && window.App.refreshLoginMatchStatus) window.App.refreshLoginMatchStatus();
          }, 50);
        } else if(role === 'judge'){
          showView('judge-auth');
          initJudgeAuth();
        }
      });
    });

    $('#judgeSetupBtn').addEventListener('click', setupJudge);
    $('#judgeLoginBtn').addEventListener('click', loginJudge);
    $('#judgeResetBtn').addEventListener('click', resetJudge);

    $('#jLoadExcel').addEventListener('click', () => $('#jFileExcel').click());
    $('#jLoadEnc').addEventListener('click', () => $('#jFileEnc').click());
    $('#jLoadDemo').addEventListener('click', loadDemo);
    $('#jFileExcel').addEventListener('change', async e => {
      const f = e.target.files[0];
      if(f){ try{ await loadExcel(f); }catch(err){ showToast('❌ '+err.message,'err'); } }
      e.target.value = '';
    });
    $('#jFileEnc').addEventListener('change', async e => {
      const f = e.target.files[0];
      if(f){ try{ await loadEncrypted(f); }catch(err){ showToast('❌ '+err.message,'err'); } }
      e.target.value = '';
    });

    $('#jCreateMatch').addEventListener('click', createMatchClick);
    $('#jCopyRoom').addEventListener('click', () => {
      const rid = $('#jRoomId').textContent;
      if(rid) copyText(rid);
    });
    $('#jCopyAllCodes').addEventListener('click', () => {
      const m = Storage.getMatch();
      if(!m) return;
      const codes = m.codes.map((c,i) => `${i+1}. ${c.code}`).join('\n');
      copyText(`房间号：${m.roomId}\n\n邀请码：\n${codes}`);
    });
    $('#jExportStats').addEventListener('click', exportStats);
    $('#jForceEndAll').addEventListener('click', forceEndAll);

    $('#playerModalClose').addEventListener('click', hidePlayerDetail);
    $('#playerForceSubmit').addEventListener('click', forceSubmitPlayer);

    refreshBankStatus();
    refreshMatchUI();
  }

  return {
    init, refreshPlayerList, refreshMatchUI, refreshBankStatus,
    showPlayerDetail, uploadBankToCloud, listCloudBanks
  };
})();