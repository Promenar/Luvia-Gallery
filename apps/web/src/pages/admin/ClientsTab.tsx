/** 客户端接入：对外访问地址、Wallpaper Engine、Android、macOS 小组件与访问令牌。 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LayoutGrid, Monitor, Plus, QrCode, Smartphone } from 'lucide-react';
import type { ApiToken, WallpaperConfig } from '@luvia/contracts';
import { call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { q, queryClient } from '@/lib/query';
import { Switch } from '@/components/kit/switch';
import { FolderPicker } from './FolderPicker';
import { folderLabel, formatSeconds, formatWhen } from './format';
import { callWith, settingsQuery, useDeferredCommit, useLibraryNames, useServerUrl, useUpdateSettings } from './hooks';
import { Chip, Confirm, Field, Modal, OutBox, Pill, QueryState, Section, Seg, SettingRow, inputClass, useFieldId, useSave } from './ui';

const tokensQuery = q('listTokens');

/* ---------- 对外访问地址 ---------- */

function PublicUrl() {
  const s = useQuery(settingsQuery);
  const upd = useUpdateSettings();
  const [v, setV] = useState('');
  const id = useFieldId('pu');
  useEffect(() => { setV(s.data?.publicUrl ?? ''); }, [s.data?.publicUrl]);
  const trimmed = v.trim().replace(/\/+$/, '');
  const valid = trimmed === '' || /^https?:\/\/[^\s/]+(\/\S*)?$/i.test(trimmed);
  const commit = () => {
    if (!s.data || !valid) return;
    const next = trimmed || null;
    if (next !== s.data.publicUrl) upd.mutate({ publicUrl: next });
  };
  return (
    <Section title="对外访问地址" desc="生成分享链接和客户端配置时使用。通过域名或反向代理访问时，改成对应的地址。">
      <SettingRow title="地址" htmlFor={id} desc={valid ? `留空时使用当前页面地址 ${location.origin}` : <span className="text-warn">地址需要以 http:// 或 https:// 开头，例如 http://192.168.1.20:3000</span>}>
        <input
          id={id}
          className={inputClass}
          value={v}
          inputMode="url"
          placeholder={location.origin}
          spellCheck={false}
          aria-invalid={!valid || undefined}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        />
      </SettingRow>
    </Section>
  );
}

/* ---------- 卡片 ---------- */

function Card({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[var(--r3)] border border-line bg-surface p-[18px]">
      <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold"><Icon className="size-[18px] text-fg-2" />{title}</h2>
      {children}
    </section>
  );
}
const Lb = ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="-mb-1.5 flex justify-between text-[12.5px] font-semibold text-fg-2">{children}</label>
);
const P = ({ children }: { children: React.ReactNode }) => <p className="m-0 text-[12.5px] text-muted">{children}</p>;

/** 壁纸切换间隔的可选档位（秒），滑块按档位移动。 */
const INTERVAL_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1800, 3600];
const nearestStep = (sec: number) => INTERVAL_STEPS.reduce((best, s, i) => (Math.abs(s - sec) < Math.abs(INTERVAL_STEPS[best]! - sec) ? i : best), 0);

