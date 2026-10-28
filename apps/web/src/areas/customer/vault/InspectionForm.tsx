import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { areaLabel } from '../../../shared/grading';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { Button } from '../../../shared/ui/primitives';

export function InspectionForm({
  item,
  fee,
  onCancel,
  onDone,
  onError,
}: {
  item: { id: string };
  /** What the inspection costs, as it is written (the price list's), when there is a price. */
  fee?: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // The menu this form took the place of is gone, and with it the control that was focused.
  useEffect(() => heading.current?.focus(), []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<{ areas: string[] }>('/services/inspection/areas');
        setAreas(data.areas);
        setChosen(data.areas);
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError]);

  function toggle(area: string) {
    setChosen((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]));
  }

  async function submit() {
    setBusy(true);
    try {
      await api.post('/services/inspection', { itemId: item.id, areas: chosen });
      onDone(t('services.inspectionRequested'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The areas, in the order the warehouse is asked for them, are the lines of the order: each gets a finding.
  const ordered = areas.filter((area) => chosen.includes(area));

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="drawer-heading" ref={heading} tabIndex={-1}>
        {t('inspect.title')}
      </h3>

      <div className="request-form request-form--stacked">
        {/* The order as it will be read at the bench: what it costs, and a finding for each area. */}
        <aside className="request-slip">
          <DrawerTag
            kicker={t('inspect.slip.fee')}
            amount={fee ?? '—'}
            lines={ordered.map((area) => ({
              label: areaLabel(t, area),
              value: t('inspect.slip.finding'),
            }))}
          />
        </aside>

        <div className="stack stack--tight request-form-fields">
          <fieldset className="choice-set">
            <legend className="field-hint">{t('inspect.intro')}</legend>
            <ul className="choice-tiles">
              {areas.map((area) => (
                <li key={area}>
                  <label className="check choice-tile">
                    <input
                      type="checkbox"
                      checked={chosen.includes(area)}
                      onChange={() => toggle(area)}
                    />
                    {areaLabel(t, area)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {chosen.length === 0 && <span className="field-hint">{t('inspect.pickOne')}</span>}
        </div>

        <div className="row request-form-actions">
          <Button
            variant="primary"
            disabled={busy || chosen.length === 0}
            onClick={() => void submit()}
          >
            {t('inspect.submit')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('ui.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
