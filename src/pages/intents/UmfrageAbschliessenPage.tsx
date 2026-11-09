/**
 * Umfrage abschließen — 3-Schritt-Wizard.
 * Steps: 1) Offene Umfrage wählen → 2) Finalen Termin aus den Terminvorschlägen wählen → 3) Prüfen & Umfrage schließen.
 * Reads: umfragen, terminvorschlaege. Writes: umfragen (finaler_termin, status=geschlossen) via useUmfrageAbschliessenFlow.
 * Composes: IntentWizardShell, EntitySelectStep, SummaryStep, SuccessStep.
 */
import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { StepNav } from '@/components/blocks/StepNav';
import { fieldText, fieldLookup, fieldDate, fieldRef } from '@/lib/journey';
import type { JourneyRecord } from '@/lib/journey';
import { useUmfrageAbschliessenFlow } from '@/lib/journey/flows/UmfrageAbschliessen';
import { dateFnsLocale, tx } from '@/i18n';

function formatTermin(iso: string | null): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'EEEE, dd.MM.yyyy HH:mm', { locale: dateFnsLocale() });
  } catch {
    return iso;
  }
}

export default function UmfrageAbschliessenPage() {
  const [step, setStep] = useState(1);
  const [umfrageId, setUmfrageId] = useState<string | null>(null);

  const onlyOfUmfrage = useCallback(
    (r: JourneyRecord) => umfrageId !== null && fieldRef(r, 'umfrage') === umfrageId,
    [umfrageId],
  );
  const onlyOpen = useCallback((r: JourneyRecord) => fieldLookup(r, 'status')?.key === 'offen', []);

  const flow = useUmfrageAbschliessenFlow({
    steps: { umfragen: 1, finaler_termin: 2 },
    items: {
      umfragen: u => ({
        id: u.id,
        title: fieldText(u, 'titel'),
        subtitle: fieldText(u, 'ort') || undefined,
        status: fieldLookup(u, 'status') ?? undefined,
      }),
      finaler_termin: t => ({
        id: t.id,
        title: formatTermin(fieldDate(t, 'beginn')),
        subtitle: fieldDate(t, 'ende') ? tx`bis ${formatTermin(fieldDate(t, 'ende'))}` : undefined,
      }),
    },
    where: { umfragen: onlyOpen, finaler_termin: onlyOfUmfrage },
  });

  const umfragePick = flow.pick('umfragen');
  const pickedUmfrage = umfragePick.selectedId ?? null;
  useEffect(() => {
    setUmfrageId(pickedUmfrage);
  }, [pickedUmfrage]);

  return (
    <IntentWizardShell
      title={tx('Umfrage abschließen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{
        description: tx('Wähle den finalen Termin und schließe die Umfrage.'),
        needs: [tx('Eine offene Umfrage mit Terminvorschlägen')],
      }}
    >
      <WizardStep label={tx('Umfrage')} description={tx('Welche offene Umfrage möchtest du abschließen?')}>
        <EntitySelectStep
          {...flow.picks.umfragen.select}
          {...umfragePick}
          onSelect={id => {
            setUmfrageId(id);
            umfragePick.onSelect(id);
          }}
          searchPlaceholder={tx('Titel oder Ort …')}
          emptyText={tx('Es gibt keine offene Umfrage.')}
        />
      </WizardStep>
      <WizardStep label={tx('Finaler Termin')} description={tx('Welcher Terminvorschlag soll der finale Termin werden?')}>
        {pickedUmfrage ? (
          <EntitySelectStep
            {...flow.picks.finaler_termin.select}
            {...flow.pick('finaler_termin')}
            avatar="none"
            emptyText={tx('Diese Umfrage hat keine Terminvorschläge.')}
          />
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        )}
      </WizardStep>
      <WizardStep label={tx('Prüfen')}>
        {!flow.submit.done && (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            items={[{ key: 'status', label: tx('Status'), value: tx('Geschlossen') }]}
            whatHappensNext={tx('Die Umfrage wird geschlossen und der gewählte Termin als finaler Termin gespeichert.')}
          />
        )}
      </WizardStep>
      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          submit={flow.submit}
          undo={flow.undo}
          next={[
            { label: tx('Weitere Umfrage abschließen'), onClick: () => { flow.reset(); setStep(1); } },
            { label: tx('Umfrage mit Terminen anlegen'), href: '#/intents/umfrage-anlegen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
