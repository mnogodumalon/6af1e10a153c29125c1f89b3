import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PublicShell } from '@/components/PublicShell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/blocks/Field';
import { FieldErrorSummary } from '@/components/blocks/FieldErrorSummary';
import { LoadProblem } from '@/components/blocks/LoadProblem';
import {
  loadPublicPagesConfig,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort } from '@/lib/journey/publicPort';
import {
  useLiveList,
  useStepForm,
  useJourneySubmit,
  fieldRef,
  fieldText,
  fieldDate,
  freshRef,
  fieldLookup,
  type PlanStep,
} from '@/lib/journey';
import { tx } from '@/i18n';
import { IconCheck, IconQuestionMark, IconX } from '@tabler/icons-react';

const SLUG = 'termin-abstimmen';

type Answer = 'ja' | 'vielleicht' | 'nein';

export default function TerminAbstimmen() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      setCfg(c);
      setPage(c?.pages[SLUG] ?? null);
      setLoading(false);
    });
  }, []);

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }
  return <Voting cfg={cfg} page={page} />;
}

function Voting({ cfg, page }: { cfg: PublicPagesConfig; page: PublicPageConfig }) {
  const [params] = useSearchParams();
  const linkedId = params.get('umfrage');
  const port = useMemo(() => createPublicPort(cfg, page), [cfg, page]);

  const umfragen = useLiveList(port, 'umfragen', { intervalMs: 20000 });
  const termine = useLiveList(port, 'terminvorschlaege', { intervalMs: 0 });
  const antworten = useLiveList(port, 'antworten', { intervalMs: 20000 });

  const form = useStepForm('antworten', {
    fields: ['teilnehmer_vorname', 'teilnehmer_nachname'],
    autoComplete: true,
  });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const umfrage = umfragen.records.find(r => r.id === linkedId) ?? null;
  const open = umfrage ? fieldLookup(umfrage, 'status')?.key === 'offen' : false;

  const myTermine = useMemo(
    () =>
      termine.records
        .filter(r => fieldRef(r, 'umfrage') === linkedId)
        .sort((a, b) => (fieldDate(a, 'beginn') ?? '').localeCompare(fieldDate(b, 'beginn') ?? '')),
    [termine.records, linkedId],
  );
  const myAntworten = useMemo(
    () => antworten.records.filter(r => fieldRef(r, 'umfrage') === linkedId),
    [antworten.records, linkedId],
  );

  // Teilnehmende in Reihenfolge des Eintreffens
  const people = useMemo(() => {
    const map = new Map<string, { name: string; byTermin: Record<string, string>; at: string }>();
    for (const r of myAntworten) {
      const name = `${fieldText(r, 'teilnehmer_vorname')} ${fieldText(r, 'teilnehmer_nachname')}`.trim();
      const key = name.toLowerCase();
      const entry = map.get(key) ?? { name, byTermin: {}, at: r.createdAt ?? '' };
      const t = fieldRef(r, 'terminvorschlag');
      const a = fieldLookup(r, 'antwort')?.key;
      if (t && a) entry.byTermin[t] = a;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => a.at.localeCompare(b.at));
  }, [myAntworten]);

  const counts = useMemo(() => {
    const c: Record<string, { ja: number; vielleicht: number }> = {};
    for (const t of myTermine) c[t.id] = { ja: 0, vielleicht: 0 };
    for (const p of people) {
      for (const [tid, a] of Object.entries(p.byTermin)) {
        if (!c[tid]) continue;
        if (a === 'ja') c[tid].ja++;
        else if (a === 'vielleicht') c[tid].vielleicht++;
      }
    }
    return c;
  }, [myTermine, people]);
  const maxJa = Math.max(0, ...Object.values(counts).map(c => c.ja));
  const finalId = umfrage ? fieldRef(umfrage, 'finaler_termin') : null;
  const finalTermin = finalId ? myTermine.find(t => t.id === finalId) : undefined;

  const plan: PlanStep[] = myTermine.map((t, i) => ({
    key: `antwort-${t.id}`,
    entity: 'antworten',
    primary: i === 0,
    form,
    values: () => ({ antwort: answers[t.id], umfrage: linkedId, terminvorschlag: t.id }),
  }));

  const submit = useJourneySubmit(port, plan, {
    draftKey: `termin-abstimmen-${linkedId ?? 'none'}`,
    check: async () => {
      if (!linkedId) return tx('Dieser Link passt zu keiner Umfrage.');
      const fresh = await port.get('umfragen', linkedId);
      if (!fresh || fieldLookup(fresh, 'status')?.key !== 'offen') {
        return tx('Die Umfrage ist inzwischen geschlossen.');
      }
      const first = myTermine[0];
      if (first && (await freshRef(port, 'terminvorschlaege', first.id, 'umfrage')) !== linkedId) {
        return tx('Inzwischen ist eine andere Umfrage dran.');
      }
      return null;
    },
  });

  useEffect(() => {
    if (!submit.done) return;
    (async () => {
      await antworten.reload();
      setSaved(true);
      setAnswers({});
      form.reset();
      submit.reset();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit.done]);

  if (!linkedId) {
    return (
      <PublicShell title={page.title} wide>
        <p className="text-sm text-muted-foreground">
          {tx('Bitte öffne den Link deiner Umfrage, den du bekommen hast.')}
        </p>
      </PublicShell>
    );
  }
  if (!umfragen.loaded || !termine.loaded || !antworten.loaded) {
    const err = umfragen.error || termine.error || antworten.error;
    if (err) {
      return (
        <PublicShell title={page.title} wide>
          <LoadProblem
            onRetry={async () => {
              await Promise.all([umfragen.reload(), termine.reload(), antworten.reload()]);
            }}
          />
        </PublicShell>
      );
    }
    return <PublicShell loading />;
  }
  if (!umfrage) {
    return (
      <PublicShell title={page.title} wide>
        <p className="text-sm text-muted-foreground">
          {tx('Dieser Link passt zu keiner Umfrage. Scanne bitte den QR-Code noch einmal.')}
        </p>
      </PublicShell>
    );
  }

  const allAnswered = myTermine.length > 0 && myTermine.every(t => answers[t.id]);

  const send = async () => {
    setNotice(null);
    setSaved(false);
    if (!form.validate()) return;
    const name = `${String(form.values.teilnehmer_vorname ?? '').trim()} ${String(form.values.teilnehmer_nachname ?? '').trim()}`.toLowerCase();
    if (people.some(p => p.name.toLowerCase() === name)) {
      setNotice(tx('Mit diesem Namen gibt es schon eine Antwort.'));
      return;
    }
    if (!allAnswered) {
      setNotice(tx('Bitte wähle für jeden Termin Ja, Vielleicht oder Nein.'));
      return;
    }
    await submit.run();
  };

  const icon = (a: string | undefined) =>
    a === 'ja' ? (
      <IconCheck size={18} className="mx-auto text-emerald-600" aria-label={tx('Ja')} />
    ) : a === 'vielleicht' ? (
      <IconQuestionMark size={18} className="mx-auto text-amber-600" aria-label={tx('Vielleicht')} />
    ) : a === 'nein' ? (
      <IconX size={18} className="mx-auto text-rose-500" aria-label={tx('Nein')} />
    ) : (
      <span className="text-muted-foreground">–</span>
    );

  const options: { key: Answer; label: string }[] = [
    { key: 'ja', label: tx('Ja') },
    { key: 'vielleicht', label: tx('Vielleicht') },
    { key: 'nein', label: tx('Nein') },
  ];

  return (
    <PublicShell title={fieldText(umfrage, 'titel') || page.title} description={fieldText(umfrage, 'beschreibung') || undefined} wide>
      <div className="space-y-5">
        {fieldText(umfrage, 'ort') && (
          <p className="text-sm text-muted-foreground">{tx('Ort')}: {fieldText(umfrage, 'ort')}</p>
        )}

        {!open && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
            <p className="font-medium">{tx('Die Umfrage ist geschlossen.')}</p>
            <p>
              {finalTermin
                ? tx`Finaler Termin: ${fieldText(finalTermin, 'beginn')}`
                : tx('Ein finaler Termin wurde noch nicht festgelegt.')}
            </p>
          </div>
        )}

        {open && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field form={form} name="teilnehmer_vorname">
              <Input {...form.field('teilnehmer_vorname')} />
            </Field>
            <Field form={form} name="teilnehmer_nachname">
              <Input {...form.field('teilnehmer_nachname')} />
            </Field>
          </div>
        )}

        {myTermine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tx('Es gibt noch keine Terminvorschläge.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-left font-medium">{tx('Name')}</th>
                  {myTermine.map(t => {
                    const best = maxJa > 0 && counts[t.id].ja === maxJa;
                    return (
                      <th
                        key={t.id}
                        className={`min-w-[96px] p-2 text-center font-medium ${best ? 'bg-emerald-100' : ''}`}
                      >
                        {fieldText(t, 'beginn')}
                        {best && <div className="text-xs font-normal text-emerald-700">{tx('Meiste Ja')}</div>}
                      </th>
                    );
                  })}
                </tr>
                <tr className="border-b text-xs text-muted-foreground">
                  <td className="sticky left-0 z-10 max-w-[40vw] bg-background p-2">{tx('Ja / Vielleicht')}</td>
                  {myTermine.map(t => (
                    <td
                      key={t.id}
                      className={`p-2 text-center ${maxJa > 0 && counts[t.id].ja === maxJa ? 'bg-emerald-50' : ''}`}
                    >
                      <b className="text-foreground">{counts[t.id].ja}</b> / {counts[t.id].vielleicht}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map(p => (
                  <tr key={p.name} className="border-b">
                    <td className="sticky left-0 z-10 max-w-[40vw] truncate bg-background p-2">{p.name}</td>
                    {myTermine.map(t => (
                      <td key={t.id} className="p-2 text-center">{icon(p.byTermin[t.id])}</td>
                    ))}
                  </tr>
                ))}
                {open && (
                  <tr className="bg-muted/30">
                    <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 font-medium">{tx('Du')}</td>
                    {myTermine.map(t => (
                      <td key={t.id} className="p-1 align-top">
                        <div className="flex flex-col gap-1">
                          {options.map(o => (
                            <button
                              key={o.key}
                              type="button"
                              onClick={() => setAnswers(a => ({ ...a, [t.id]: o.key }))}
                              className={`rounded border px-2 py-1 text-xs ${
                                answers[t.id] === o.key
                                  ? o.key === 'ja'
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : o.key === 'vielleicht'
                                      ? 'border-amber-500 bg-amber-500 text-white'
                                      : 'border-rose-500 bg-rose-500 text-white'
                                  : 'bg-background'
                              }`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {open && myTermine.length > 0 && (
          <div className="space-y-2">
            <FieldErrorSummary forms={[form]} />
            {notice && <p className="text-sm text-destructive">{notice}</p>}
            {submit.error && !submit.offline && <p className="text-sm text-destructive">{submit.error.message}</p>}
            {submit.offline && (
              <p className="text-sm text-muted-foreground">
                {tx('Keine Verbindung — deine Eingaben sind gesichert.')}
              </p>
            )}
            {saved && <p className="text-sm text-emerald-700">{tx('Danke, deine Antworten sind gespeichert.')}</p>}
            <Button className="w-full" onClick={send} disabled={submit.submitting}>
              {submit.submitting ? tx('Wird gespeichert …') : tx('Antworten speichern')}
            </Button>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
