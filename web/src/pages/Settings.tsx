import { ReactNode, useEffect, useState } from 'react';
import { ApiFail, get, post, put } from '../api';
import { Field, toast } from '../ui';

interface VmixEvent { input: string; overlay: number; action: 'off' | 'in' | 'toggle' | 'inout'; durationMs: number }
interface S {
  defaultOvers: number; powerplayOvers: number; limitBowlerOvers: boolean; theme: string; publicBaseUrl: string;
  autoHideMs: Record<string, number>;
  autoHideDefaults: Record<string, number>;
  autoTrigger: Record<'four' | 'six' | 'wicket' | 'milestone' | 'overSummary' | 'newBatter', boolean>;
  vmix: { enabled: boolean; host: string; mappings: { input: string; field: string; template: string }[]; events: Record<'four' | 'six' | 'wicket', VmixEvent> };
  obs: { enabled: boolean; host: string; port: number; password: string; passwordSet?: boolean; rules: { event: 'wicket' | 'four' | 'six'; scene: string; seconds: number }[] };
  pin: string; pinSet?: boolean;
}

const AUTO: [keyof S['autoTrigger'], string][] = [['four', 'Four'], ['six', 'Six'], ['wicket', 'Wicket'], ['milestone', 'Milestone'], ['overSummary', 'Over summary'], ['newBatter', 'New batter']];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><h2 className="mb-3 text-lg font-bold">{title}</h2><div className="grid gap-3 sm:grid-cols-2">{children}</div></section>;
}