function WallpaperCard({ tokens, onCreate }: { tokens: ApiToken[]; onCreate: () => void }) {
  const wts = tokens.filter((t) => t.scope === 'wallpaper');
  const [sel, setSel] = useState<string | null>(null);
  const t = wts.find((x) => x.id === sel) ?? wts[0];
  const server = useServerUrl();
  const libNames = useLibraryNames();
  const selId = useFieldId('wt'), intId = useFieldId('wi');
  const save = useSave({
    fn: (patch: Partial<WallpaperConfig>) => callWith('updateToken', { id: t!.id }, { body: { wallpaper: patch } }),
    success: '已保存，壁纸下次取图时生效',
    onSuccess: (nt) => queryClient.setQueryData(tokensQuery.queryKey, (old: { tokens: ApiToken[] } | undefined) => old && { tokens: old.tokens.map((x) => (x.id === nt.id ? nt : x)) }),
  });
  const wp = t?.wallpaper;
  const [stepLocal, setStep] = useDeferredCommit(nearestStep(wp?.intervalSec ?? 30), (i) => save.mutate({ intervalSec: INTERVAL_STEPS[i]! }));

  return (
    <Card icon={Monitor} title="Wallpaper Engine 壁纸">
      <P>壁纸用“仅壁纸”令牌连接，只能读取随机媒体。播放内容在这里调整，壁纸端不用改动。</P>
      {!t || !wp ? (
        <>
          <P>还没有“仅壁纸”令牌。</P>
          <Chip variant="primary" className="self-start" onClick={onCreate}><KeyRound />创建壁纸令牌</Chip>
        </>
      ) : (
        <>
          <Lb htmlFor={selId}>令牌</Lb>
          <select id={selId} className={inputClass} value={t.id} onChange={(e) => setSel(e.target.value)}>
            {wts.map((x) => <option key={x.id} value={x.id}>{x.name}（{x.prefix}…）</option>)}
          </select>
          <Lb>播放内容</Lb>
          <Seg
            label="播放内容"
            value={wp.source}
            onChange={(source) => save.mutate(source === 'folder' ? { source, folder: wp.folder ?? Object.keys(libNames)[0] ?? null } : { source })}
            options={[{ value: 'library', label: '整个媒体库' }, { value: 'favorites', label: '收藏' }, { value: 'folder', label: '文件夹' }]}
          />
          {wp.source === 'folder' && (
            <>
              {wp.folder && <small className="-mt-1 text-[12px] text-muted">当前：{folderLabel(wp.folder, libNames)}（包含子文件夹）</small>}
              <FolderPicker label="壁纸文件夹" value={wp.folder ? [wp.folder] : []} onChange={(v) => { if (v[0]) save.mutate({ folder: v[0] }); }} />
            </>
          )}
          <Lb htmlFor={intId}>切换间隔 <output htmlFor={intId} className="font-normal text-muted tabular-nums">{formatSeconds(INTERVAL_STEPS[stepLocal]!)}</output></Lb>
          <input id={intId} type="range" min={0} max={INTERVAL_STEPS.length - 1} step={1} value={stepLocal} aria-valuetext={formatSeconds(INTERVAL_STEPS[stepLocal]!)} onChange={(e) => setStep(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          <small className="-mt-1.5 text-[12px] text-muted">新版壁纸端读取这个间隔，旧版壁纸端按它自己的设置切换。</small>
          <label className="flex items-center justify-between gap-2.5 text-[13px] text-fg-2">只用横向照片<Switch checked={wp.landscapeOnly} onCheckedChange={(v) => save.mutate({ landscapeOnly: v })} aria-label="只用横向照片" /></label>
          <label className="flex items-center justify-between gap-2.5 text-[13px] text-fg-2">包含视频<Switch checked={wp.includeVideos} onCheckedChange={(v) => save.mutate({ includeVideos: v })} aria-label="包含视频" /></label>
          <Lb>在壁纸属性里填写</Lb>
          <OutBox copy={server} copyLabel="复制服务器地址">服务器：{server}</OutBox>
          <OutBox>令牌：创建时显示的完整令牌（以 {t.prefix} 开头）。找不到时撤销后重新创建。</OutBox>
        </>
      )}
    </Card>
  );
}

function AndroidCard() {
  const server = useServerUrl();
  return (
    <Card icon={Smartphone} title="Android 应用">
      <P>当前版本的应用用服务器地址加账号密码登录，新版服务保持兼容，不用改动。每位家庭成员用自己的账号登录。</P>
      <OutBox copy={server} copyLabel="复制服务器地址">服务器：{server}</OutBox>
      <div className="grid place-items-center gap-1.5 rounded-[var(--r2)] border border-dashed border-line-2 px-4 py-6 text-center">
        <QrCode className="size-8 text-muted" strokeWidth={1.4} />
        <b className="text-[13px] font-medium text-fg-2">扫码配对</b>
        <small className="text-[12px] text-muted">后续版本提供，届时随应用更新一起上线。</small>
      </div>
    </Card>
  );
}

function MacCard({ onCreate }: { onCreate: () => void }) {
  const server = useServerUrl();
  return (
    <Card icon={LayoutGrid} title="macOS 小组件">
      <ol className="m-0 grid gap-1.5 pl-5 text-[13px] text-fg-2">
        <li>在下方“访问令牌”里新建一个只读令牌，复制保存。</li>
        <li>打开小组件设置，填写服务器地址和这个令牌。</li>
        <li>小组件会按它自己的刷新周期显示随机照片。</li>
      </ol>
      <OutBox copy={server} copyLabel="复制服务器地址">服务器：{server}</OutBox>
      <Chip className="self-start" onClick={onCreate}><KeyRound />新建只读令牌</Chip>
    </Card>
  );
}

/* ---------- 令牌 ---------- */

const EXPIRY = [{ value: '0', label: '不过期' }, { value: '30', label: '30 天' }, { value: '365', label: '1 年' }] as const;

function CreateTokenDialog({ scope: initialScope, open, onOpenChange }: { scope: 'read' | 'wallpaper'; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState(initialScope);
  const [exp, setExp] = useState<(typeof EXPIRY)[number]['value']>('0');
  const [created, setCreated] = useState<{ token: string; meta: ApiToken } | null>(null);
  const id = useFieldId('tn');
  const create = useSave({
    fn: () => call('createToken', {
      body: { name: name.trim(), scope, expiresAt: exp === '0' ? null : new Date(Date.now() + Number(exp) * 86_400_000).toISOString() },
    }),
    onSuccess: (r) => setCreated(r),
    invalidate: [['listTokens']],
  });
  const close = (v: boolean) => { if (!v) setCreated(null); onOpenChange(v); };

  if (created) {
    return (
      <Modal open={open} onOpenChange={close} title="令牌已创建" desc="现在复制保存。关闭这个窗口后，完整令牌不会再显示。" footer={<Chip variant="primary" onClick={() => close(false)}>我已保存</Chip>}>
        <OutBox mono copy={created.token} copyLabel="复制令牌">{created.token}</OutBox>
        <p className="m-0 mt-3 text-[12.5px] text-muted">「{created.meta.name}」，{created.meta.scope === 'wallpaper' ? '仅壁纸' : '只读'}，{created.meta.expiresAt ? `${formatWhen(created.meta.expiresAt, new Date(), false)}过期` : '不过期'}。</p>
      </Modal>
    );
  }
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="新建访问令牌"
      footer={<>
        <Chip onClick={() => close(false)}>取消</Chip>
        <Chip variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate(undefined)}>{create.isPending ? '正在创建…' : '创建令牌'}</Chip>
      </>}
    >
      <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(undefined); }}>
        <Field label="名称" htmlFor={id} hint="写清是哪台设备，方便以后辨认和撤销。">
          <input id={id} className={inputClass} value={name} maxLength={80} placeholder={scope === 'wallpaper' ? '例如 卧室电脑壁纸' : '例如 MacBook 小组件'} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-semibold text-fg-2">权限</span>
          <Seg label="权限" value={scope} onChange={setScope} options={[{ value: 'read', label: '只读' }, { value: 'wallpaper', label: '仅壁纸' }]} />
          <small className="text-[12px] text-muted">{scope === 'read' ? '可以浏览你能看到的全部媒体，适合小组件。' : '只能读取随机媒体，播放内容在 Wallpaper Engine 卡片里调整。'}</small>
        </div>
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-semibold text-fg-2">有效期</span>
          <Seg label="有效期" value={exp} onChange={setExp} options={EXPIRY} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function TokensSection({ tokens, loading, error, refetch, onCreate }: { tokens: ApiToken[]; loading: boolean; error: unknown; refetch: () => void; onCreate: () => void }) {
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const revoke = useSave({
    fn: (t: ApiToken) => callWith('deleteToken', { id: t.id }),
    success: (_d, t) => `已撤销令牌「${t.name}」`,
    invalidate: [['listTokens']],
    onSuccess: () => setRevoking(null),
  });
  const th = 'border-b border-line px-3 py-2.5 text-left text-[12px] font-medium text-muted md:px-[18px]';
  const td = 'border-b border-line px-3 py-[11px] md:px-[18px]';
  return (
    <Section
      title="访问令牌"
      desc="给壁纸、小组件等不能输入密码的设备使用。令牌只在创建时完整显示一次，丢了就撤销后重新建。"
      action={<Chip onClick={onCreate}><Plus />新建令牌</Chip>}
    >
      <QueryState loading={loading} error={error} onRetry={refetch}>
        {tokens.length === 0 ? <p className="m-0 px-[18px] py-4 text-[13px] text-muted">还没有令牌。</p> : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>名称</th><th className={th}>权限</th>
                <th className={cn(th, 'max-md:hidden')}>开头</th><th className={cn(th, 'max-md:hidden')}>最近使用</th>
                <th className={cn(th, 'max-md:hidden')}>创建于</th><th className={cn(th, 'max-md:hidden')}>到期</th>
                <th className={th}><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="[&:last-child>td]:border-b-0">
                  <td className={td}>
                    <b className="font-semibold">{t.name}</b>
                    <small className="block text-[12px] text-muted md:hidden">{t.prefix}… · {formatWhen(t.lastUsedAt) ? `${formatWhen(t.lastUsedAt)}使用` : '还没用过'}</small>
                  </td>
                  <td className={td}><Pill tone={t.scope === 'read' ? 'muted' : 'accent'}>{t.scope === 'read' ? '只读' : '仅壁纸'}</Pill></td>
                  <td className={cn(td, 'font-mono text-[12px] text-fg-2 max-md:hidden')}>{t.prefix}…</td>
                  <td className={cn(td, 'text-fg-2 max-md:hidden')}>{formatWhen(t.lastUsedAt) ?? '还没用过'}</td>
                  <td className={cn(td, 'text-fg-2 max-md:hidden')}>{formatWhen(t.createdAt, new Date(), false)}</td>
                  <td className={cn(td, 'text-fg-2 max-md:hidden')}>{t.expiresAt ? (Date.parse(t.expiresAt) < Date.now() ? <span className="text-warn">已过期</span> : formatWhen(t.expiresAt, new Date(), false)) : '不过期'}</td>
                  <td className={cn(td, 'text-right')}><Chip size="sm" variant="danger" aria-label={`撤销令牌「${t.name}」`} onClick={() => setRevoking(t)}>撤销</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
      <Confirm
        open={!!revoking}
        onOpenChange={(v) => { if (!v) setRevoking(null); }}
        title={`撤销令牌「${revoking?.name ?? ''}」？`}
        desc="使用这个令牌的设备会立即无法访问。这一步不能撤回，需要时重新创建一个。"
        action="撤销令牌"
        pending={revoke.isPending}
        onConfirm={() => { if (revoking) revoke.mutate(revoking); }}
      />
    </Section>
  );
}

export default function ClientsTab() {
  const tokens = useQuery(tokensQuery);
  const [creating, setCreating] = useState<'read' | 'wallpaper' | null>(null);
  const list = tokens.data?.tokens ?? [];
  return (
    <>
      <PublicUrl />
      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-3">
        <WallpaperCard tokens={list} onCreate={() => setCreating('wallpaper')} />
        <AndroidCard />
        <MacCard onCreate={() => setCreating('read')} />
      </div>
      <TokensSection tokens={list} loading={tokens.isLoading} error={tokens.error} refetch={() => void tokens.refetch()} onCreate={() => setCreating('read')} />
      {creating && <CreateTokenDialog key={creating} scope={creating} open onOpenChange={(v) => { if (!v) setCreating(null); }} />}
    </>
  );
}
