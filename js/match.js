const Match = (() => {

  function randCode(len = 4){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for(let i=0;i<len;i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function generateRoomId(){
    return 'ROOM-' + randCode(4) + '-' + randCode(3);
  }

  function generateInviteCode(){
    return randCode(4) + '-' + randCode(4);
  }

  function isOnline(){ return window.Cloud && window.Cloud.isConnected(); }

  async function createMatch(bank, totalMinutes, codeCount, encryptedBank){
    if(!bank) throw new Error('请先加载题库');
    const roomId = generateRoomId();
    const codes = [];
    for(let i=0;i<codeCount;i++){
      codes.push({ code: generateInviteCode() });
    }

    if(isOnline()){
      try {
        const bankId = encryptedBank.bankId;
        const matchData = await window.Cloud.createMatch(bankId, roomId, totalMinutes, encryptedBank);
        const codesData = await window.Cloud.addInviteCodes(matchData.id, codes.map(c => c.code));
        const m = {
          id: matchData.id,
          roomId,
          bankId,
          bankSnapshot: bank,
          encryptedBank,
          totalMinutes,
          codes: codesData.map(d => ({...d})),
          status: 'pending',
          createdAt: matchData.created_at,
          startedAt: null,
          expiresAt: null,
          finishedAt: null,
          playerResults: {}
        };
        Storage.saveMatch(m);
        Storage.saveBank(bank);
        return m;
      } catch(err){
        console.warn('云端创建失败，回落到本地:', err);
      }
    }

    const match = {
      roomId,
      bankSnapshot: bank,
      totalMinutes,
      codes,
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      expiresAt: null,
      finishedAt: null,
      playerResults: {}
    };
    Storage.saveMatch(match);
    Storage.saveBank(bank);
    return match;
  }

  function getMatch(){
    return Storage.getMatch();
  }

  async function startMatch(){
    const m = Storage.getMatch();
    if(!m) throw new Error('比赛不存在');
    if(m.status !== 'pending') throw new Error('比赛已开始或已结束');
    m.status = 'running';
    m.startedAt = Date.now();
    m.expiresAt = m.startedAt + m.totalMinutes * 60 * 1000;
    Storage.saveMatch(m);
    if(isOnline() && m.id){
      try {
        await window.Cloud.updateMatch(m.id, {
          status: 'running',
          started_at: new Date(m.startedAt).toISOString(),
          expires_at: new Date(m.expiresAt).toISOString()
        });
        console.log('已同步到云端');
      } catch(err){ console.warn('云端同步失败:', err); }
    }
    return m;
  }

  async function endMatch(){
    const m = Storage.getMatch();
    if(!m) return null;
    m.status = 'finished';
    m.finishedAt = Date.now();
    Storage.saveMatch(m);
    if(isOnline() && m.id){
      try {
        await window.Cloud.updateMatch(m.id, {
          status: 'finished',
          finished_at: new Date(m.finishedAt).toISOString()
        });
      } catch(err){ console.warn('云端结束失败:', err); }
    }
    archiveMatch(m, 'finished');
    return m;
  }

  function archiveMatch(m, finalStatus){
    if(!m) return null;
    const results = {};
    let totalScore = 0, completedCount = 0;
    m.codes.forEach(c => {
      if(!c.used) return;
      const playerKey = m.roomId + '_' + c.code;
      const result = Storage.getResult(playerKey);
      if(result){
        results[c.code] = {
          playerName: c.playerName,
          score: result.score,
          total: result.total,
          correctCount: result.correctCount,
          wrongCount: result.wrongCount,
          duration: result.duration
        };
        totalScore += result.score;
        completedCount++;
      }
    });

    const archive = {
      matchId: m.roomId,
      bankSummary: m.bankSnapshot ? {
        modules: m.bankSnapshot.modules.length,
        questions: m.bankSnapshot.questions.length,
        moduleNames: m.bankSnapshot.modules.map(mm => mm.name)
      } : null,
      totalMinutes: m.totalMinutes,
      codeCount: m.codes.length,
      usedCount: m.codes.filter(c => c.used).length,
      completedCount,
      totalCount: completedCount,
      avgScore: completedCount > 0 ? Math.round(totalScore / completedCount) : 0,
      maxScore: completedCount > 0 ? Math.max(...Object.values(results).map(r => r.score)) : 0,
      createdAt: m.createdAt,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt || Date.now(),
      finalStatus,
      match: m,
      results
    };
    Storage.addArchive(archive);
    return archive;
  }

  function reopenArchivedMatch(matchId){
    const archive = Storage.getArchive(matchId);
    if(!archive || !archive.match) return null;
    return createMatch(archive.match.bankSnapshot, archive.match.totalMinutes, archive.match.codes.length, archive.match.encryptedBank);
  }

  async function validateLogin(name, roomId, inviteCode){
    name = name.trim();
    roomId = roomId.trim().toUpperCase();
    inviteCode = inviteCode.trim().toUpperCase();
    console.log('[validateLogin] 验证:', { name, roomId, inviteCode });

    if(isOnline()){
      try {
        console.log('[validateLogin] 查询云端比赛, roomId=', roomId);
        const m = await window.Cloud.getMatchByRoom(roomId);
        console.log('[validateLogin] 云端返回:', m);
        if(!m){
          console.warn('[validateLogin] ❌ 云端无此房间号');
          return { ok:false, msg:'该房间号不存在（云端未找到）' };
        }
        const codes = await window.Cloud.listInviteCodes(m.id);
        console.log('[validateLogin] 邀请码:', codes.map(c => c.code));
        const code = codes.find(c => c.code === inviteCode);
        if(!code) return { ok:false, msg:'邀请码无效' };
        if(m.status === 'finished') return { ok:false, msg:'本场比赛已结束' };
        if(code.used && code.player_name !== name){
          return { ok:false, msg:'该邀请码已被 ' + (code.player_name||'其他选手') + ' 使用' };
        }
        console.log('[validateLogin] ✅ 验证通过');
        return { ok:true, match: m, code, online:true };
      } catch(err){
        console.warn('[validateLogin] ❌ 云端查询异常:', err.message);
      }
    }

    const m = Storage.getMatch();
    if(!m) return { ok:false, msg:'比赛不存在（请确认云端已连接，或导入比赛包）' };
    if(m.roomId !== roomId) return { ok:false, msg:'房间号错误（注意大小写）' };
    if(m.status === 'finished') return { ok:false, msg:'本场比赛已结束' };
    const code = m.codes.find(c => c.code === inviteCode);
    if(!code) return { ok:false, msg:'邀请码无效（注意大小写）' };
    if(code.used && code.playerName !== name){
      return { ok:false, msg:'该邀请码已被 ' + (code.playerName||'其他选手') + ' 使用' };
    }
    return { ok:true, match:m, code, online:false };
  }

  async function useCode(roomId, inviteCode, playerName){
    inviteCode = inviteCode.toUpperCase();
    if(isOnline()){
      try {
        const m = await window.Cloud.getMatchByRoom(roomId.toUpperCase());
        if(m){
          await window.Cloud.markCodeUsed(m.id, inviteCode, playerName);
        }
      } catch(err){ console.warn('云端使用邀请码失败:', err); }
    }

    const m = Storage.getMatch();
    if(!m) return false;
    const code = m.codes.find(c => c.code === inviteCode);
    if(!code) return false;
    if(code.used && code.playerName !== playerName) return false;
    code.used = true;
    code.playerName = playerName;
    code.usedAt = Date.now();
    Storage.saveMatch(m);
    return true;
  }

  async function getPlayerStats(m){
    const stats = [];
    for(const c of m.codes){
      if(!c.used) continue;
      const playerKey = m.roomId + '_' + c.code;
      let progress = Storage.getProgress(playerKey);
      let result = Storage.getResult(playerKey);

      if(isOnline() && m.id && c.playerName){
        try {
          const [cloudProgress, allAnswers] = await Promise.all([
            window.Cloud.getProgress(m.id, c.playerName, c.code),
            window.Cloud.listAllMatchAnswers(m.id)
          ]);
          if(cloudProgress){
            progress = {
              unlockedModules: cloudProgress.unlocked_modules || [],
              unlockedQuestions: cloudProgress.unlocked_questions || [],
              answers: {}
            };
          }
          if(allAnswers){
            const mine = allAnswers.filter(a => a.player_name === c.playerName && a.invite_code === c.code);
            const answersMap = {};
            mine.forEach(a => {
              answersMap[a.question_id] = {
                state: a.state,
                value: a.value,
                isCorrect: a.is_correct,
                submittedAt: a.submitted_at
              };
            });
            if(Object.keys(answersMap).length){
              progress = progress || { unlockedModules:[], unlockedQuestions:[], answers:{} };
              progress.answers = answersMap;
            }
            const cloudResults = await window.Cloud.listResults(m.id);
            const myResult = cloudResults.find(r => r.player_name === c.playerName && r.invite_code === c.code);
            if(myResult){
              result = {
                score: myResult.total_score,
                total: myResult.total_questions,
                correctCount: myResult.correct_count,
                wrongCount: myResult.wrong_count,
                duration: myResult.duration,
                finishedAt: myResult.finished_at
              };
            }
          }
        } catch(err){ console.warn('云端读取失败:', err); }
      }

      const total = m.bankSnapshot ? m.bankSnapshot.questions.length : 0;
      const unlocked = progress ? progress.unlockedQuestions.length : 0;
      let submitted = 0, correct = 0;
      if(progress){
        Object.values(progress.answers || {}).forEach(a => {
          if(a.state === 'submitted'){
            submitted++;
            if(a.isCorrect) correct++;
          }
        });
      }
      stats.push({
        name: c.playerName,
        code: c.code,
        progress,
        result,
        unlocked, answered: submitted, total,
        submitted, correct,
        accuracy: submitted > 0 ? Math.round(correct / submitted * 100) : 0,
        status: result ? '已完成' : (progress && (progress.unlockedQuestions||[]).length ? '进行中' : '未开始')
      });
    }
    return stats;
  }

  async function exportStats(m){
    const lines = ['选手姓名,邀请码,状态,已触发题,已答题,得分,用时(秒)'];
    const stats = await getPlayerStats(m);
    stats.forEach(s => {
      const dur = s.result ? s.result.duration || 0 : '';
      lines.push([
        s.name, s.code, s.status, s.unlocked, s.answered,
        s.result ? s.result.score : '',
        dur
      ].join(','));
    });
    return lines.join('\n');
  }

  return {
    generateRoomId, generateInviteCode,
    createMatch, startMatch, endMatch,
    validateLogin, useCode, getMatch,
    getPlayerStats, exportStats, isOnline
  };
})();
