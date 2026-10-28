import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { areaLabel } from '../../../shared/grading';
import { Button } from '../../../shared/ui/primitives';

export function InspectionForm({
  item,
  onCancel,
  onDone,
  onError,
}: {
  item: { id: string };
  onCancel: () => void;
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [areas, setAreas] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="drawer-heading">{t('inspect.title')}</h3>
      <p className="field-hint">{t('inspect.intro')}</p>

      <ul className="check-list list-unbounded">
        {areas.map((area) => (
          <li key={area}>
            <label className="check">
              <input type="checkbox" checked={chosen.includes(area)} onChange={() => toggle(area)} />
              {areaLabel(t, area)}
            </label>
          </li>
        ))}
      </ul>

      <div className="row">
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
      {chosen.length === 0 && <span className="field-hint">{t('inspect.pickOne')}</span>}
    </div>
  );
}
