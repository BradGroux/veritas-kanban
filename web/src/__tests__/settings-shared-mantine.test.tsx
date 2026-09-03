import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import {
  SectionHeader,
  NumberRow,
  SettingRow,
  SettingsActionGroup,
  SettingsErrorText,
  SettingsFieldGrid,
  SettingsHelpText,
  SettingsGroup,
  SettingsNotice,
  SettingsLocalNav,
  SettingsPage,
  SettingsSection,
  SettingsStatusCard,
  ToggleRow,
} from '@/components/settings/shared';
import { renderWithProviders } from './test-utils';

describe('Settings shared Mantine rows', () => {
  afterEach(() => {
    cleanup();
  });

  it('formats units inside numeric fields without including them in saved values', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <NumberRow
        label="Size"
        value={10}
        onChange={onChange}
        unit="MB"
        hideSpinners
        maxLength={4}
        min={1}
        max={9999}
      />
    );
    const input = screen.getByLabelText('Size') as HTMLInputElement;
    expect(input.value).toBe('10 MB');
    fireEvent.change(input, { target: { value: '1234 MB' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(1234);
    expect(input.value).toBe('1234 MB');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(input.value).toBe('1 MB');
  });

  it('keeps decimal values and spinner controls with longer units', () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(
      <NumberRow
        label="Budget"
        value={1.5}
        onChange={onChange}
        unit="branches"
        min={0}
        step={0.5}
      />
    );
    expect((screen.getByLabelText('Budget') as HTMLInputElement).value).toBe('1.5 branches');
    expect(container.querySelector('.mantine-NumberInput-controls')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '2.5 branches' } });
    expect(onChange).toHaveBeenLastCalledWith(2.5);
  });

  it('renders responsive setting rows with a stable control column', () => {
    const { container } = renderWithProviders(
      <SettingRow label="Example setting" description="Helpful context">
        <span>Control</span>
      </SettingRow>
    );

    expect(screen.getByText('Example setting')).toBeDefined();
    expect(screen.getByText('Helpful context')).toBeDefined();
    expect(container.querySelector('[data-settings-row]')?.className).toContain('sm:grid-cols-');
    expect(container.querySelector('.mantine-Text-root')).toBeDefined();
  });

  it('provides the page, section, field-grid, and local-navigation layout contract', () => {
    const { container } = renderWithProviders(
      <SettingsPage title="Example" description="Page context">
        <SettingsLocalNav label="Example sections" items={[{ id: 'section-one', label: 'One' }]} />
        <SettingsSection id="section-one" title="Section one" description="Section context">
          <SettingsFieldGrid>
            <span>Field one</span>
            <span>Field two</span>
          </SettingsFieldGrid>
        </SettingsSection>
      </SettingsPage>
    );

    expect(screen.getByRole('heading', { name: 'Example' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Section one' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Example sections' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'One' }).getAttribute('href')).toBe('#section-one');
    expect(container.querySelector('[data-settings-field-grid]')?.className).toContain(
      'sm:grid-cols-2'
    );
  });

  it('defines status, help, error, and destructive-action treatments', () => {
    const { container } = renderWithProviders(
      <>
        <SettingsStatusCard title="Connected" description="Provider is ready" tone="success" />
        <SettingsHelpText>Helpful context</SettingsHelpText>
        <SettingsErrorText>Fix this field</SettingsErrorText>
        <SettingsActionGroup label="Danger zone" tone="danger">
          <button type="button">Reset</button>
        </SettingsActionGroup>
      </>
    );

    expect(container.querySelector('[data-settings-status="success"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-help]')).not.toBeNull();
    expect(container.querySelector('[data-settings-error][role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-actions="danger"]')).not.toBeNull();
  });

  it('limits nested groups to two bordered surface levels across component boundaries', () => {
    function NestedGroup() {
      return (
        <>
          <SettingsGroup data-testid="deep-group">Fields</SettingsGroup>
          <SettingsGroup empty data-testid="deep-empty">
            No records
          </SettingsGroup>
          <SettingsNotice tone="warning">Missing evidence</SettingsNotice>
        </>
      );
    }
    renderWithProviders(
      <SettingsSection title="Section">
        <SettingsGroup data-testid="subgroup">
          <NestedGroup />
        </SettingsGroup>
      </SettingsSection>
    );

    expect(screen.getByTestId('subgroup').getAttribute('data-ui-surface')).toBe('inset');
    expect(screen.getByTestId('deep-group').getAttribute('data-ui-surface')).toBe('section');
    expect(screen.getByTestId('deep-empty').getAttribute('data-ui-surface')).toBe('section');
    expect(screen.getByRole('alert').style.borderWidth).toBe('0px');
  });

  it('keeps ordinary notices neutral and reserves alerts for warning and error states', () => {
    renderWithProviders(
      <>
        <SettingsNotice>Configuration guidance</SettingsNotice>
        <SettingsNotice tone="warning">Missing configuration</SettingsNotice>
        <SettingsNotice tone="error">Save failed</SettingsNotice>
      </>
    );

    expect(screen.getByRole('status').getAttribute('data-settings-notice')).toBe('neutral');
    expect(
      screen.getAllByRole('alert').map((alert) => alert.getAttribute('data-settings-notice'))
    ).toEqual(['warning', 'error']);
  });

  it('renders toggles through Mantine Switch and preserves checked changes', () => {
    const onCheckedChange = vi.fn();
    const { container } = renderWithProviders(
      <ToggleRow label="Enable feature" checked={false} onCheckedChange={onCheckedChange} />
    );

    expect(container.querySelector('.mantine-Switch-root')).toBeDefined();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable feature' }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('renders section reset actions through Mantine Button', () => {
    const { container } = renderWithProviders(<SectionHeader title="Board" onReset={vi.fn()} />);

    expect(screen.getByText('Board')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
  });
});
