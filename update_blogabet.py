import json,re,datetime,os,sys
from pathlib import Path
try:
 import requests
 from bs4 import BeautifulSoup
except Exception as e:
 print(e);sys.exit(1)
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data.json'
URL=os.getenv('BLOGABET_FEED','https://blogabet.com/feed')
headers={'User-Agent':'Mozilla/5.0 (compatible; PicksFilter/6.0)'}
html=requests.get(URL,headers=headers,timeout=30).text
soup=BeautifulSoup(html,'html.parser')
items=[]
# Generic extraction: Blogabet can change its markup, so only emit records when an event/pick-like block is identifiable.
for node in soup.select('article, .tip, .pick, .feed-item, .tip-item'):
 txt=' '.join(node.stripped_strings)
 if not txt: continue
 if not re.search(r'\b(odds?|cuota|stake|pick|bet|tip)\b',txt,re.I): continue
 links=[a.get('href','') for a in node.find_all('a') if a.get('href')]
 tipster=''
 for h in node.select('h1,h2,h3,h4,.username,.tipster,.author'):
  if h.get_text(strip=True): tipster=h.get_text(' ',strip=True);break
 odds=None
 m=re.search(r'(?:odds?|cuota)\s*[:=]?\s*(\d+(?:[.,]\d+)?)',txt,re.I)
 if m:
  odds=float(m.group(1).replace(',','.'))
 items.append({'tipster':tipster or 'Blogabet','match':txt[:180],'pick':txt[:240],'odds':odds,'source_url':next((u for u in links if 'blogabet.com' in u),URL)})
# Deduplicate
seen=set();out=[]
for x in items:
 k=(x['tipster'],x['match'],x['pick'])
 if k not in seen:seen.add(k);out.append(x)
payload={'source':'Blogabet feed','updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'picks':out[:200]}
OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
print('records:',len(out))
