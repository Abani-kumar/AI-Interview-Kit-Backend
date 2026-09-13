const {
  isHiringPage,
  hasNegativePath,
  hasStrongHiringPathSegment,
  getPathSegments,
} = require('../../src/retrieval/hiringPageDetector');

describe('isHiringPage', () => {
  describe('strong hiring URL paths', () => {
    test('/careers → hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/careers',
          title: 'Careers',
          text: 'Join us.',
          wasAiRanked: false,
        })
      ).toBe(true);
    });

    test('/jobs → hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/jobs',
          title: 'Jobs',
          text: 'Open roles.',
          wasAiRanked: false,
        })
      ).toBe(true);
    });

    test('/careers/software-engineer → hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/careers/software-engineer',
          title: 'Software Engineer',
          text: 'Apply for this role.',
          wasAiRanked: false,
        })
      ).toBe(true);
    });

    test('/en/careers → hiring (locale prefix)', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/en/careers',
          title: 'Careers',
          text: 'Open positions.',
          wasAiRanked: false,
        })
      ).toBe(true);
    });

    test('page with strong career URL + career content → hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/careers',
          title: 'Careers at Example',
          text: 'Join our team. View open positions and apply now.',
          wasAiRanked: false,
        })
      ).toBe(true);
    });
  });

  describe('must NOT classify as hiring', () => {
    test('generic homepage → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/',
          title: 'Home',
          text: 'We make payments simple for everyone. Our work changes lives.',
          wasAiRanked: false,
        })
      ).toBe(false);
    });

    test('/search?q=jobs → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://www.google.com/search?q=jobs',
          title: 'jobs - Google Search',
          text: 'Search results for jobs.',
          wasAiRanked: false,
        })
      ).toBe(false);
    });

    test('/images/... → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://www.google.com/images/search?q=careers',
          title: 'Google Images',
          text: 'Image search results.',
          wasAiRanked: false,
        })
      ).toBe(false);
    });

    test('/ads/... → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://www.google.com/ads/about',
          title: 'Google Ads',
          text: 'Grow your business with online advertising.',
          wasAiRanked: false,
        })
      ).toBe(false);
    });

    test('page containing "our jobs" incidentally → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/about',
          title: 'About Us',
          text: 'Our jobs are to build reliable infrastructure and delight customers.',
          wasAiRanked: false,
        })
      ).toBe(false);
    });

    test('misleading URL containing career substring but unrelated content → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/blog/career-advice',
          title: 'Career Advice for Students',
          text: 'Tips for choosing a university major and planning your future.',
          wasAiRanked: false,
        })
      ).toBe(false);
    });

    test('AI-ranked page without hiring signals → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/team',
          title: 'Our Team',
          text: 'We build great products.',
          wasAiRanked: true,
        })
      ).toBe(false);
    });

    test('generic homepage with incidental "job" in body → not hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/products',
          title: 'Products',
          text: 'Every job in the pipeline is tracked end to end.',
          wasAiRanked: false,
        })
      ).toBe(false);
    });
  });

  describe('content and ranking signals', () => {
    test('detects hiring pages from strong content keywords on non-career URL', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/about',
          title: 'About',
          text: 'Our interview process includes a technical interview and take-home assignment.',
          wasAiRanked: false,
        })
      ).toBe(true);
    });

    test('AI-ranked page with moderate hiring content → hiring', () => {
      expect(
        isHiringPage({
          url: 'https://example.com/team',
          title: 'Our Team',
          text: 'We are hiring engineers across backend and platform teams.',
          wasAiRanked: true,
        })
      ).toBe(true);
    });
  });
});

describe('path segment helpers', () => {
  test('identifies negative path segments', () => {
    expect(hasNegativePath(getPathSegments('/search'))).toBe(true);
    expect(hasNegativePath(getPathSegments('/images/foo'))).toBe(true);
    expect(hasNegativePath(getPathSegments('/ads/campaign'))).toBe(true);
    expect(hasNegativePath(getPathSegments('/careers'))).toBe(false);
  });

  test('identifies strong hiring path segments without substring false positives', () => {
    expect(hasStrongHiringPathSegment(getPathSegments('/careers'))).toBe(true);
    expect(hasStrongHiringPathSegment(getPathSegments('/jobs/backend'))).toBe(true);
    expect(hasStrongHiringPathSegment(getPathSegments('/blog/career-advice'))).toBe(false);
    expect(hasStrongHiringPathSegment(getPathSegments('/recareering'))).toBe(false);
  });
});
