import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { OcrReview, certShapeProblem } = await import('../../apps/web/src/areas/warehouse/OcrReview');

const LABEL = {
  ready: true,
  consumedAt: null,
  fields: {
    trackingNumber: '9400100000000000000000',
    carrier: 'USPS',
    senderName: 'SAM SENDER',
    senderAddress: '12 MAPLE STREET\nSPRINGFIELD IL 62704',
  },
  confidence: { trackingNumber: 0.62, carrier: 0.62, senderName: 0.9, senderAddress: 0.81 },
};

const fieldBox = (name: string) => document.querySelector<HTMLElement>(`[data-ocr-field="${name}"]`)!;

function renderReview(props: Partial<Parameters<typeof OcrReview>[0]> = {}) {
  return render(
    <I18nProvider>
      <OcrReview subject="parcel" id="p1" pollMs={5} waitMs={200} {...props} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('the bench prefills what was read from a photo, and saves nothing unread', () => {
  it('polls until the reading is there, then marks every prefilled field read from the photo with its confidence', async () => {
    get.mockResolvedValueOnce({ ready: false }).mockResolvedValueOnce({ ready: false }).mockResolvedValue(LABEL);
    renderReview();

    expect(await screen.findByText(/Reading the photo/)).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Read from the label photo' });
    expect(get).toHaveBeenCalledWith('/parcels/p1/ocr');

    expect(within(fieldBox('trackingNumber')).getByDisplayValue('9400100000000000000000')).toBeInTheDocument();
    expect(within(fieldBox('trackingNumber')).getByText('Read from the photo · 62% sure')).toBeInTheDocument();
    expect(within(fieldBox('senderName')).getByText('Read from the photo · 90% sure')).toBeInTheDocument();
    expect(within(fieldBox('senderAddress')).getByText('Read from the photo · 81% sure')).toBeInTheDocument();
    expect(screen.getByText('4 still to check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save the checked details' })).toBeDisabled();
  });

  it('clears the mark on a field the operator edits, and saves their value once the rest are ticked', async () => {
    get.mockResolvedValue(LABEL);
    post.mockResolvedValue({ status: 'saved' });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderReview({ onSaved });
    await screen.findByRole('heading', { name: 'Read from the label photo' });

    const tracking = within(fieldBox('trackingNumber')).getByRole('textbox');
    await user.clear(tracking);
    await user.type(tracking, '9400100000000000000099');
    expect(within(fieldBox('trackingNumber')).queryByText(/Read from the photo/)).not.toBeInTheDocument();
    expect(fieldBox('trackingNumber')).not.toHaveAttribute('data-read-from-photo');
    expect(screen.getByText('3 still to check')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save the checked details' });
    for (const name of ['carrier', 'senderName']) {
      await user.click(within(fieldBox(name)).getByRole('checkbox'));
    }
    expect(save).toBeDisabled();
    await user.click(within(fieldBox('senderAddress')).getByRole('checkbox'));
    expect(save).toBeEnabled();

    await user.click(save);
    expect(post).toHaveBeenCalledWith('/parcels/p1/ocr/confirm', {
      trackingNumber: '9400100000000000000099',
      carrier: 'USPS',
      senderName: 'SAM SENDER',
      senderAddress: '12 MAPLE STREET\nSPRINGFIELD IL 62704',
    });
    expect(await screen.findByText(/What was read from the photo is used up/)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it('holds a card back while its certificate number does not have its grading body’s shape', async () => {
    get.mockResolvedValue({
      ready: true,
      consumedAt: null,
      fields: { cardName: 'RAYQUAZA', gradingBody: 'PSA', grade: '9', certNumber: '1234567' },
      confidence: { cardName: 0.9, gradingBody: 0.9, grade: 0.9, certNumber: 0.5 },
    });
    const user = userEvent.setup();
    renderReview({ subject: 'item', id: 'i1' });
    await screen.findByRole('heading', { name: 'Read from the item photo' });
    expect(get).toHaveBeenCalledWith('/custody/items/i1/ocr');

    for (const name of ['cardName', 'gradingBody', 'grade', 'certNumber']) {
      await user.click(within(fieldBox(name)).getByRole('checkbox'));
    }
    expect(screen.getByText('A PSA certificate number is 8 digits.')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save the checked details' });
    expect(save).toBeDisabled();

    await user.type(within(fieldBox('certNumber')).getByRole('textbox'), '8');
    expect(screen.queryByText(/certificate number is/)).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it('says nothing was read when no reading arrives in time, and shows nothing at all with OCR off', async () => {
    get.mockResolvedValue({ ready: false });
    const first = renderReview({ waitMs: 30 });
    expect(await screen.findByText(/Nothing was read from the photo in time/)).toBeInTheDocument();
    first.unmount();

    get.mockReset();
    get.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    const { container } = renderReview();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('checks certificate shapes for the four grading bodies', () => {
    expect(certShapeProblem('PSA', '12345678')).toBeNull();
    expect(certShapeProblem('BGS', '0012345678')).toBeNull();
    expect(certShapeProblem('CGC', '1234567')).toBeNull();
    expect(certShapeProblem('SGC', '12345678')).toBeNull();
    expect(certShapeProblem('SGC', '123456789')).toEqual({ body: 'SGC', shape: '7 to 8 digits' });
    expect(certShapeProblem('', '12')).toEqual({ body: 'grading', shape: '7 to 10 digits' });
  });
});
