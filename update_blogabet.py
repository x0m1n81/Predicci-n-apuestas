import datetime as dt,json,os,re,sys
from pathlib import Path
import requests
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'data.json'
URL=os.getenv('BLOGABET_URL','https://blogabet.com/tips')
HEADERS={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36','Accept':'text/html,application/xhtml+xml'}
def n(v):
    if v is None:return None
    m=re.search(r'-?\d+(?:[.,]\d+)?',str(v))
    return float(m.group(0).replace(',','.')) if m else None
def pick_text(node):return ' '.join(node.stripped_strings)
def parse(html):
    soup=BeautifulSoup(html,'html.parser'); out=[]
    nodes=soup.select('article, .tip, .pick, .feed-item, .tip-item, [class*="tip-"]')
    for node in nodes:
        text=pick_text(node)
        if len(text)<15:continue
        odds=n(re.search(r'(?:odds?|cuota)\s*[:=]?\s*(\d+(?:[.,]\d+)?)',text,re.I).group(1)) if re.search(r'(?:odds?|cuota)\s*[:=]?\s*(\d+(?:[.,]\d+)?)',text,re.I) else None
        if not re.search(r'\b(odds?|cuota|stake|pick|tip|bet)\b',text,re.I):continue
        def first(sel):
            x=node.select_one(sel);return pick_text(x) if x else ''
        tipster=first('.username,.tipster,.author,[class*="username"],[class*="tipster"]')
        links=[a.get('href','') for a in node.find_all('a',href=True)]
        event=first('.event,.match,.fixture,[class*="event"],[class*="match"]')
        market=first('.market,.selection,.pick,[class*="market"],[class*="selection"]')
        if not event:event=text[:180]
        if not market:market=text[:240]
        out.append({'tipster':tipster or 'Blogabet','match':event,'pick':market,'odds':odds,'source_url':next((u for u in links if 'blogabet.com' in u),URL)})
    seen=set();clean=[]
    for x in out:
        k=(x['tipster'],x['match'],x['pick'])
        if k not in seen:seen.add(k);clean.append(x)
    return clean[:500]
try:
    r=requests.get(URL,headers=HEADERS,timeout=30,allow_redirects=True)
    if r.status_code!=200:raise RuntimeError(f'Blogabet HTTP {r.status_code}')
    picks=parse(r.text)
    if not picks:raise RuntimeError('La página respondió, pero no se pudieron identificar picks. El HTML de Blogabet puede haber cambiado.')
    payload={'source':'Blogabet /tips','updated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'status':'ok','count':len(picks),'picks':picks}
    OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print('OK records:',len(picks))
except Exception as e:
    print('ERROR:',e,file=sys.stderr)
    # Do not overwrite valid historical data with an empty dataset.
    sys.exit(1)
