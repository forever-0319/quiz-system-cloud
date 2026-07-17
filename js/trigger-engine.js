const TriggerEngine = (() => {

  function getModuleByName(bank, name){
    return bank.modules.find(m => m.name === name);
  }

  function getModuleIdByName(bank, name){
    const m = getModuleByName(bank, name);
    return m ? m.id : null;
  }

  function getQuestion(bank, qid){
    return bank.questions.find(q => q.id === qid);
  }

  function getQuestionsByModule(bank, moduleId){
    return bank.questions.filter(q => q.moduleId === moduleId);
  }

  function judgeQuestion(q, userValue){
    if(!userValue && userValue !== 0) return false;
    if(Array.isArray(userValue) && userValue.length === 0) return false;
    if(typeof userValue === 'string' && userValue.trim() === '') return false;

    if(q.type === 'single'){
      const u = String(Array.isArray(userValue) ? userValue[0] : userValue).toUpperCase();
      return u === q.choiceAnswer;
    }
    if(q.type === 'multi'){
      const userLetters = (Array.isArray(userValue) ? userValue : [userValue])
        .join('').toUpperCase().split('').sort().join('');
      const rightLetters = (q.choiceAnswer || '').toUpperCase().split('').sort().join('');
      return userLetters === rightLetters && userLetters.length > 0;
    }
    if(q.type === 'fill'){
      const userAns = String(Array.isArray(userValue) ? userValue[0] : userValue);
      if(!q.acceptedAnswers || !q.acceptedAnswers.length) return false;
      return q.acceptedAnswers.some(kw => userAns.includes(kw));
    }
    return false;
  }

  function initProgress(bank, startModules){
    const progress = {
      unlockedModules: [],
      unlockedQuestions: [],
      answers: {},
      finished: false,
      startedAt: null,
      expiresAt: null
    };

    const initial = startModules && startModules.length ? startModules : ['现勘'];
    initial.forEach(name => {
      const m = getModuleByName(bank, name);
      if(!m) return;
      if(!progress.unlockedModules.includes(m.id)){
        progress.unlockedModules.push(m.id);
      }
    });

    bank.modules.forEach(m => {
      if(!progress.unlockedModules.includes(m.id)) return;
      const qs = getQuestionsByModule(bank, m.id);
      qs.forEach(q => {
        if(q.initialUnlock && !progress.unlockedQuestions.includes(q.id)){
          progress.unlockedQuestions.push(q.id);
        }
      });
    });

    return progress;
  }

  function startExam(progress, totalMinutes){
    progress.startedAt = Date.now();
    progress.expiresAt = Date.now() + totalMinutes * 60 * 1000;
    progress.finished = false;
    return progress;
  }

  function onAnswer(progress, bank, qid, value, isSubmit){
    const q = getQuestion(bank, qid);
    if(!q) return { changed:false, progress };
    if(isSubmit && progress.answers[qid]?.state === 'submitted'){
      return { changed:false, progress };
    }

    if(!progress.answers[qid]){
      progress.answers[qid] = { state:'draft', value:null, submittedAt:null };
    }

    progress.answers[qid].value = value;
    if(isSubmit){
      progress.answers[qid].state = 'submitted';
      progress.answers[qid].submittedAt = Date.now();
      const correctAnswer = q.type === 'fill' ? q.acceptedAnswers : q.choiceAnswer;
      const isCorrect = judgeQuestion(q, value);
      progress.answers[qid].isCorrect = isCorrect;
      progress.answers[qid].correctAnswer = correctAnswer;
    } else {
      progress.answers[qid].state = 'draft';
      delete progress.answers[qid].isCorrect;
      delete progress.answers[qid].correctAnswer;
    }

    if(!isSubmit) return { changed:true, progress };

    const result = {
      changed:true,
      progress,
      unlockedModules:[],
      unlockedQuestions:[],
      isCorrect: progress.answers[qid].isCorrect
    };

    if(!q.trigger || (!q.trigger.modules?.length && !q.trigger.questions?.length)){
      return result;
    }

    const when = q.trigger.when || 'submit';
    const shouldTrigger = true;

    if(!shouldTrigger) return result;

    if(q.trigger.modules){
      q.trigger.modules.forEach(name => {
        const mid = getModuleIdByName(bank, name);
        if(!mid) return;
        if(!progress.unlockedModules.includes(mid)){
          progress.unlockedModules.push(mid);
          result.unlockedModules.push(name);
        }
        getQuestionsByModule(bank, mid).forEach(qq => {
          if(qq.initialUnlock && !progress.unlockedQuestions.includes(qq.id)){
            progress.unlockedQuestions.push(qq.id);
            result.unlockedQuestions.push(qq.id);
          }
        });
      });
    }

    if(q.trigger.questions){
      q.trigger.questions.forEach(qid2 => {
        if(!progress.unlockedQuestions.includes(qid2)){
          progress.unlockedQuestions.push(qid2);
          result.unlockedQuestions.push(qid2);
        }
      });
    }

    return result;
  }

  function finishExam(progress, bank){
    progress.finished = true;
    const detail = bank.questions
      .filter(q => progress.answers[q.id]?.state === 'submitted')
      .map(q => {
        const a = progress.answers[q.id];
        const isCorrect = a.isCorrect !== undefined ? a.isCorrect : judgeQuestion(q, a.value);
        const correctAnswer = a.correctAnswer || (q.type === 'fill' ? q.acceptedAnswers : q.choiceAnswer);
        return { q, myAnswer: a.value, isCorrect, correctAnswer };
      });
    const correctCount = detail.filter(d => d.isCorrect).length;
    const total = detail.length;
    const result = {
      finishedAt: Date.now(),
      startedAt: progress.startedAt,
      duration: progress.startedAt ? Math.round((Date.now() - progress.startedAt)/1000) : 0,
      total, correctCount,
      wrongCount: total - correctCount,
      score: total > 0 ? Math.round(correctCount * 100 / total) : 0,
      detail
    };
    return result;
  }

  function getModuleStats(progress, bank, moduleId){
    const all = getQuestionsByModule(bank, moduleId);
    const unlocked = all.filter(q => progress.unlockedQuestions.includes(q.id));
    const answered = all.filter(q => {
      const a = progress.answers[q.id];
      return a && (a.state === 'draft' || a.state === 'submitted');
    });
    return { total:all.length, unlocked:unlocked.length, answered:answered.length };
  }

  function getTotalStats(progress, bank){
    let unlocked = 0, answered = 0;
    bank.questions.forEach(q => {
      if(progress.unlockedQuestions.includes(q.id)) unlocked++;
      const a = progress.answers[q.id];
      if(a && (a.state === 'draft' || a.state === 'submitted')) answered++;
    });
    return { total:bank.questions.length, unlocked, answered };
  }

  return {
    getModuleByName, getModuleIdByName, getQuestion, getQuestionsByModule,
    judgeQuestion,
    initProgress, startExam, onAnswer, finishExam,
    getModuleStats, getTotalStats
  };
})();