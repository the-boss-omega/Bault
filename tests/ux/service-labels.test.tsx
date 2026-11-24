import { describe, expect, it } from 'vitest';
import { t } from '../../apps/web/src/shared/i18n';
import { SERVICE_TYPE_KEY, serviceStatusLabel } from '../../apps/web/src/shared/serviceLabels';

const tr = (key: Parameters<typeof t>[0], vars?: Parameters<typeof t>[2]) => t(key, 'en', vars);

describe('a service request under way says what is happening to it', () => {
  it('gives each service its own word for in progress, and none of them says Approved', () => {
    const words = Object.keys(SERVICE_TYPE_KEY).map((type) => serviceStatusLabel(tr, 'in_progress', type));
    expect(new Set(words).size).toBe(words.length);
    for (const word of words) {
      expect(word).not.toBe('Approved');
      expect(word).not.toMatch(/^service\./);
    }
    expect(serviceStatusLabel(tr, 'in_progress', 'video_review')).toBe('Being filmed');
    expect(serviceStatusLabel(tr, 'in_progress', 'third_party_grading')).toBe('Accepted for grading');
  });

  it('keeps one word for the other statuses, and a plain one for in progress without a service', () => {
    expect(serviceStatusLabel(tr, 'requested', 'video_review')).toBe('Pending');
    expect(serviceStatusLabel(tr, 'completed', 'deslab')).toBe('Completed');
    expect(serviceStatusLabel(tr, 'in_progress')).toBe('Accepted');
    expect(serviceStatusLabel(tr, 'in_progress', 'something_new')).toBe('Accepted');
  });
});
