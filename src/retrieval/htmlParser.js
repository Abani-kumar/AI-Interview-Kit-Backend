const cheerio = require('cheerio');

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    let resolved;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    links.push({
      url: resolved,
      anchorText: $(el).text().trim().slice(0, 200),
      title: $(el).attr('title')?.trim().slice(0, 200) || '',
    });
  });

  return links;
}

function extractReadableText(html, maxChars = 8000) {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, footer, header, iframe, svg').remove();

  const title = $('title').text().trim();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  return { title, text: bodyText.slice(0, maxChars) };
}

module.exports = { extractLinks, extractReadableText };
