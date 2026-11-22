import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { AppErrorBoundary } = await import('../../apps/web/src/shared/ui/AppErrorBoundary');

describe('the app-wide error boundary', () => {
  let quiet: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => quiet.mockRestore());

  it('shows one plain sentence and reports the error when a child throws', () => {
    const report = vi.fn();
    const failure = new Error('the shelf could not be drawn');
    function Boom(): React.ReactElement {
      throw failure;
    }
    render(
      <AppErrorBoundary report={report}>
        <Boom />
      </AppErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Something went wrong on our side. Reload the page; if it keeps happening, tell support.',
    );
    expect(alert.textContent).not.toContain('the shelf could not be drawn');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toBe(failure);
    expect(report.mock.calls[0]![1]).toEqual({ componentStack: expect.stringContaining('Boom') });
  });

  it('renders its children and reports nothing while they work', () => {
    const report = vi.fn();
    render(
      <AppErrorBoundary report={report}>
        <p>the shelf</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('the shelf')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(report).not.toHaveBeenCalled();
  });
});
