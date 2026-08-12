# Bing Custom Search — active list

Paste these into the **Active** tab at customsearch.ai (one per line;
the portal accepts bulk paste). Each entry should include sub-pages.

The goal is *discovery*: we want to find startups we don't already know
about. So the list is deliberately wide — regional tech press, startup
databases, accelerator portfolios, development-sector journalism, and
university technology-transfer offices. These are the places where "we
piloted this in three provinces" actually gets written down.

**If the portal offers an option to include general web results, turn it
on.** A startup's own website is the single best source of deployment
evidence, and no curated list will contain every one of them. Treat the
list below as the floor, not the ceiling.

## Regional tech press (Asia-Pacific)

```
e27.co
techinasia.com
dealstreetasia.com
kr-asia.com
technode.com
yourstory.com
inc42.com
```

## Startup databases and directories

```
crunchbase.com
tracxn.com
dealroom.co
f6s.com
wellfound.com
pitchbook.com
```

## Development and impact sector

```
devex.com
nextbillion.net
impactalpha.com
ictworks.org
grandchallenges.org
scidev.net
```

## Accelerators and venture portfolios with a field focus

```
ycombinator.com
techstars.com
villagecapital.vc
katapult.vc
gsvventures.com
elevarequity.com
```

## University technology transfer

```
nus.edu.sg
ntu.edu.sg
kaist.ac.kr
u-tokyo.ac.jp
iitd.ac.in
unimelb.edu.au
uq.edu.au
```

## Sector press (health, agriculture, climate, water)

```
agfundernews.com
mobihealthnews.com
climateinsider.com
smartwatermagazine.com
```

---

## Tuning after the first few runs

- A domain that keeps returning press releases rather than companies is
  noise — remove it.
- If results skew to one region, add local press for the regions you
  care about.
- The **Block** tab is useful for aggregator spam and job boards, which
  match startup keywords but never contain deployment evidence.

## Reusing this list

These same domains are good discovery targets for the nightly harvest
(`scrapers/sources.yaml`) — that file wants listing pages rather than
bare domains, but the sources overlap.
