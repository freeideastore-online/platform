import { describe, expect, it } from 'vitest';
import {
  readerSettingsBootScript,
  readerSettingsControls,
  readerSettingsCss,
  readerSettingsScript,
} from './reader-settings';

describe('reader settings snippets', () => {
  it('boot script reads theme from localStorage', () => {
    expect(readerSettingsBootScript()).toContain('fis:reader-theme');
    expect(readerSettingsBootScript()).toContain('dataset.theme');
    expect(readerSettingsBootScript()).toContain('style.background');
  });

  it('controls render a theme toggle button', () => {
    expect(readerSettingsControls()).toContain('theme-toggle');
    expect(readerSettingsControls()).toContain('aria-label');
  });

  it('CSS contains light and dark theme variables', () => {
    expect(readerSettingsCss()).toContain('data-theme="dark"');
    expect(readerSettingsCss()).toContain('--page:');
    expect(readerSettingsCss()).toContain('--panel:');
    expect(readerSettingsCss()).toContain('chapter-badge');
  });

  it('script wires toggle and media listener', () => {
    expect(readerSettingsScript()).toContain('fis:reader-theme');
    expect(readerSettingsScript()).toContain('theme-toggle');
    expect(readerSettingsScript()).toContain('onchange');
  });
});
