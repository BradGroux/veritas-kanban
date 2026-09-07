import { describe, expect, it } from 'vitest';
import {
  SETTINGS_CONTROL_INDEX,
  searchSettings,
  parseSettingsSupportHash,
  settingsSupportHash,
} from '@/components/settings/settings-search-index';

describe('settings support destinations', () => {
  it.each([
    ['backup', 'maintenance-backup'],
    ['theme', 'general-appearance'],
    ['token', 'multi-user-api-access'],
    ['default agent', 'general-default-agent'],
  ])('locates %s', (query, control) => {
    expect(searchSettings(SETTINGS_CONTROL_INDEX, query, false)[0].controlId).toBe(control);
  });

  it('round-trips a control link and rejects arbitrary fragments', () => {
    expect(parseSettingsSupportHash(settingsSupportHash('general', 'general-appearance'))).toEqual({
      section: 'general',
      control: 'general-appearance',
    });
    expect(parseSettingsSupportHash('#settings/data')).toEqual({
      section: 'data',
      control: undefined,
    });
    expect(parseSettingsSupportHash('#settings/general/../../outside')).toBeNull();
    expect(parseSettingsSupportHash('#other')).toBeNull();
  });
});
