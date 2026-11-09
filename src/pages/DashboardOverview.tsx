import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  IconPlus, IconLink, IconQrcode, IconExternalLink, IconCheck, IconMapPin,
  IconAlertTriangle, IconClipboardList, IconUsers, IconStar,
} from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { flowActionFor } from '@/config/plan';
import type { EnrichedUmfragen, EnrichedTerminvorschlaege, EnrichedAntworten } from '@/types/enriched';
import { extractRecordId } from '@/services/livingAppsService';
import { lookupKey } from '@/lib/formatters';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { gruss, namen, useClock, undoToast } from '@/lib/polish';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { PublicPageQr, usePublicPageLink } from '@/components/widgets/PublicPageQr';

type Filter = 'all' | 'offen' | 'ohneFinal';

interface TerminStat {
  termin: EnrichedTerminvorschlaege;
  ja: number;
  vielleicht: number;
  nein: number;
}

interface SurveyStat {
  umfrage: EnrichedUmfragen;
  termine: TerminStat[];
  teilnehmer: number;
  best: TerminStat | null;
  finalId: string | null;
  isOpen: boolean;
}

// layout-opt-out: none — composed via DashboardGrid; survey cards are hand-built because no widget
// covers a per-survey vote matrix (CalendarWidget/Kanban show single records, ChartWidget one axis).

