-- ============================================================
-- 课标讲解评分系统 · Supabase 数据库初始化脚本
-- 用法：Supabase 后台 → SQL Editor → 新建查询 → 粘贴全文 → Run
-- ============================================================

create extension if not exists pgcrypto;

-- 投票表
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  client_id text not null,
  role text not null check (role in ('student', 'teacher')),
  grp int not null,
  anonymous boolean not null default true,
  name text not null default '',
  scores jsonb not null,
  comment text not null default ''
);

-- 设置表（教师口令的加密哈希，匿名用户读不到）
create table if not exists settings (
  key text primary key,
  value text not null
);

-- 默认教师口令：2026（改口令方法见部署说明书）
insert into settings (key, value)
values ('teacher_password_hash', '158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab')
on conflict (key) do nothing;

-- 只允许读投票，不允许直接写（写操作走下面两个函数）
alter table votes enable row level security;
alter table settings enable row level security;
drop policy if exists "public read votes" on votes;
create policy "public read votes" on votes for select to anon using (true);

-- 提交评分（含教师口令验证、同人同组改票）
create or replace function submit_vote(
  p_client_id text, p_role text, p_grp int, p_scores int[],
  p_anonymous boolean, p_name text, p_comment text, p_password text default null
) returns json
language plpgsql security definer as $$
declare v_hash text;
begin
  if p_role = 'teacher' then
    select value into v_hash from settings where key = 'teacher_password_hash';
    if v_hash is null or v_hash <> encode(digest(coalesce(p_password, ''), 'sha256'), 'hex') then
      return json_build_object('ok', false, 'msg', '教师口令错误');
    end if;
  elsif p_role <> 'student' then
    return json_build_object('ok', false, 'msg', '角色无效');
  end if;
  if p_grp is null or p_grp < 1 or p_grp > 99 then
    return json_build_object('ok', false, 'msg', '小组编号无效');
  end if;
  if p_scores is null or array_length(p_scores, 1) is null
     or array_length(p_scores, 1) < 1 or array_length(p_scores, 1) > 50 then
    return json_build_object('ok', false, 'msg', '评分数据无效');
  end if;
  delete from votes where client_id = p_client_id and role = p_role and grp = p_grp;
  insert into votes (client_id, role, grp, anonymous, name, scores, comment)
  values (p_client_id, p_role, p_grp, coalesce(p_anonymous, true),
          coalesce(p_name, ''), to_jsonb(p_scores), coalesce(p_comment, ''));
  return json_build_object('ok', true, 'msg', '评分已提交，感谢！');
end $$;

-- 清空全部数据（需教师口令）
create or replace function reset_votes(p_password text)
returns json
language plpgsql security definer as $$
declare v_hash text;
begin
  select value into v_hash from settings where key = 'teacher_password_hash';
  if v_hash is null or v_hash <> encode(digest(coalesce(p_password, ''), 'sha256'), 'hex') then
    return json_build_object('ok', false, 'msg', '口令错误');
  end if;
  delete from votes;
  return json_build_object('ok', true, 'msg', '已清空全部数据');
end $$;

-- 修改教师口令（把 新口令 换成你的，整段运行一次即可）：
-- update settings set value = encode(digest('新口令', 'sha256'), 'hex') where key = 'teacher_password_hash';
