const ExcelParser = (() => {

  function normalizeType(t){
    if(!t) return 'single';
    t = String(t).trim();
    if(/^填/.test(t)) return 'fill';
    if(/^多/.test(t)) return 'multi';
    return 'single';
  }

  function parseAnswer(str, type){
    if(!str) return { choiceAnswer:'', acceptedAnswers:[] };
    str = String(str).trim();
    if(type === 'fill'){
      const arr = str.split(/[,，;；]/).map(s=>s.trim()).filter(Boolean);
      return { choiceAnswer:'', acceptedAnswers:arr };
    }
    const cleaned = str.toUpperCase().replace(/[^A-F,，;；]/g,'');
    const letters = cleaned.split(/[,，;；]/).join('');
    return { choiceAnswer:letters, acceptedAnswers:[] };
  }

  function parseTrigger(str){
    if(!str) return { modules:[], questions:[], when:'correct' };
    const parts = String(str).split('|');
    const result = { modules:[], questions:[], when:'correct' };
    parts.forEach(p => {
      const [k, v] = p.split(':').map(s=>s.trim());
      if(!k || !v) return;
      if(k === 'mod' || k === '模块'){
        result.modules = v.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
      } else if(k === 'q' || k === '题'){
        result.questions = v.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
      } else if(k === 'when' || k === '时机'){
        result.when = v.toLowerCase();
      }
    });
    return result;
  }

  function generateQuestionId(moduleName, index){
    const prefixMap = {
      '现勘':'XK','理化':'LH','DNA':'DNA','文检':'WJ',
      '电子物证':'DZWZ','视频':'SP','声纹':'SW','法医':'FY'
    };
    let prefix = prefixMap[moduleName] || moduleName.slice(0,2).toUpperCase();
    return prefix + '_' + index;
  }

  function normalizeModuleName(name){
    const map = {
      '电子物证':'电子物证','电子':'电子物证','digital':'电子物证','digital evidence':'电子物证'
    };
    const key = String(name||'').trim().toLowerCase();
    if(map[key]) return map[key];
    return String(name||'').trim();
  }

  function parseFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, {defval:'', raw:false});
          resolve(toBank(rows));
        } catch(err){ reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function parseArrayBuffer(buf){
    const wb = XLSX.read(buf, {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {defval:'', raw:false});
    return toBank(rows);
  }

  function toBank(rows){
    const modulesMap = {};
    const questions = [];
    const counter = {};

    rows.forEach((r, idx) => {
      const keys = Object.keys(r);
      const get = (...names) => {
        for(const n of names){
          const k = keys.find(x => x.trim() === n);
          if(k !== undefined && r[k] !== '' && r[k] !== null && r[k] !== undefined) return r[k];
        }
        return '';
      };

      const moduleName = String(get('专业')).trim();
      if(!moduleName) return;
      const normalizedName = normalizeModuleName(moduleName);
      const type = normalizeType(get('题型','类型'));
      const stem = String(get('题干','题目','问题')).trim();
      if(!stem) return;

      if(!modulesMap[normalizedName]){
        modulesMap[normalizedName] = {
          id: 'mod_' + normalizedName,
          name: normalizedName,
          icon: getModuleIcon(normalizedName),
          description: ''
        };
      }

      counter[normalizedName] = (counter[normalizedName]||0) + 1;
      const qid = generateQuestionId(normalizedName, counter[normalizedName]);

      const options = [];
      ['A','B','C','D'].forEach(L => {
        const v = get(L, `选项${L}`);
        if(v !== '' && v !== undefined && v !== null) options.push(String(v).trim());
      });

      const answer = parseAnswer(get('答案','正确答案'), type);
      const trigMod = String(get('触发模块','模块')).trim();
      const trigQ = String(get('触发题目','题目')).trim();
      const trigWhen = String(get('触发时机','时机')).trim().toLowerCase() || 'correct';
      const trigger = {
        modules: trigMod ? trigMod.split(/[,，;；]/).map(s=>s.trim()).filter(Boolean) : [],
        questions: trigQ ? trigQ.split(/[,，;；]/).map(s=>s.trim()).filter(Boolean) : [],
        when: trigWhen
      };
      const initial = String(get('初始题','初始')).trim().toUpperCase();
      const explanation = String(get('解析','答案解析','说明')).trim();
      const image = String(get('图片','配图','image')).trim();

      questions.push({
        id: qid,
        moduleId: modulesMap[normalizedName].id,
        moduleName: normalizedName,
        type, stem, options,
        choiceAnswer: answer.choiceAnswer,
        acceptedAnswers: answer.acceptedAnswers,
        explanation, image,
        initialUnlock: initial === 'Y' || initial === '是' || initial === 'YES' || initial === '1',
        trigger
      });
    });

    const modules = Object.values(modulesMap);
    return { modules, questions };
  }

  function getModuleIcon(name){
    const icons = {
      '现勘':'🚩','理化':'🧪','DNA':'🧬','文检':'📝',
      '电子物证':'💻','视频':'🎬','声纹':'🎤','法医':'⚕️'
    };
    return icons[name] || '📚';
  }

  return { parseFile, parseArrayBuffer };
})();