function SurveyCard({ stat, canWrite, onOpen, onFinalize }: {
  stat: SurveyStat;
  canWrite: boolean;
  onOpen: () => void;
  onFinalize: (terminId: string) => string | null;
}) {
  const { umfrage, termine, teilnehmer, best, finalId, isOpen } = stat;
  const { link } = usePublicPageLink('umfragen', umfrage.record_id);
  const [showQr, setShowQr] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const loc = { locale: dateFnsLocale() };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      undoToast(tx('Link kopiert'));
    } catch {
      setNote(tx('Kopieren nicht möglich — öffne die Seite und kopiere den Link dort.'));
    }
  };
  const openTab = () => { if (link) window.open(link, '_blank', 'noopener'); };

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-2 justify-between">
          <button type="button" onClick={onOpen} className="min-w-0 text-left flex-1">
            <div className="font-semibold truncate">{umfrage.fields.titel ?? '—'}</div>
            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              {umfrage.fields.ort ? (
                <span className="inline-flex items-center gap-1 min-w-0"><IconMapPin size={14} className="shrink-0" /><span className="truncate">{umfrage.fields.ort}</span></span>
              ) : null}
              <span className="inline-flex items-center gap-1"><IconUsers size={14} className="shrink-0" />{tx`${teilnehmer} Teilnehmende`}</span>
            </div>
          </button>
          <span className={`text-xs font-medium ${isOpen ? 'text-emerald-600' : 'text-muted-foreground'}`}>
            {umfrage.fields.status?.label ?? ''}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={!link}>
            <IconLink size={16} className="shrink-0" />{tx('Link kopieren')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowQr(v => !v)} disabled={!link} aria-pressed={showQr}>
            <IconQrcode size={16} className="shrink-0" />{tx('QR-Code')}
          </Button>
          <Button size="sm" variant="outline" onClick={openTab} disabled={!link}>
            <IconExternalLink size={16} className="shrink-0" />{tx('In neuem Tab öffnen')}
          </Button>
        </div>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        {showQr ? <div className="flex justify-center py-2"><PublicPageQr entity="umfragen" recordId={umfrage.record_id} size={180} /></div> : null}
      </div>

      <div className="border-t divide-y">
        {termine.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{tx('Noch keine Terminvorschläge.')}</p>
        ) : termine.map(ts => {
          const isFinal = finalId === ts.termin.record_id;
          const isBest = !finalId && best?.termin.record_id === ts.termin.record_id;
          const go = isOpen && canWrite && !finalId ? () => setNote(onFinalize(ts.termin.record_id)) : null;
          return (
            <div key={ts.termin.record_id} className={`px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${isFinal ? 'bg-emerald-50' : isBest ? 'bg-primary/5' : ''}`}>
              <div className="min-w-0 flex-1 basis-40">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {ts.termin.fields.beginn ? format(parseISO(ts.termin.fields.beginn), 'EEE, dd.MM.yyyy HH:mm', loc) : '—'}
                  {ts.termin.fields.ende ? <span className="text-muted-foreground font-normal">– {format(parseISO(ts.termin.fields.ende), 'HH:mm', loc)}</span> : null}
                </div>
                {isFinal ? (
                  <div className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1"><IconCheck size={14} />{tx('Finaler Termin')}</div>
                ) : isBest ? (
                  <div className="text-xs font-medium text-primary inline-flex items-center gap-1"><IconStar size={14} />{tx('Meiste Ja')}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-3 text-sm tabular-nums">
                <span className="text-emerald-600 font-medium">{tx`${ts.ja} Ja`}</span>
                <span className="text-amber-600 font-medium">{tx`${ts.vielleicht} Vielleicht`}</span>
                <span className="text-muted-foreground">{tx`${ts.nein} Nein`}</span>
              </div>
              {go ? (
                <Button size="sm" variant={isBest ? 'default' : 'outline'} onClick={go}>{tx('Als final festlegen')}</Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'umfragen') return undefined;
      const s = statOf(top.record.record_id);
      if (!s || !s.isOpen || s.finalId || !s.best) return undefined;
      const go = flowActionFor('umfragen', 'finaler_termin', s.umfrage.record_id, s.best.termin.record_id);
      return go ? { label: tx('Beliebtesten Termin festlegen & schließen'), onClick: go } : undefined;
    },
  });
  const clock = useClock();
  const [filter, setFilter] = useState<Filter>('all');
  const enrichedUmfragen: EnrichedUmfragen[] = crud.enriched.umfragen;
  const enrichedTermine: EnrichedTerminvorschlaege[] = crud.enriched.terminvorschlaege;
  const enrichedAntworten: EnrichedAntworten[] = crud.enriched.antworten;

  const stats = useMemo<SurveyStat[]>(() => {
    return enrichedUmfragen.map(u => {
      const termine: TerminStat[] = enrichedTermine
        .filter(t => extractRecordId(t.fields.umfrage) === u.record_id)
        .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''))
        .map(t => ({ termin: t, ja: 0, vielleicht: 0, nein: 0 }));
      const byId = new Map(termine.map(ts => [ts.termin.record_id, ts]));
      const names = new Set<string>();
      for (const a of enrichedAntworten) {
        if (extractRecordId(a.fields.umfrage) !== u.record_id) continue;
        names.add(`${a.fields.teilnehmer_vorname ?? ''} ${a.fields.teilnehmer_nachname ?? ''}`.trim().toLowerCase());
        const ts = byId.get(extractRecordId(a.fields.terminvorschlag) ?? '');
        if (!ts) continue;
        const k = lookupKey(a.fields.antwort);
        if (k === 'ja') ts.ja++;
        else if (k === 'vielleicht') ts.vielleicht++;
        else if (k === 'nein') ts.nein++;
      }
      let best: TerminStat | null = null;
      for (const ts of termine) {
        if (ts.ja === 0) continue;
        if (!best || ts.ja > best.ja || (ts.ja === best.ja && ts.vielleicht > best.vielleicht)) best = ts;
      }
      return {
        umfrage: u,
        termine,
        teilnehmer: names.size,
        best,
        finalId: extractRecordId(u.fields.finaler_termin),
        isOpen: lookupKey(u.fields.status) !== 'geschlossen',
      };
    }).sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || b.umfrage.createdat.localeCompare(a.umfrage.createdat));
  }, [enrichedUmfragen, enrichedTermine, enrichedAntworten]);

  function statOf(id: string) { return stats.find(s => s.umfrage.record_id === id); }

  // ONE write path: opens/runs the flow that owns finaler_termin + status.
  const finalize = (s: SurveyStat, terminId: string): string | null => {
    const go = flowActionFor('umfragen', 'finaler_termin', s.umfrage.record_id, terminId);
    if (!go) return tx('Der Ablauf „Umfrage abschließen“ ist nicht verfügbar.');
    go();
    undoToast(tx`${s.umfrage.fields.titel ?? ''} — finaler Termin festgelegt, Umfrage geschlossen`);
    return null;
  };

  const nowKey = format(clock, "yyyy-MM-dd'T'HH:mm");
  const openStats = stats.filter(s => s.isOpen);
  const ohneFinal = stats.filter(s => !s.finalId);
  // Urgent: open survey whose proposed dates are all in the past — decide now.
  const verstrichen = openStats.filter(s => s.termine.length > 0 && s.termine.every(ts => (ts.termin.fields.beginn ?? '') < nowKey));

  const visible = stats.filter(s => filter === 'all' ? true : filter === 'offen' ? s.isOpen : !s.finalId);
  const heroTarget = verstrichen[0];
  const heroAction = heroTarget
    ? (heroTarget.best
      ? { label: tx('Beliebtesten Termin festlegen'), onClick: () => { finalize(heroTarget, heroTarget.best!.termin.record_id); } }
      : { label: tx('Umfrage ansehen'), onClick: () => crud.umfragen.openDetail(heroTarget.umfrage) })
    : null;

  const context = (() => {
    if (stats.length === 0) return tx('Lege deine erste Umfrage an und teile den Link.');
    if (verstrichen.length > 0) return tx`${namen(verstrichen.map(s => s.umfrage.fields.titel ?? ''))}: alle Terminvorschläge liegen in der Vergangenheit.`;
    if (openStats.length > 0) return tx`Offen sind ${namen(openStats.map(s => s.umfrage.fields.titel ?? ''))}.`;
    return tx`Alle Umfragen sind geschlossen — zuletzt ${namen(stats.slice(0, 2).map(s => s.umfrage.fields.titel ?? ''))}.`;
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-muted-foreground">{context}</p>
        </div>
        {crud.umfragen.canWrite && (
          <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>
            <IconPlus size={16} className="shrink-0" />{tx('Neue Umfrage')}
          </Button>
        )}
      </div>

      {stats.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 flex flex-col items-center text-center gap-3">
          <IconClipboardList size={48} className="text-muted-foreground" />
          <p className="max-w-md text-muted-foreground">{tx('Noch keine Umfrage. Lege eine an, trage Terminvorschläge ein und teile den Link mit den Teilnehmenden.')}</p>
          {crud.umfragen.canWrite && (
            <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>{tx('Erste Umfrage anlegen')}</Button>
          )}
        </div>
      ) : (
        <DashboardGrid
          variant="wide"
          hero={heroTarget && heroAction ? (
            <HeroBanner icon={<IconAlertTriangle size={18} />} action={heroAction}>
              <b>{heroTarget.umfrage.fields.titel}</b> {tx('— alle Terminvorschläge sind vorbei, es fehlt noch der finale Termin.')}
            </HeroBanner>
          ) : undefined}
          kpis={(
            <StatStrip>
              <StatStripItem
                title={tx('Offene Umfragen')}
                value={openStats.length}
                onClick={() => setFilter(f => f === 'offen' ? 'all' : 'offen')}
                active={filter === 'offen'}
              />
              <StatStripItem
                title={tx('Ohne finalen Termin')}
                value={ohneFinal.length}
                onClick={() => setFilter(f => f === 'ohneFinal' ? 'all' : 'ohneFinal')}
                active={filter === 'ohneFinal'}
              />
            </StatStrip>
          )}
          primary={(
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{appLabel('umfragen')}</h2>
              {visible.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tx('Keine Umfrage in dieser Auswahl.')}</p>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {visible.map(s => (
                    <SurveyCard
                      key={s.umfrage.record_id}
                      stat={s}
                      canWrite={crud.umfragen.canWrite}
                      onOpen={() => crud.umfragen.openDetail(s.umfrage)}
                      onFinalize={(terminId) => finalize(s, terminId)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        />
      )}
      {crud.surfaces}
    </div>
  );
}
