/* 公共逻辑：接口封装、入口验证、分组、双模式统计 */
const C = window.APP_CONFIG;

function rpc(fn, body) {
  return fetch(C.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: C.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + C.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function loadVotes() {
  return fetch(C.SUPABASE_URL + '/rest/v1/votes?select=*&order=ts.asc', {
    headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + C.SUPABASE_ANON_KEY },
  }).then(r => (r.ok ? r.json() : []));
}

function enter(pw) { return rpc('enter', { p_password: pw }); }

function cfgOf(cls) { return C.CLASSES[cls]; }
function round1(x) { return Math.round(x * 10) / 10; }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid(cls, g, s) { return cls + '-' + g + '-' + s; }

function unitList(cls) {
  const cfg = cfgOf(cls);
  const list = [];
  cfg.groups.forEach((n, i) => {
    for (let s = 1; s <= n; s++) list.push({ g: i + 1, s });
  });
  return list;
}

/* 统计：支持 standard（十项五星）与 design（4班双表+保底）两种模式 */
function calcStats(votes, cls) {
  const cfg = cfgOf(cls);
  const map = {};
  unitList(cls).forEach(u => {
    map[uid(cls, u.g, u.s)] = {
      g: u.g, s: u.s, sv: 0, ssSum: 0, tv: 0, tsSum: 0,
      tLSum: 0, tLCount: 0, tDSum: 0, tDCount: 0, comments: [], votes: [],
    };
  });
  votes.forEach(v => {
    if (v.cls !== cls) return;
    const d = map[uid(cls, v.grp, v.subgrp || 1)];
    if (!d) return;
    d.votes.push(v);
    if (v.role === 'student') {
      d.sv++;
      d.ssSum += v.scores.reduce((a, b) => a + b, 0) / v.scores.length;
    } else if (v.form === 'lecture') {
      d.tLSum += v.scores.reduce((a, b) => a + b, 0);
      d.tLCount++;
    } else if (v.form === 'design') {
      d.tDSum += v.scores.reduce((a, b) => a + b, 0);
      d.tDCount++;
    } else {
      d.tv++;
      d.tsSum += v.scores.reduce((a, b) => a + b, 0);
    }
    if (v.comment && v.comment.trim()) {
      d.comments.push({
        who: v.anonymous ? '匿名' : (v.name || '匿名'),
        role: v.role, form: v.form || '', text: v.comment.trim(),
      });
    }
  });
  const rows = unitList(cls).map(u => {
    const d = map[uid(cls, u.g, u.s)];
    if (cfg.mode === 'standard') {
      d.student_pct = d.sv ? round1(d.ssSum / d.sv * 20) : null;
      d.teacher_pct = d.tv ? round1(d.tsSum / d.tv * 2) : null;
      // 教师票可携带两位成员的档位 [成员A, 成员B]
      const tv = d.votes.filter(v => v.role === 'teacher' && cfg.tierOptions
        && Array.isArray(v.tiers) && v.tiers.length === 2).pop();
      d.tA = tv ? +tv.tiers[0] : null;
      d.tB = tv ? +tv.tiers[1] : null;
      if (d.student_pct != null) {
        const k = cfg.tiltK || 0, buf = cfg.floorBuffer || 0;
        const half = (d.tA != null && d.tB != null) ? k * (d.tA - d.tB) / 2 : 0;
        let a = d.student_pct + half, b = d.student_pct - half;
        if (d.tA != null) a = Math.max(a, d.tA - buf);
        if (d.tB != null) b = Math.max(b, d.tB - buf);
        d.pA_stu = round1(a);
        d.pB_stu = round1(b);
        if (d.teacher_pct != null) {
          d.pA_fin = round1(a * cfg.studentWeight + d.teacher_pct * cfg.teacherWeight);
          d.pB_fin = round1(b * cfg.studentWeight + d.teacher_pct * cfg.teacherWeight);
          d.final = round1((d.pA_fin + d.pB_fin) / 2);
        } else { d.pA_fin = null; d.pB_fin = null; d.final = null; }
      } else { d.pA_fin = null; d.pB_fin = null; d.final = null; }
    } else {
      d.student_raw = d.sv ? round1(d.ssSum / d.sv) : null;
      d.student_pct = d.student_raw != null ? round1(Math.max(d.student_raw, cfg.studentFloor)) : null;
      d.tL = d.tLCount ? round1(d.tLSum / d.tLCount) : null;
      d.tD = d.tDCount ? round1(d.tDSum / d.tDCount) : null;
      d.lecture = (d.student_pct != null && d.tL != null)
        ? round1(d.tL * cfg.lectureTeacherWeight + d.student_pct * cfg.lectureStudentWeight) : null;
      d.final = (d.lecture != null && d.tD != null)
        ? round1(d.lecture * (1 - cfg.designWeight) + d.tD * cfg.designWeight) : null;
    }
    return d;
  });
  rows.sort((a, b) =>
    ((b.final != null) - (a.final != null)) ||
    ((b.final != null ? b.final : -1) - (a.final != null ? a.final : -1)) ||
    (a.g - b.g) || (a.s - b.s));
  return rows;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour12: false });
}

/* 提交成功提示 */
function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<div class="toast-card"><div class="tick">✓</div><div class="tt">' + esc(msg) + '</div></div>';
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add('hide');
    setTimeout(() => t.remove(), 400);
  }, 1400);
}
