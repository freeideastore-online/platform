import { describe, expect, it } from 'vitest';
import {
  readerSettingsBootScript,
  readerSettingsControls,
  readerSettingsCss,
  readerSettingsScript,
} from './reader-settings';

describe('reader settings snippets', () => {
  it('renders persistent theme and font-size controls', () => {
    expect(readerSettingsBootScript()).toContain('fis:reader-theme');
    expect(readerSettingsBootScript()).toContain('fis:reader-size');
    expect(readerSettingsBootScript()).toContain("storedTheme === 'light' || storedTheme === 'dark'");
    expect(readerSettingsControls()).toContain('data-reader-theme-option="light"');
    expect(readerSettingsControls()).toContain('data-reader-theme-option="dark"');
    expect(readerSettingsControls()).not.toContain('data-reader-theme-option="system"');
    expect(readerSettingsControls()).toContain('data-reader-size-option="xlarge"');
    expect(readerSettingsCss()).toContain('data-reader-theme="light"');
    expect(readerSettingsCss()).toContain('data-reader-theme="dark"');
    expect(readerSettingsCss()).toContain('data-reader-size="xlarge"');
    expect(readerSettingsScript()).toContain('fis:reader-theme');
    expect(readerSettingsScript()).toContain('media.onchange = apply');
  });
});
