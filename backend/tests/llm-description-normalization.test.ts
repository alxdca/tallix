import { describe, expect, it } from 'vitest';
import {
  normalizeAiThirdParty,
  normalizeExtractedPdfTextFields,
  removeRedundantAiDescription,
} from '../src/services/llm.js';

describe('LLM description normalization', () => {
  it('removes descriptions that exactly repeat the category', () => {
    expect(removeRedundantAiDescription('Restaurants', 'Restaurants')).toBeNull();
  });

  it('removes descriptions that only differ by punctuation, casing, or pluralization', () => {
    expect(removeRedundantAiDescription('restaurant!', 'Restaurants')).toBeNull();
  });

  it('removes generic purchase descriptions that only paraphrase the category', () => {
    expect(removeRedundantAiDescription('Courses alimentaires', 'Alimentation')).toBeNull();
  });

  it('removes short descriptions that only restate the category family', () => {
    expect(removeRedundantAiDescription('Repas Restaurant', 'Restaurants et bars')).toBeNull();
    expect(removeRedundantAiDescription('Billet Train', 'Transports')).toBeNull();
    expect(removeRedundantAiDescription('Soins medicaux', 'Sante')).toBeNull();
  });

  it('keeps descriptions that add meaningful detail beyond the category', () => {
    expect(removeRedundantAiDescription('Assurance Maladie', 'Assurances')).toBe('Assurance Maladie');
    expect(removeRedundantAiDescription('Train Lausanne Geneve', 'Transports')).toBe('Train Lausanne Geneve');
  });

  it('keeps descriptions when there is no category to compare against', () => {
    expect(removeRedundantAiDescription('  Billet Train  ', null)).toBe('Billet Train');
  });

  it('removes descriptions that only repeat the third party', () => {
    expect(removeRedundantAiDescription('Swisscom', 'Telephone', 'Swisscom')).toBeNull();
  });
});

describe('PDF LLM text field normalization', () => {
  it('treats a single extracted text field as merchant instead of description', () => {
    expect(normalizeExtractedPdfTextFields('Swisscom', null, 'Telephone')).toEqual({
      description: '',
      thirdParty: 'Swisscom',
    });
  });

  it('keeps a real description only when a separate merchant exists', () => {
    expect(normalizeExtractedPdfTextFields('Abonnement Mobile', 'Swisscom', 'Telephone')).toEqual({
      description: 'Abonnement Mobile',
      thirdParty: 'Swisscom',
    });
  });

  it('still removes category-like descriptions when a separate merchant exists', () => {
    expect(normalizeExtractedPdfTextFields('Billet Train', 'SBB', 'Transports')).toEqual({
      description: '',
      thirdParty: 'SBB',
    });
  });
});

describe('AI third party normalization', () => {
  it('removes legal company suffixes', () => {
    expect(normalizeAiThirdParty('Migros Sàrl')).toBe('Migros');
    expect(normalizeAiThirdParty('Example Trading, LLC')).toBe('Example Trading');
    expect(normalizeAiThirdParty('Acme GmbH & Co. KG')).toBe('Acme');
  });

  it('removes generic business-type prefixes', () => {
    expect(normalizeAiThirdParty('Pharmacie Amavita')).toBe('Amavita');
    expect(normalizeAiThirdParty('RESTAURANT CENTRAL SARL')).toBe('Central');
    expect(normalizeAiThirdParty('Garage Emil Frey AG')).toBe('Emil Frey');
  });

  it('converts all-uppercase company names to natural casing', () => {
    expect(normalizeAiThirdParty('MIGROS GENOSSENSCHAFT')).toBe('Migros Genossenschaft');
    expect(normalizeAiThirdParty("L'OREAL SUISSE SA")).toBe("L'Oreal Suisse");
  });

  it('preserves short brand acronyms', () => {
    expect(normalizeAiThirdParty('SBB AG')).toBe('SBB');
  });
});