export function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [pin, setPin] = useState('');
  const [scenes, setScenes] = useState<string[]>([]);
  useEffect(() => { void get<S>('/api/settings').then(setS); }, []);
  if (!s) return null;

  const up = (patch: Partial<S>) => setS({ ...s, ...patch });
  const save = async () => {
    const body: Record<string, unknown> = { ...s };
    delete body.pinSet;
    if (pin) body.pin = pin; else delete body.pin;
    const obs: Record<string, unknown> = { ...s.obs };
    delete obs.passwordSet;
    if (!s.obs.password) delete obs.password;
    body.obs = obs;
    try { setS(await put<S>('/api/settings', body)); setPin(''); toast('Settings saved'); } catch (e) { toast((e as ApiFail).message, 'error'); }
  };
  const clearPin = async () => { try { setS(await put<S>('/api/settings', { pin: '' })); toast('PIN removed'); } catch (e) { toast((e as ApiFail).message, 'error'); } };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-black">Settings</h1><button className="btn btn-primary" onClick={() => void save()}>Save settings</button></div>

      <Section title="Match defaults">
        <Field label="Default overs per innings"><input className="input" type="number" min={1} value={s.defaultOvers} onChange={(e) => up({ defaultOvers: Number(e.target.value) })} /></Field>
        <Field label="Powerplay overs"><input className="input" type="number" min={0} value={s.powerplayOvers} onChange={(e) => up({ powerplayOvers: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={s.limitBowlerOvers} onChange={(e) => up({ limitBowlerOvers: e.target.checked })} /> Limit each bowler to ceil(overs ÷ 5) overs</label>
        <Field label="Default overlay theme"><select className="input" value={s.theme} onChange={(e) => up({ theme: e.target.value })}><option>classic</option><option>neon</option><option>minimal</option></select></Field>
        <p className="text-xs text-slate-400 sm:col-span-2">Powerplay and bowler limit apply to matches created after saving. Overlay URLs carry their own <code>?theme=</code>.</p>
      </Section>

      <Section title="Auto-triggers (overlays that fire by themselves)">
        {AUTO.map(([k, label]) => (
          <label key={k} className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={s.autoTrigger[k]} onChange={(e) => up({ autoTrigger: { ...s.autoTrigger, [k]: e.target.checked } })} /> {label}</label>
        ))}
      </Section>

      <Section title="Auto-hide durations (seconds)">
        {Object.keys(s.autoHideDefaults).map((k) => (
          <Field key={k} label={k}><input className="input" type="number" min={1} max={60} value={(s.autoHideMs[k] ?? s.autoHideDefaults[k]!) / 1000} onChange={(e) => up({ autoHideMs: { ...s.autoHideMs, [k]: Math.round(Number(e.target.value) * 1000) } })} /></Field>
        ))}
      </Section>

      <Section title="Network and security">
        <Field label="Public base URL (used by Copy URL buttons)"><input className="input" placeholder="https://my-tunnel.example.com" value={s.publicBaseUrl} onChange={(e) => up({ publicBaseUrl: e.target.value })} /></Field>
        <Field label={s.pinSet ? 'Operator PIN (set — type to change)' : 'Operator PIN (optional)'}>
          <div className="flex gap-2"><input className="input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" />{s.pinSet && <button className="btn" onClick={() => void clearPin()}>Remove</button>}</div>
        </Field>
        <p className="text-xs text-slate-400 sm:col-span-2">With a PIN, scoring and settings need it; overlays and the vMix data feeds stay open so browser sources keep loading. The PIN environment variable overrides this.</p>
      </Section>

      <Section title="vMix API push (optional)">
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={s.vmix.enabled} onChange={(e) => up({ vmix: { ...s.vmix, enabled: e.target.checked } })} /> Enable push to vMix</label>
        <Field label="vMix API address"><input className="input" value={s.vmix.host} onChange={(e) => up({ vmix: { ...s.vmix, host: e.target.value } })} /></Field>
        <div className="sm:col-span-2">
          <div className="label">Title field mapping — value is a feed key (e.g. <code className="normal-case">striker_name</code>) or a template like <code className="normal-case">{'{batting_team_short} {score}'}</code></div>
          {s.vmix.mappings.map((m, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2">
              {(['input', 'field', 'template'] as const).map((k) => <input key={k} className="input" placeholder={{ input: 'Input name or number', field: 'Field e.g. Score.Text', template: 'Value / template' }[k]} value={m[k]} onChange={(e) => up({ vmix: { ...s.vmix, mappings: s.vmix.mappings.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) } })} />)}
              <button className="btn !px-3" onClick={() => up({ vmix: { ...s.vmix, mappings: s.vmix.mappings.filter((_, j) => j !== i) } })}>✕</button>
            </div>
          ))}
          <button className="btn" onClick={() => up({ vmix: { ...s.vmix, mappings: [...s.vmix.mappings, { input: '', field: '', template: '' }] } })}>+ Add mapping</button>
        </div>
        <div className="sm:col-span-2">
          <div className="label">Overlay triggers (vMix OverlayInput channel per event)</div>
          {(['four', 'six', 'wicket'] as const).map((k) => {
            const e = s.vmix.events[k];
            const set = (patch: Partial<VmixEvent>) => up({ vmix: { ...s.vmix, events: { ...s.vmix.events, [k]: { ...e, ...patch } } } });
            return (
              <div key={k} className="mb-2 grid grid-cols-[70px_1fr_80px_130px_100px] items-center gap-2">
                <b className="uppercase">{k}</b>
                <input className="input" placeholder="vMix input name / number" value={e.input} onChange={(ev) => set({ input: ev.target.value })} />
                <input className="input" type="number" min={1} max={8} title="Overlay channel" value={e.overlay} onChange={(ev) => set({ overlay: Number(ev.target.value) })} />
                <select className="input" value={e.action} onChange={(ev) => set({ action: ev.target.value as VmixEvent['action'] })}><option value="off">Off</option><option value="in">Overlay In</option><option value="inout">In, then Out</option><option value="toggle">Toggle</option></select>
                <input className="input" type="number" title="Out after (ms)" value={e.durationMs} onChange={(ev) => set({ durationMs: Number(ev.target.value) })} />
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 sm:col-span-2"><button className="btn" onClick={async () => { try { const r = await post<{ ok: boolean; message: string }>('/api/vmix/test'); toast(r.message, r.ok ? 'ok' : 'error'); } catch (e) { toast((e as ApiFail).message, 'error'); } }}>Test connection (uses saved address)</button><button className="btn" onClick={() => void post('/api/vmix/resend').then(() => toast('Resending all fields'))}>Resend all fields</button></div>
      </Section>

      <Section title="OBS (obs-websocket v5, optional)">
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={s.obs.enabled} onChange={(e) => up({ obs: { ...s.obs, enabled: e.target.checked } })} /> Enable scene auto-switch</label>
        <Field label="Host"><input className="input" value={s.obs.host} onChange={(e) => up({ obs: { ...s.obs, host: e.target.value } })} /></Field>
        <Field label="Port"><input className="input" type="number" value={s.obs.port} onChange={(e) => up({ obs: { ...s.obs, port: Number(e.target.value) } })} /></Field>
        <Field label={s.obs.passwordSet ? 'Password (set — type to change)' : 'Password'}><input className="input" type="password" value={s.obs.password} onChange={(e) => up({ obs: { ...s.obs, password: e.target.value } })} autoComplete="new-password" /></Field>
        <div className="sm:col-span-2">
          <div className="label">Rules — switch scene on an event, then return after N seconds</div>
          {s.obs.rules.map((r, i) => (
            <div key={i} className="mb-2 grid grid-cols-[110px_1fr_90px_auto] gap-2">
              <select className="input" value={r.event} onChange={(e) => up({ obs: { ...s.obs, rules: s.obs.rules.map((x, j) => (j === i ? { ...x, event: e.target.value as typeof r.event } : x)) } })}><option>wicket</option><option>four</option><option>six</option></select>
              <input className="input" list="obs-scenes" placeholder="Scene name" value={r.scene} onChange={(e) => up({ obs: { ...s.obs, rules: s.obs.rules.map((x, j) => (j === i ? { ...x, scene: e.target.value } : x)) } })} />
              <input className="input" type="number" min={1} value={r.seconds} onChange={(e) => up({ obs: { ...s.obs, rules: s.obs.rules.map((x, j) => (j === i ? { ...x, seconds: Number(e.target.value) } : x)) } })} />
              <button className="btn !px-3" onClick={() => up({ obs: { ...s.obs, rules: s.obs.rules.filter((_, j) => j !== i) } })}>✕</button>
            </div>
          ))}
          <datalist id="obs-scenes">{scenes.map((n) => <option key={n} value={n} />)}</datalist>
          <button className="btn" onClick={() => up({ obs: { ...s.obs, rules: [...s.obs.rules, { event: 'wicket', scene: '', seconds: 8 }] } })}>+ Add rule</button>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn" onClick={async () => { try { const r = await post<{ ok: boolean; message: string; version?: string }>('/api/obs/test'); toast(r.ok ? `${r.message} (OBS ${r.version})` : r.message, r.ok ? 'ok' : 'error'); } catch (e) { toast((e as ApiFail).message, 'error'); } }}>Test connection (saved settings)</button>
          <button className="btn" onClick={async () => { try { const r = await get<{ scenes: string[]; current: string }>('/api/obs/scenes'); setScenes(r.scenes); toast(`${r.scenes.length} scenes loaded`); } catch (e) { toast((e as ApiFail).message, 'error'); } }}>Load scene list</button>
        </div>
      </Section>
      <button className="btn btn-primary self-end" onClick={() => void save()}>Save settings</button>
    </div>
  );
}
