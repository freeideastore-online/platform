UPDATE ideas
SET
  body_md = replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(
                              replace(
                                body_md,
                                'ASX announcements, annual reports, half-year reports, investor presentations, quarterly activity reports, and company-published financial statements',
                                '[ASX announcements](https://www.asx.com.au/markets/trade-our-cash-market/announcements), annual reports, half-year reports, investor presentations, quarterly activity reports, and company-published financial statements'
                              ),
                              '- Simply Wall St for ASX screeners, fair value estimates, company reports, and portfolio tools.',
                              '- [Simply Wall St](https://simplywall.st/screener/create) for ASX screeners, fair value estimates, company reports, and portfolio tools.'
                            ),
                            '- Morningstar Australia for stock research, fair value analysis, ratings, and undervalued stock lists.',
                            '- [Morningstar Australia](https://www.morningstar.com.au/products/morningstar-investor) for stock research, fair value analysis, ratings, and undervalued stock lists.'
                          ),
                          '- Market Index for ASX stock screeners, valuation filters, scans, and company data.',
                          '- [Market Index](https://www.marketindex.com.au/scans) for ASX stock screeners, valuation filters, scans, and company data.'
                        ),
                        '- Stock Doctor for ASX research, financial health ratings, quantitative analysis, and portfolio tools.',
                        '- [Stock Doctor](https://www.stockdoctor.com.au/) for ASX research, financial health ratings, quantitative analysis, and portfolio tools.'
                      ),
                      '- Intelligent Investor for ASX research, recommendations, weekly reviews, and buy or hold views.',
                      '- [Intelligent Investor](https://www.intelligentinvestor.com.au/research) for ASX research, recommendations, weekly reviews, and buy or hold views.'
                    ),
                    '- Investing.com AU for broad screener filters across valuation, dividends, growth, risk, and technicals.',
                    '- [Investing.com AU](https://au.investing.com/) for broad screener filters across valuation, dividends, growth, risk, and technicals.'
                  ),
                  '- source links: ASX announcements, annual reports, half-year reports, investor presentations.',
                  '- source links: [ASX announcements](https://www.asx.com.au/markets/trade-our-cash-market/announcements), annual reports, half-year reports, investor presentations.'
                ),
                '- ingest public ASX announcements and company reports;',
                '- ingest public [ASX announcements](https://www.asx.com.au/markets/trade-our-cash-market/announcements) and company reports;'
              ),
              'The product can drift into regulated financial advice if it gives personalized buy recommendations.',
              'The product can drift into regulated financial advice if it gives personalized buy recommendations; see [ASIC guidance on giving financial product advice](https://www.asic.gov.au/regulatory-resources/financial-services/giving-financial-product-advice/).'
            ),
            'Find guidance on financial advice boundaries in Australia.',
            'Find guidance on financial advice boundaries in Australia, starting with [ASIC RG 244](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-244-giving-information-general-advice-and-scaled-advice/) and [ASIC financial product advice guidance](https://www.asic.gov.au/regulatory-resources/financial-services/giving-financial-product-advice/).'
          ),
          '## How To Help',
          '## Research Trail

- [ASX market announcements](https://www.asx.com.au/markets/trade-our-cash-market/announcements)
- [ASX announcement search](https://www.asx.com.au/asx/v2/statistics/announcements.do)
- [Simply Wall St screener](https://simplywall.st/screener/create)
- [Morningstar Australia Investor](https://www.morningstar.com.au/products/morningstar-investor)
- [Market Index stock scans](https://www.marketindex.com.au/scans)
- [Stock Doctor](https://www.stockdoctor.com.au/)
- [Intelligent Investor research](https://www.intelligentinvestor.com.au/research)
- [Investing.com Australia](https://au.investing.com/)
- [ASIC giving financial product advice](https://www.asic.gov.au/regulatory-resources/financial-services/giving-financial-product-advice/)
- [ASIC RG 244: Giving information, general advice and scaled advice](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-244-giving-information-general-advice-and-scaled-advice/)

## How To Help'
        ),
        'What public source supports each claim?',
        'What clickable public source supports each claim?'
      ),
      'linking every important claim back to a source;',
      'linking every important claim and named product back to a source;'
    ),
    'include citations for every important claim;',
    'include citations and clickable product/source links for every important claim;'
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'asx-filings-analyst';
